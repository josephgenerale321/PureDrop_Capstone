import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
// Type-only import — erased at build time, so bundling/evaluating this screen
// never touches the native module. The runtime import happens lazily inside
// handleConfirmCrop (a top-level import would throw at route-load time on
// dev-client builds that predate expo-image-manipulator, crashing the whole
// capture screen before the camera even opens).
import type { ImageRef } from "expo-image-manipulator";

// CR80 ID card ratio (85.6mm x 54mm) — same ratio as the capture guide frame,
// so confirming the centered default crop reproduces the framed document.
const CROP_ASPECT = 1.586;
// The crop frame starts at this fraction of the visible photo's edges.
const INITIAL_SIZE_FRACTION = 0.86;
// Smallest allowed crop frame width (screen points).
const MIN_CROP_WIDTH = 64;
// Drag distance (points) before a touch starts moving the frame, so taps
// never nudge it.
const MOVE_THRESHOLD = 2;

/** Crop rectangle in screen points (crop canvas coordinates). */
export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The letterboxed ("contain") photo rect inside the crop canvas — the bridge
 * between screen points and image pixels.
 */
type DisplayedRect = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  scale: number;
};

export type ValidIdCropperProps = {
  /** URI of the freshly captured photo (local temp file). */
  photoUri: string;
  /** Human label of the side being cropped, e.g. "Front of your ID". */
  sideLabel: string;
  /** Called with the cropped file's URI when the user confirms. */
  onConfirm: (croppedUri: string) => void;
  /** Called when the user backs out — the caller discards the capture. */
  onCancel: () => void;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Full-screen crop step for the Valid ID flow. Shows the captured photo with
 * an aspect-locked (CR80) crop frame the user can drag and resize; confirming
 * crops the image in native pixels via expo-image-manipulator and hands the
 * new file URI back.
 */
export default function ValidIdCropper({
  photoUri,
  sideLabel,
  onConfirm,
  onCancel,
}: ValidIdCropperProps) {
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [frame, setFrame] = useState<CropRect | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Whether expo-image-manipulator's native module exists in this build.
  // null = still probing. When false, the installed dev client predates the
  // package and "Use Photo" can only attach the uncropped capture.
  const [isCropperReady, setIsCropperReady] = useState<boolean | null>(null);

  // Refs mirroring state so the (stable) PanResponder callbacks always read
  // fresh values without being recreated mid-gesture.
  const frameRef = useRef<CropRect | null>(null);
  const displayedRef = useRef<DisplayedRect | null>(null);
  const isSavingRef = useRef(false);
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  const applyFrame = useCallback((next: CropRect) => {
    frameRef.current = next;
    setFrame(next);
  }, []);

  const displayed = useMemo<DisplayedRect | null>(() => {
    if (!containerSize || !imageSize) {
      return null;
    }
    const scale = Math.min(
      containerSize.width / imageSize.width,
      containerSize.height / imageSize.height,
    );
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    return {
      offsetX: (containerSize.width - width) / 2,
      offsetY: (containerSize.height - height) / 2,
      width,
      height,
      scale,
    };
  }, [containerSize, imageSize]);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  // (Re)center a default crop frame whenever the displayed photo changes
  // (initial layout, rotation, or a new capture).
  useEffect(() => {
    if (!displayed) {
      frameRef.current = null;
      setFrame(null);
      return;
    }
    const width = Math.min(
      displayed.width * INITIAL_SIZE_FRACTION,
      displayed.height * CROP_ASPECT,
    );
    const initial: CropRect = {
      x: displayed.offsetX + (displayed.width - width) / 2,
      y: displayed.offsetY + (displayed.height - width / CROP_ASPECT) / 2,
      width,
      height: width / CROP_ASPECT,
    };
    applyFrame(initial);
  }, [displayed, applyFrame]);

  // Read the captured photo's pixel size (also surfaces unreadable files).
  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      photoUri,
      (width, height) => {
        if (!cancelled) {
          setImageSize({ width, height });
        }
      },
      () => {
        if (!cancelled) {
          Alert.alert(
            "Could Not Load Photo",
            "The captured photo could not be opened for cropping. Please retake it.",
          );
          onCancel();
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [photoUri, onCancel]);

  // Probe for the native manipulator module once on mount so the UI can warn
  // up front when the app build predates expo-image-manipulator (otherwise
  // the user only finds out after tapping Use Photo).
  useEffect(() => {
    let cancelled = false;
    import("expo-image-manipulator")
      .then(() => {
        if (!cancelled) {
          setIsCropperReady(true);
        }
      })
      .catch((error) => {
        console.warn("[ValidIdCropper] manipulator module unavailable:", error);
        if (!cancelled) {
          setIsCropperReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drags the whole crop frame around the visible photo.
  const movePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isSavingRef.current,
      onPanResponderGrant: (_event, gestureState) => {
        lastTouchRef.current = { x: gestureState.moveX, y: gestureState.moveY };
        isDraggingRef.current = false;
      },
      onPanResponderMove: (_event, gestureState) => {
        const current = displayedRef.current;
        const currentFrame = frameRef.current;
        if (isSavingRef.current || !current || !currentFrame) {
          return;
        }

        const deltaX = gestureState.moveX - lastTouchRef.current.x;
        const deltaY = gestureState.moveY - lastTouchRef.current.y;
        lastTouchRef.current = { x: gestureState.moveX, y: gestureState.moveY };

        // Ignore micro-jitter so a tap never nudges the frame.
        if (!isDraggingRef.current) {
          if (
            Math.abs(gestureState.dx) < MOVE_THRESHOLD &&
            Math.abs(gestureState.dy) < MOVE_THRESHOLD
          ) {
            return;
          }
          isDraggingRef.current = true;
        }

        applyFrame({
          ...currentFrame,
          x: clamp(
            currentFrame.x + deltaX,
            current.offsetX,
            current.offsetX + current.width - currentFrame.width,
          ),
          y: clamp(
            currentFrame.y + deltaY,
            current.offsetY,
            current.offsetY + current.height - currentFrame.height,
          ),
        });
      },
      onPanResponderRelease: () => {
        isDraggingRef.current = false;
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
      },
    }),
  ).current;

  // Bottom-right corner handle — aspect-locked resize driven by the edge.
  const resizePan = useRef(
    PanResponder.create({
      // Capture so the corner handle wins over the frame's move gesture.
      onStartShouldSetPanResponderCapture: () => !isSavingRef.current,
      onPanResponderGrant: (_event, gestureState) => {
        lastTouchRef.current = { x: gestureState.moveX, y: gestureState.moveY };
      },
      onPanResponderMove: (_event, gestureState) => {
        const current = displayedRef.current;
        const currentFrame = frameRef.current;
        if (isSavingRef.current || !current || !currentFrame) {
          return;
        }

        const deltaX = gestureState.moveX - lastTouchRef.current.x;
        lastTouchRef.current = { x: gestureState.moveX, y: gestureState.moveY };

        // The top-left corner stays fixed and the frame never leaves the
        // visible photo.
        const maxWidth = Math.min(
          current.offsetX + current.width - currentFrame.x,
          (current.offsetY + current.height - currentFrame.y) * CROP_ASPECT,
        );
        const width = clamp(
          currentFrame.width + deltaX,
          MIN_CROP_WIDTH,
          maxWidth,
        );
        applyFrame({ ...currentFrame, width, height: width / CROP_ASPECT });
      },
    }),
  ).current;

  // Maps the screen crop frame into image pixels and writes a new cropped
  // JPEG to the cache directory.
  const handleConfirmCrop = useCallback(async () => {
    const current = displayedRef.current;
    const currentFrame = frameRef.current;
    if (isSavingRef.current || !current || !currentFrame) {
      return;
    }

    const originX = Math.round(
      (currentFrame.x - current.offsetX) / current.scale,
    );
    const originY = Math.round(
      (currentFrame.y - current.offsetY) / current.scale,
    );
    const width = Math.round(currentFrame.width / current.scale);
    const height = Math.round(currentFrame.height / current.scale);
    if (width < 1 || height < 1) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    let rendered: ImageRef | null = null;
    try {
      // Imported lazily: the native module only exists after the dev client is
      // rebuilt (npx expo run:android). Loading it here keeps the capture
      // screen usable on older builds and lets us fall back gracefully.
      const { ImageManipulator, SaveFormat } = await import(
        "expo-image-manipulator"
      );
      const context = ImageManipulator.manipulate(photoUri);
      context.crop({ originX, originY, width, height });
      rendered = await context.renderAsync();
      const result = await rendered.saveAsync({
        compress: 0.9,
        format: SaveFormat.JPEG,
      });
      console.log(
        "[ValidIdCropper] cropped:",
        result.uri,
        `${result.width}x${result.height}`,
        "from crop rect",
        { originX, originY, width, height },
      );
      // Some native builds return a bare absolute path instead of a file://
      // URI (vision-camera needed the same normalization) — without the
      // scheme RN Image renders nothing and the attachment looks blank.
      const croppedUri = /^(file|content|https?):\/\//.test(result.uri) ||
        result.uri.startsWith("data:")
        ? result.uri
        : `file://${result.uri}`;
      onConfirm(croppedUri);
    } catch (error) {
      console.error("[ValidIdCropper] crop failed:", error);
      if (
        error instanceof Error &&
        error.message.includes("Cannot find native module")
      ) {
        // Dev client was built before expo-image-manipulator was added.
        // Offer the raw capture so the verification flow still completes;
        // real cropping returns after the rebuild.
        Alert.alert(
          "Cropper Unavailable",
          "Cropping needs a rebuilt dev client (npx expo run:android). Use the uncropped photo instead?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Use Original", onPress: () => onConfirm(photoUri) },
          ],
        );
      } else {
        Alert.alert(
          "Crop Failed",
          "Could not crop the photo. Please try again.",
        );
      }
    } finally {
      rendered?.release();
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [photoUri, onConfirm]);

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onCancel}
            disabled={isSaving}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Discard the captured photo and return to the camera"
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Crop ID Photo</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {sideLabel}
            </Text>
          </View>
        </View>

        <View
          style={styles.canvas}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setContainerSize((prev) =>
              prev && prev.width === width && prev.height === height
                ? prev
                : { width, height },
            );
          }}
        >
          <Image
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />

          {frame && (
            <>
              {/* Dim everything outside the crop frame (four masks). */}
              <View
                style={[styles.mask, { top: 0, left: 0, right: 0, height: frame.y }]}
              />
              <View
                style={[
                  styles.mask,
                  {
                    top: frame.y,
                    left: 0,
                    width: frame.x,
                    height: frame.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.mask,
                  {
                    top: frame.y,
                    left: frame.x + frame.width,
                    right: 0,
                    height: frame.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.mask,
                  {
                    left: 0,
                    right: 0,
                    top: frame.y + frame.height,
                    bottom: 0,
                  },
                ]}
              />

              {/* The crop frame — drag anywhere on it to move. */}
              <View
                style={[
                  styles.cropFrame,
                  {
                    left: frame.x,
                    top: frame.y,
                    width: frame.width,
                    height: frame.height,
                  },
                ]}
                {...movePan.panHandlers}
              >
                <View style={styles.cropCornerTL} />
                <View style={styles.cropCornerTR} />
                <View style={styles.cropCornerBL} />
                <View style={styles.cropCornerBR} />

                {/* Bottom-right resize handle (aspect-locked). */}
                <View style={styles.resizeHandle} {...resizePan.panHandlers}>
                  <Ionicons name="resize" size={14} color="#0F172A" />
                </View>
              </View>
            </>
          )}
        </View>

        <Text style={styles.hint}>
          Drag the frame over your ID and resize with the corner handle.
        </Text>

        {isCropperReady === false && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={16} color="#F59E0B" />
            <Text style={styles.warningText}>
              Cropping is unavailable in this app build — rebuild your
              development build (npx eas-cli build --profile development)
              first. Use Photo will attach the uncropped photo.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.retakeButton]}
            onPress={onCancel}
            disabled={isSaving}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Retake the photo"
          >
            <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
            <Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.confirmButton,
              isSaving && styles.actionButtonDisabled,
            ]}
            onPress={() => void handleConfirmCrop()}
            disabled={isSaving || !frame}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Crop and use this photo"
            accessibilityState={{ disabled: isSaving || !frame }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.confirmText}>Use Photo</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0B1220",
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 2,
  },
  canvas: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  mask: {
    position: "absolute",
    backgroundColor: "rgba(11, 18, 32, 0.72)",
  },
  cropFrame: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    borderRadius: 10,
  },
  cropCornerTL: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 26,
    height: 26,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopColor: "#0EA5E9",
    borderLeftColor: "#0EA5E9",
    borderTopLeftRadius: 10,
  },
  cropCornerTR: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 26,
    height: 26,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopColor: "#0EA5E9",
    borderRightColor: "#0EA5E9",
    borderTopRightRadius: 10,
  },
  cropCornerBL: {
    position: "absolute",
    bottom: -2,
    left: -2,
    width: 26,
    height: 26,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomColor: "#0EA5E9",
    borderLeftColor: "#0EA5E9",
    borderBottomLeftRadius: 10,
  },
  cropCornerBR: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomColor: "#0EA5E9",
    borderRightColor: "#0EA5E9",
    borderBottomRightRadius: 10,
  },
  resizeHandle: {
    position: "absolute",
    right: -14,
    bottom: -14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  hint: {
    color: "#94A3B8",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  warningText: {
    flex: 1,
    color: "#FCD34D",
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  retakeButton: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  retakeText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  confirmButton: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
});






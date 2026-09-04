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
  type PanResponderInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
// Legacy subpath — same convention as the capture flow (SDK 54 deprecates the
// root import). Used only to clean up the normalized intermediate file.
import * as FileSystem from "expo-file-system/legacy";
// Type-only import — erased at build time, so bundling/evaluating this screen
// never touches the native module. The runtime import happens lazily inside
// handleConfirmCrop (a top-level import would throw at route-load time on
// dev-client builds that predate expo-image-manipulator, crashing the whole
// capture screen before the camera even opens).
import type { ImageRef } from "expo-image-manipulator";

// CR80 ID card ratio (85.6mm x 54mm) — same ratio as the capture guide frame,
// so confirming the centered default crop reproduces the framed document.
export const CROP_ASPECT = 1.586;
// The crop frame starts at this fraction of the visible photo's edges.
const INITIAL_SIZE_FRACTION = 0.86;
// Smallest allowed crop frame width (screen points).
export const MIN_CROP_WIDTH = 64;
// Drag distance (points) before a touch starts moving the frame, so taps
// never nudge it.
export const MOVE_THRESHOLD = 2;

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
export type DisplayedRect = {
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

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

type ManipulatorModule = typeof import("expo-image-manipulator");

/**
 * Guards the lazy `import("expo-image-manipulator")` against interop and
 * bundler-cache surprises: Metro can surface the namespace with named
 * exports, wrap them in `default`, or — with a stale transform cache from an
 * older SDK — resolve the import without the new `ImageManipulator` API at
 * all. Returns null when the API is not available, so callers can degrade
 * gracefully instead of crashing with "Cannot read property 'manipulate' of
 * undefined".
 */
function resolveManipulatorModule(module: unknown): ManipulatorModule | null {
  if (!module || typeof module !== "object") {
    return null;
  }
  const direct = module as Partial<ManipulatorModule>;
  if (direct.ImageManipulator) {
    return direct as ManipulatorModule;
  }
  const nested = (module as { default?: Partial<ManipulatorModule> }).default;
  if (nested?.ImageManipulator) {
    return nested as ManipulatorModule;
  }
  return null;
}

/** Refs and setters the gesture builders need to move/resize the frame. */
export type CropperGestureDeps = {
  displayedRef: { current: DisplayedRect | null };
  frameRef: { current: CropRect | null };
  isSavingRef: { current: boolean };
  lastTouchRef: { current: { x: number; y: number } };
  isDraggingRef: { current: boolean };
  applyFrame: (next: CropRect) => void;
};

export type CropperGestureBuilders = (
  deps: CropperGestureDeps,
) => {
  movePan: PanResponderInstance;
  resizePan: PanResponderInstance;
};

/**
 * Standard gesture builders — pointer deltas straight from the PanResponder
 * state. Correct on modern Android/iOS; the legacy-Android OEM variant
 * (cropperoldphone.tsx) replaces these on old devices whose touch pipeline
 * reports 0/NaN coordinates on grant and synthesizes spike moves, which
 * teleports (or NaNs out) the frame during resize.
 */
export function createDefaultGestures(
  deps: CropperGestureDeps,
): {
  movePan: PanResponderInstance;
  resizePan: PanResponderInstance;
} {
  const {
    displayedRef,
    frameRef,
    isSavingRef,
    lastTouchRef,
    isDraggingRef,
    applyFrame,
  } = deps;

  // Drags the whole crop frame around the visible photo.
  const movePan = PanResponder.create({
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
  });

  // Bottom-right corner handle — aspect-locked resize driven by the edge.
  const resizePan = PanResponder.create({
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
    onPanResponderRelease: () => {
      isDraggingRef.current = false;
    },
    onPanResponderTerminate: () => {
      isDraggingRef.current = false;
    },
  });

  return { movePan, resizePan };
}

type ValidIdCropperFullProps = ValidIdCropperProps & {
  /** Gesture-builder override — used by the legacy-Android OEM variant
   * (cropperoldphone.tsx). Defaults to the standard builders. */
  gestures?: CropperGestureBuilders;
};

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
  gestures = createDefaultGestures,
}: ValidIdCropperFullProps) {
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
  // The file actually previewed and cropped. Usually a normalized re-encode
  // of the capture (EXIF orientation baked into plain pixels), produced on
  // mount so the preview and the native crop see identical pixel data. null
  // while the normalization roundtrip is still running.
  const [displayUri, setDisplayUri] = useState<string | null>(null);

  // Refs mirroring state so the (stable) PanResponder callbacks always read
  // fresh values without being recreated mid-gesture.
  const frameRef = useRef<CropRect | null>(null);
  const displayedRef = useRef<DisplayedRect | null>(null);
  const isSavingRef = useRef(false);
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  // Mirrors displayUri for the stable crop callback; also tracks the
  // normalized intermediate file for cleanup when the cropper closes.
  const displayUriRef = useRef<string | null>(null);
  const normalizedUriRef = useRef<string | null>(null);

  const applyFrame = useCallback((next: CropRect) => {
    // Never let a NaN/Infinity frame reach layout — OEM touch quirks can
    // produce non-finite deltas, and a NaN style crashes/blank-screens.
    if (
      !Number.isFinite(next.x) ||
      !Number.isFinite(next.y) ||
      !Number.isFinite(next.width) ||
      !Number.isFinite(next.height)
    ) {
      return;
    }
    frameRef.current = next;
    setFrame(next);
  }, []);

  const displayed = useMemo<DisplayedRect | null>(() => {
    if (!containerSize || !imageSize) {
      return null;
    }
    // Zero/negative decoded sizes would make scale Infinity — bail out
    // instead of poisoning every frame computation with NaN.
    if (imageSize.width <= 0 || imageSize.height <= 0) {
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

  useEffect(() => {
    displayUriRef.current = displayUri;
  }, [displayUri]);

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

  // Prepares the file the cropper previews and crops. Vision-camera captures
  // carry EXIF orientation tags, and on Android the dimensions Image.getSize
  // reports can disagree with the pixels expo-image-manipulator's native
  // decoder (Glide) hands to crop() — that mismatch makes "Use Photo" cut a
  // region away from the framed one. Routing the capture through the
  // manipulator once (render + save) bakes the orientation into plain pixels,
  // strips the EXIF tag, and yields the exact dimensions crop() will see, so
  // the preview and the crop can never disagree. Falls back to the raw
  // capture (Image.getSize) if that roundtrip fails.
  useEffect(() => {
    let cancelled = false;
    setDisplayUri(null);
    setImageSize(null);
    normalizedUriRef.current = null;

    const loadRawCaptureFallback = () => {
      Image.getSize(
        photoUri,
        (width, height) => {
          if (!cancelled) {
            setImageSize({ width, height });
            setDisplayUri(photoUri);
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
    };

    void (async () => {
      try {
        // Imported lazily: the native module only exists after the dev client
        // is rebuilt (npx expo run:android) — same rationale as the crop
        // step below. resolveManipulatorModule also catches stale-cache
        // bundles that resolve without the ImageManipulator API.
        const resolved = resolveManipulatorModule(
          await import("expo-image-manipulator"),
        );
        if (!resolved) {
          throw new Error("Cannot find native module 'ExpoImageManipulator'");
        }
        const { ImageManipulator, SaveFormat } = resolved;
        const context = ImageManipulator.manipulate(photoUri);
        const rendered = await context.renderAsync();
        // Capture the dimensions before releasing the native ref — they are
        // the ground truth of what crop() will operate on.
        const { width, height } = rendered;
        const saved = await rendered.saveAsync({
          compress: 0.95,
          format: SaveFormat.JPEG,
        });
        rendered.release();
        // Some native builds return a bare absolute path instead of a file://
        // URI — normalize the same way the crop result is normalized.
        const normalizedUri = /^(file|content|https?):\/\//.test(saved.uri) ||
          saved.uri.startsWith("data:")
          ? saved.uri
          : `file://${saved.uri}`;
        if (cancelled) {
          FileSystem.deleteAsync(normalizedUri, { idempotent: true }).catch(
            () => {},
          );
          return;
        }
        normalizedUriRef.current = normalizedUri;
        setImageSize({ width, height });
        setDisplayUri(normalizedUri);
      } catch (error) {
        console.warn(
          "[ValidIdCropper] capture normalization failed, using raw file:",
          error,
        );
        if (!cancelled) {
          loadRawCaptureFallback();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photoUri, onCancel]);

  // Removes the normalized intermediate file when the cropper goes away
  // (confirm, cancel, or unmount) — only the crop result outlives the screen.
  useEffect(() => {
    return () => {
      const normalizedUri = normalizedUriRef.current;
      if (normalizedUri && normalizedUri !== photoUri) {
        FileSystem.deleteAsync(normalizedUri, { idempotent: true }).catch(
          () => {},
        );
      }
    };
  }, [photoUri]);

  // Probe for the native manipulator module once on mount so the UI can warn
  // up front when the app build predates expo-image-manipulator (otherwise
  // the user only finds out after tapping Use Photo).
  useEffect(() => {
    let cancelled = false;
    import("expo-image-manipulator")
      .then((module) => {
        if (!cancelled) {
          // A resolving import is not enough — a stale Metro cache can serve
          // an older SDK's copy that lacks the ImageManipulator API.
          setIsCropperReady(resolveManipulatorModule(module) !== null);
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

  // Gesture handlers, built once per gesture-builder. The builders only read
  // refs (so the responders always see fresh values without being recreated
  // mid-gesture) — safe against OEM touch quirks via the variant builders.
  const { movePan, resizePan } = useMemo(
    () =>
      gestures({
        displayedRef,
        frameRef,
        isSavingRef,
        lastTouchRef,
        isDraggingRef,
        applyFrame,
      }),
    [gestures, applyFrame],
  );

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
    if (
      width < 1 ||
      height < 1 ||
      !Number.isFinite(originX) ||
      !Number.isFinite(originY)
    ) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    let rendered: ImageRef | null = null;
    try {
      // Crop the same normalized file the preview shows, so the output is
      // always exactly the framed region (identical pixel data on both
      // sides). Falls back to the raw capture if normalization failed.
      const sourceUri = displayUriRef.current ?? photoUri;
      // Imported lazily: the native module only exists after the dev client is
      // rebuilt (npx expo run:android). Loading it here keeps the capture
      // screen usable on older builds and lets us fall back gracefully.
      const resolved = resolveManipulatorModule(
        await import("expo-image-manipulator"),
      );
      if (!resolved) {
        // Matches the missing-native-module message below so the user gets
        // the "Cropper Unavailable" guidance instead of a cryptic TypeError.
        throw new Error("Cannot find native module 'ExpoImageManipulator'");
      }
      const { ImageManipulator, SaveFormat } = resolved;
      const context = ImageManipulator.manipulate(sourceUri);
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
        "of image",
        {
          width: Math.round(current.width / current.scale),
          height: Math.round(current.height / current.scale),
        },
        "scale",
        current.scale,
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
          {displayUri ? (
            <Image
              source={{ uri: displayUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.canvasLoading}>
              <ActivityIndicator size="large" color="#0EA5E9" />
            </View>
          )}

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
  canvasLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
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






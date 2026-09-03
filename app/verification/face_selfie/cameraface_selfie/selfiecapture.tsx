import { useCallback, useEffect, useRef, useState, memo } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { type Href, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system";
import type { Face } from "react-native-vision-camera-face-detector";

const REVIEW_SELFIE_ROUTE =
  "/verification/face_selfie/cameraface_selfie/reviewselfiedetails" as Href;

// react-native-vision-camera is native-only. The modules are loaded lazily on
// first render so that (a) web never executes them and (b) an outdated dev
// client (missing the native modules) shows a helpful screen instead of
// crashing the whole router at startup.
type VisionCameraModule = typeof import("react-native-vision-camera");
type FaceDetectorModule = typeof import("react-native-vision-camera-face-detector");

let cachedModules: {
  visionCamera: VisionCameraModule;
  faceDetector: FaceDetectorModule;
} | null = null;
let moduleLoadError: unknown = null;

function loadNativeModules() {
  if (cachedModules || moduleLoadError) {
    return cachedModules;
  }

  try {
    cachedModules = {
      visionCamera: require("react-native-vision-camera") as VisionCameraModule,
      faceDetector: require("react-native-vision-camera-face-detector") as FaceDetectorModule,
    };
  } catch (error) {
    moduleLoadError = error;
  }
  return cachedModules;
}

/**
 * Full-screen face selfie capture.
 *
 * Uses react-native-vision-camera with Google ML Kit face detection
 * (replaces the deprecated ExpoFaceDetector). The shutter only works while
 * a face is detected in the live preview, and the captured photo is
 * re-checked before navigating to the review screen.
 */
export default function SelfieCaptureScreen() {
  if (Platform.OS === "web") {
    return <UnsupportedScreen />;
  }

  const modules = loadNativeModules();
  if (!modules) {
    return <SetupRequiredScreen error={moduleLoadError} />;
  }

  return (
    <NativeSelfieCapture
      visionCamera={modules.visionCamera}
      faceDetector={modules.faceDetector}
    />
  );
}

function UnsupportedScreen() {
  const router = useRouter();
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View style={[styles.container, styles.containerIdle]}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.idleContent}>
        <Ionicons name="camera-outline" size={90} color="#94A3B8" />
        <Text style={styles.idleText}>Face scan is only available on mobile devices.</Text>
      </View>
    </View>
  );
}

function SetupRequiredScreen({ error }: { error: unknown }) {
  const router = useRouter();
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View style={[styles.container, styles.containerIdle]}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.idleContent}>
        <Ionicons name="build-outline" size={90} color="#94A3B8" />
        <Text style={styles.idleText}>
          The camera modules are missing from this app build. Rebuild the dev client so the
          native code is included: npx expo run:android (or npx expo run:ios)
        </Text>
        {error instanceof Error && (
          <Text style={styles.idleText} numberOfLines={4}>
            {error.message}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * The camera subtree, isolated in a memoized component.
 *
 * react-native-vision-camera v5 re-configures the native session (unbindAll +
 * rebind on Android) whenever the `outputs` elements change. The
 * face-detector wrapper recreates its output object on every render, so ANY
 * re-render of the camera subtree tears down the camera and aborts in-flight
 * captures with "Camera is closed.". Memoizing this child with only stable
 * props (device, outputs, primitive flags, useCallback'd callbacks) guarantees
 * the native session is NOT re-bound while the parent screen re-renders —
 * e.g. when face detection state or capture state changes.
 */
interface StableFaceCameraProps {
  FaceCamera: FaceDetectorModule["Camera"];
  device: NonNullable<ReturnType<VisionCameraModule["useCameraDevice"]>>;
  isActive: boolean;
  photoOutput: ReturnType<VisionCameraModule["usePhotoOutput"]>;
  onPreviewStarted: () => void;
  onPreviewStopped: () => void;
  onFacesDetected: (faces: Face[]) => void;
  onError: (error: Error) => void;
}

const StableFaceCamera = memo(function StableFaceCamera({
  FaceCamera,
  device,
  isActive,
  photoOutput,
  onPreviewStarted,
  onPreviewStopped,
  onFacesDetected,
  onError,
}: StableFaceCameraProps) {
  return (
    <FaceCamera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
      outputs={[photoOutput]}
      performanceMode="fast"
      onPreviewStarted={onPreviewStarted}
      onPreviewStopped={onPreviewStopped}
      onFacesDetected={onFacesDetected}
      onError={onError}
    />
  );
});

function NativeSelfieCapture({
  visionCamera,
  faceDetector,
}: {
  visionCamera: VisionCameraModule;
  faceDetector: FaceDetectorModule;
}) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const device = visionCamera.useCameraDevice("front");
  const { hasPermission, canRequestPermission, requestPermission } =
    visionCamera.useCameraPermission();
  const photoOutput = visionCamera.usePhotoOutput({ qualityPrioritization: "balanced" });
  const imageFaceDetector = faceDetector.useImageFaceDetector({
    performanceMode: "accurate",
  });
  const FaceDetectorCamera = faceDetector.Camera;

  const [isCapturing, setIsCapturing] = useState(false);
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  // Guards against overlapping captures.
  const isBusyRef = useRef(false);

  // Unbind the camera while the review screen (or any other screen) is on top,
  // and re-bind when this screen regains focus.
  useEffect(() => {
    if (!isFocused) {
      setIsFaceDetected(false);
    }
  }, [isFocused]);

  // Ask for camera permission once when the screen opens.
  const hasRequestedRef = useRef(false);
  useEffect(() => {
    if (hasRequestedRef.current || hasPermission || !canRequestPermission) {
      return;
    }

    hasRequestedRef.current = true;
    void requestPermission().then((granted) => {
      if (!granted) {
        Alert.alert(
          "Camera Permission",
          "Camera access is required for face verification. Please enable it in your device settings.",
        );
      }
    });
  }, [hasPermission, canRequestPermission, requestPermission]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleRetryPermission = () => {
    hasRequestedRef.current = false;
    void requestPermission().then((granted) => {
      if (!granted) {
        Alert.alert(
          "Camera Permission",
          "Camera access is required for face verification. Please enable it in your device settings.",
        );
      }
    });
  };

  const handleFacesDetected = useCallback((faces: Face[]) => {
    setIsFaceDetected(faces.length > 0);
  }, []);

  const handleCameraError = useCallback((error: Error) => {
    console.warn("Face detection error:", error);
  }, []);

  const handleCameraReady = useCallback(() => {
    setIsCameraReady(true);
  }, []);

  const handleCameraStopped = useCallback(() => {
    setIsCameraReady(false);
  }, []);

  // Captures a photo to a file. On Android the native session can transiently
  // abort a capture with "Camera is closed." while it is being re-bound (the
  // unbind/rebind cycle in HybridCameraSession.configure). That failure is
  // recoverable: wait briefly for the re-bind to finish and retry once.
  const capturePhotoToFileStable = async (): Promise<string> => {
    const attempt = async (): Promise<string> => {
      const photoFile = await photoOutput.capturePhotoToFile({ flashMode: "off" }, {});
      let path = photoFile.filePath;
      if (!path.startsWith("file://")) {
        path = `file://${path}`;
      }
      return path;
    };

    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/camera is closed/i.test(message)) {
        throw error;
      }
      console.warn("[SelfieCapture] transient 'Camera is closed.' — retrying capture once");
      await new Promise((resolve) => setTimeout(resolve, 350));
      return await attempt();
    }
  };

  // Captures the selfie and runs an authoritative face check on the real
  // photo before navigating to the review screen.
  const handleCapture = async () => {
    if (isBusyRef.current || !device || !isCameraReady) {
      return;
    }

    if (!isFaceDetected) {
      Alert.alert(
        "No Face Detected",
        "Please center your face inside the frame before taking the photo.",
      );
      return;
    }

    isBusyRef.current = true;
    setIsCapturing(true);
    // Stage 1 — capture the photo to a file.
    let uri = "";
    try {
      uri = await capturePhotoToFileStable();
    } catch (captureError) {
      console.error("[SelfieCapture] capturePhotoToFile failed:", captureError);
      const reason =
        captureError instanceof Error ? captureError.message : String(captureError);
      isBusyRef.current = false;
      setIsCapturing(false);
      Alert.alert("Capture Failed", reason || "Failed to capture photo.");
      return;
    }

    // Stage 2 — authoritative face gate on the real photo.
    try {
      const faces: Face[] = imageFaceDetector.detectFaces(uri);
      if (!faces || faces.length === 0) {
        setIsFaceDetected(false);
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        Alert.alert(
          "No Face Detected",
          "No face was detected in your photo. Center your face inside the frame and try again.",
        );
        return;
      }

      router.push({
        pathname: REVIEW_SELFIE_ROUTE,
        params: { photo: uri },
      } as Href);
    } catch (detectError) {
    console.error("[SelfieCapture] face check failed:", detectError);
    const reason =
      detectError instanceof Error ? detectError.message : String(detectError);
    Alert.alert(
      "Face Check Failed",
      reason || "Failed to verify the captured photo.",
    );
  } finally {
    isBusyRef.current = false;
    setIsCapturing(false);
  }
};

  if (!hasPermission) {
    return (
      <View style={[styles.container, styles.containerIdle]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.idleContent}>
          <Ionicons name="camera-outline" size={90} color="#94A3B8" />
          <Text style={styles.idleText}>
            Camera access is needed to scan your face
          </Text>

          {canRequestPermission ? (
            <TouchableOpacity
              style={styles.allowButton}
              onPress={handleRetryPermission}
              activeOpacity={0.8}
            >
              <Text style={styles.allowButtonText}>Allow Camera Access</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.idleText}>
              Please enable camera access in your device settings.
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {device && FaceDetectorCamera ? (
        <StableFaceCamera
          FaceCamera={FaceDetectorCamera}
          device={device}
          isActive={isFocused}
          photoOutput={photoOutput}
          onPreviewStarted={handleCameraReady}
          onPreviewStopped={handleCameraStopped}
          onFacesDetected={handleFacesDetected}
          onError={handleCameraError}
        />
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.container, styles.containerIdle]}>
            <Ionicons name="camera-outline" size={90} color="#94A3B8" />
            <Text style={styles.idleText}>Preparing camera…</Text>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.faceGuide}>
        <View style={[styles.faceGuideCornerTL, isFaceDetected && styles.faceGuideCornerActive]} />
        <View style={[styles.faceGuideCornerTR, isFaceDetected && styles.faceGuideCornerActive]} />
        <View style={[styles.faceGuideCornerBL, isFaceDetected && styles.faceGuideCornerActive]} />
        <View style={[styles.faceGuideCornerBR, isFaceDetected && styles.faceGuideCornerActive]} />
      </View>

      <Text style={[styles.hintText, !isFaceDetected && styles.hintTextWarn]}>
        {isFaceDetected
          ? "Face detected — hold steady and capture"
          : "No face detected. Center your face inside the frame"}
      </Text>

      <TouchableOpacity
        style={[styles.captureButton, (!isFaceDetected || !isCameraReady) && styles.captureButtonDisabled]}
        onPress={handleCapture}
        disabled={!isFaceDetected || isCapturing || !isCameraReady}
        activeOpacity={0.8}
        accessibilityState={{ disabled: !isFaceDetected || isCapturing || !isCameraReady }}
      >
        {isCapturing ? (
          <ActivityIndicator size="small" color="#0EA5E9" />
        ) : (
          <View
            style={[
              styles.captureButtonInner,
              !isFaceDetected && styles.captureButtonInnerDisabled,
            ]}
          />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
  },
  containerIdle: {
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    position: "absolute",
    top: 48,
    left: 24,
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  faceGuide: {
    position: "absolute",
    top: "18%",
    alignSelf: "center",
    width: 280,
    height: 340,
  },
  faceGuideCornerTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 48,
    height: 48,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopColor: "#0EA5E9",
    borderLeftColor: "#0EA5E9",
    borderTopLeftRadius: 24,
  },
  faceGuideCornerTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 48,
    height: 48,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopColor: "#0EA5E9",
    borderRightColor: "#0EA5E9",
    borderTopRightRadius: 24,
  },
  faceGuideCornerBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 48,
    height: 48,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomColor: "#0EA5E9",
    borderLeftColor: "#0EA5E9",
    borderBottomLeftRadius: 24,
  },
  faceGuideCornerBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 48,
    height: 48,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomColor: "#0EA5E9",
    borderRightColor: "#0EA5E9",
    borderBottomRightRadius: 24,
  },
  faceGuideCornerActive: {
    borderTopColor: "#22C55E",
    borderLeftColor: "#22C55E",
    borderRightColor: "#22C55E",
    borderBottomColor: "#22C55E",
  },
  hintText: {
    position: "absolute",
    bottom: 130,
    alignSelf: "center",
    fontSize: 15,
    color: "#FFFFFF",
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  hintTextWarn: {
    backgroundColor: "rgba(190, 18, 60, 0.75)",
  },
  captureButton: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFFFFF",
  },
  captureButtonDisabled: {
    borderColor: "#94A3B8",
    backgroundColor: "rgba(148, 163, 184, 0.35)",
  },
  captureButtonInnerDisabled: {
    backgroundColor: "#94A3B8",
  },
  idleContent: {
    alignItems: "center",
    paddingHorizontal: 32,
  },
  idleText: {
    fontSize: 15,
    color: "#94A3B8",
    marginTop: 16,
    textAlign: "center",
  },
  allowButton: {
    marginTop: 24,
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  allowButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});

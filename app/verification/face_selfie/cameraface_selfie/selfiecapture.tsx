import { memo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Face } from "react-native-vision-camera-face-detector";
import { styles } from "../../../../components/verification/faceselfie_comp/selfiecapture/selfiecaptstyles";
import { BackButton, IdleScreen } from "../../../../components/verification/faceselfie_comp/selfiecapture/selfiecaptui";
import {
  LIVE_DETECTOR_OPTIONS,
  loadNativeModules,
  retryLoadModules,
  useSelfieCapture,
  type FaceDetectorModule,
  type FaceHint,
  type VisionCameraModule,
} from "../../../../components/verification/faceselfie_comp/selfiecapture/backend/selfiecaptfunc";

// Hint text for each live face-quality state (classified by evaluateFace in
// the func file). The "ok" entry matches the capture-enabled message.
const LIVE_HINT_MESSAGES: Record<FaceHint, string> = {
  ok: "Face detected — hold steady and capture",
  none: "No face detected. Center your face inside the frame",
  multiple: "Multiple faces detected — only you should be in the frame",
  "too-far": "Move closer so your face fills the frame",
  "wrong-pose": "Look straight at the camera",
  "eyes-closed": "Open your eyes and look at the camera",
};

/**
 * Full-screen face selfie capture.
 *
 * Uses react-native-vision-camera with Google ML Kit face detection
 * (replaces the deprecated ExpoFaceDetector). The shutter only works while
 * a face is detected in the live preview, and the captured photo is
 * re-checked before navigating to the review screen.
 *
 * The behavior/backend logic (native module loading, camera permissions, face
 * detection, photo capture) lives in
 * components/verification/faceselfie_comp/selfiecapture/selfiecaptfunc.tsx.
 */
export default function SelfieCaptureScreen() {
  // Bumped by the setup screen's Retry button to force a fresh loader run.
  const [, setModuleAttempt] = useState(0);

  if (Platform.OS === "web") {
    return <UnsupportedScreen />;
  }

  const { modules, error } = loadNativeModules();
  if (!modules) {
    return (
      <SetupRequiredScreen
        error={error}
        onRetry={() => {
          retryLoadModules();
          setModuleAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

  return (
    <NativeSelfieCapture
      visionCamera={modules.visionCamera}
      faceDetector={modules.faceDetector}
    />
  );
}

function UnsupportedScreen() {
  return (
    <IdleScreen
      icon="camera-outline"
      message="Face scan is only available on mobile devices."
    />
  );
}

function SetupRequiredScreen({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <IdleScreen
      icon="build-outline"
      message="The camera modules are missing from this app build. Rebuild the dev client so the native code is included: npx expo run:android (or npx expo run:ios)"
    >
      {error instanceof Error && (
        <Text style={styles.idleText} numberOfLines={4}>
          {error.message}
        </Text>
      )}

      <TouchableOpacity
        style={styles.allowButton}
        onPress={onRetry}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Retry loading the camera modules"
      >
        <Text style={styles.allowButtonText}>Retry</Text>
      </TouchableOpacity>
    </IdleScreen>
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
      {...LIVE_DETECTOR_OPTIONS}
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
  const {
    isFocused,
    device,
    hasPermission,
    canRequestPermission,
    photoOutput,
    FaceDetectorCamera,
    isCapturing,
    isFaceDetected,
    isCameraReady,
    faceHint,
    cameraError,
    handleRetryPermission,
    handleFacesDetected,
    handleCameraError,
    handleCameraReady,
    handleCameraStopped,
    handleCapture,
  } = useSelfieCapture({ visionCamera, faceDetector });

  if (!hasPermission) {
    return (
      <IdleScreen icon="camera-outline" message="Camera access is needed to scan your face">
        {canRequestPermission ? (
          <TouchableOpacity
            style={styles.allowButton}
            onPress={handleRetryPermission}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Allow camera access"
          >
            <Text style={styles.allowButtonText}>Allow Camera Access</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.idleText}>
              Please enable camera access in your device settings.
            </Text>
            <TouchableOpacity
              style={styles.allowButton}
              onPress={() => void Linking.openSettings().catch(() => {})}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Open device settings"
            >
              <Text style={styles.allowButtonText}>Open Settings</Text>
            </TouchableOpacity>
          </>
        )}
      </IdleScreen>
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

      <BackButton />

      <View style={styles.faceGuide}>
        <View style={[styles.faceGuideCornerTL, isFaceDetected && styles.faceGuideCornerActive]} />
        <View style={[styles.faceGuideCornerTR, isFaceDetected && styles.faceGuideCornerActive]} />
        <View style={[styles.faceGuideCornerBL, isFaceDetected && styles.faceGuideCornerActive]} />
        <View style={[styles.faceGuideCornerBR, isFaceDetected && styles.faceGuideCornerActive]} />
      </View>

      <Text
        style={[styles.hintText, (cameraError || !isFaceDetected) && styles.hintTextWarn]}
      >
        {cameraError ??
          (isFaceDetected
            ? LIVE_HINT_MESSAGES.ok
            : LIVE_HINT_MESSAGES[faceHint])}
      </Text>

      <TouchableOpacity
        style={[styles.captureButton, (!isFaceDetected || !isCameraReady) && styles.captureButtonDisabled]}
        onPress={handleCapture}
        disabled={!isFaceDetected || isCapturing || !isCameraReady}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Capture face scan photo"
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


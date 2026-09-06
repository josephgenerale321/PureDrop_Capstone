import { memo, useCallback, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BackButton, IdleScreen } from "../../../../components/verification/faceselfie_comp/selfiecapture/selfiecaptui";
import { styles } from "../../../../components/verification/validid/valididcapture/idcapturestyles";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  loadNativeModules,
  retryLoadModules,
  type VisionCameraModule,
} from "../../../../components/verification/faceselfie_comp/selfiecapture/backend/selfiecaptfunc";
import {
  useIdCapture,
  type IdPhotoSide,
} from "../../../../components/verification/validid/valididcapture/backend/idcapturefunc";
import ValidIdCropper from "../../../../components/verification/validid/valididcapture/valididcropper";
import CropperOldPhone from "../../../../components/verification/validid/valididcapture/cropperoldphone";

const SIDE_TITLES: Record<IdPhotoSide, string> = {
  front: "Capture the Front of your ID",
  back: "Capture the Back of your ID",
  passport: "Capture your Passport Data Page",
};

// Android 12 and below on OEM skins (Vivo Funtouch OS, Oppo ColorOS...) report
// 0/NaN PanResponder grant coordinates and synthesize spike moves, which
// teleports the crop frame during resize. Those devices get the hardened
// legacy gesture variant; everything else uses the standard cropper.
const LEGACY_ANDROID_GESTURES_MAX_API = 32; // Android 12L (API 32)
const useLegacyCropper =
  Platform.OS === "android" && Number(Platform.Version) <= LEGACY_ANDROID_GESTURES_MAX_API;
const IdCropper = useLegacyCropper ? CropperOldPhone : ValidIdCropper;

const SIDE_HINTS: Record<IdPhotoSide, string> = {
  front: "Place the front of your ID inside the frame",
  back: "Place the back of your ID inside the frame",
  passport: "Place your passport data page inside the frame",
};

/**
 * Valid ID photo capture.
 *
 * Deliberately NOT the face flow: an ID is a document, so there is no
 * face-quality gate (pose/eyes/size rules don't apply to a card). The rear
 * camera frames the document inside a landscape ID-card guide, and the
 * captured photo is handed back to the main Valid ID screen. Shared camera
 * plumbing (module loading, capture retry) comes from the same func layer the
 * face flow uses; ID-specific behavior lives in
 * components/verification/validid/idcapturefunc.tsx.
 */
export default function ValidIdCaptureScreen() {
  const params = useLocalSearchParams<{ side?: string | string[] }>();
  const sideParam = Array.isArray(params.side) ? params.side[0] : params.side;
  const side: IdPhotoSide =
    sideParam === "back" || sideParam === "passport" ? sideParam : "front";

  // Bumped by the setup screen's Retry button to force a fresh loader run.
  const [, setModuleAttempt] = useState(0);

  if (Platform.OS === "web") {
    return (
      <IdleScreen
        icon="camera-outline"
        message="Valid ID capture is only available on mobile devices."
      />
    );
  }

  const { modules, error } = loadNativeModules();
  if (!modules) {
    return (
      <IdSetupRequiredScreen
        error={error}
        onRetry={() => {
          retryLoadModules();
          setModuleAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

  return <NativeIdCapture visionCamera={modules.visionCamera} side={side} />;
}

function IdSetupRequiredScreen({
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

function NativeIdCapture({
  visionCamera,
  side,
}: {
  visionCamera: VisionCameraModule;
  side: IdPhotoSide;
}) {
  const {
    isFocused,
    device,
    hasPermission,
    canRequestPermission,
    photoOutput,
    isCapturing,
    isCameraReady,
    cameraError,
    handleRetryPermission,
    handleCameraError,
    handleCameraReady,
    handleCameraStopped,
    handleCapture,
    pendingPhoto,
    isCameraActive,
    handleCropConfirm,
    handleCropCancel,
  } = useIdCapture({ visionCamera, side });

  // Android hardware back: while the cropper is open the on-screen back
  // button is hidden (its elevation would draw it over the crop overlay), so
  // back must CANCEL the crop instead of popping the whole screen — popping
  // would throw away the just-captured photo and dump the user out of the
  // flow. Back is also swallowed while the shutter is mid-flight so a
  // capture can't be aborted half-way. Active only while this screen is
  // focused, so back navigation from other screens keeps working.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") {
        return undefined;
      }

      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (pendingPhoto) {
            handleCropCancel();
            return true;
          }
          // Swallow back while a capture is in flight; otherwise let the
          // default pop happen.
          return isCapturing;
        },
      );

      return () => {
        subscription.remove();
      };
    }, [pendingPhoto, handleCropCancel, isCapturing]),
  );

  if (!hasPermission) {
    return (
      <IdleScreen
        icon="camera-outline"
        message="Camera access is needed to capture your Valid ID"
      >
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
              onPress={() => void Linking.openSettings()}
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
      {device ? (
        <StableIdCamera
          Camera={visionCamera.Camera}
          device={device}
          isActive={isCameraActive}
          photoOutput={photoOutput}
          onPreviewStarted={handleCameraReady}
          onPreviewStopped={handleCameraStopped}
          onError={handleCameraError}
        />
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.container, styles.containerIdle]}>
            <Ionicons name="camera-outline" size={90} color="#94A3B8" />
            <Text style={styles.idleText}>No rear camera is available on this device.</Text>
          </View>
        </View>
      )}

      {/* Hidden while the cropper is open — its elevation would draw it over
          the crop overlay on Android, leaving two back buttons (X + this). */}
      {!pendingPhoto && <BackButton />}

      <Text style={styles.sideTitle}>{SIDE_TITLES[side]}</Text>

      {/* Landscape ID-card guide (no face gate — documents aren't faces) */}
      <View style={styles.idGuide}>
        <View style={styles.guideCornerTL} />
        <View style={styles.guideCornerTR} />
        <View style={styles.guideCornerBL} />
        <View style={styles.guideCornerBR} />
      </View>

      <Text style={[styles.hintText, cameraError && styles.hintTextWarn]}>
        {cameraError ?? SIDE_HINTS[side]}
      </Text>

      <TouchableOpacity
        style={[styles.captureButton, !isCameraReady && styles.captureButtonDisabled]}
        onPress={handleCapture}
        disabled={isCapturing || !isCameraReady}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Capture ${side === "passport" ? "passport" : `${side} of ID`} photo`}
        accessibilityState={{ disabled: isCapturing || !isCameraReady }}
      >
        {isCapturing ? (
          <ActivityIndicator size="small" color="#0EA5E9" />
        ) : (
          <View style={styles.captureButtonInner} />
        )}
      </TouchableOpacity>

      {/* Crop step — replaces the preview while a fresh capture is pending.
          CropperOldPhone on legacy Android OEM builds, standard otherwise. */}
      {pendingPhoto && (
        <IdCropper
          photoUri={pendingPhoto}
          sideLabel={SIDE_TITLES[side]}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </View>
  );
}

/**
 * The camera subtree, isolated in a memoized component — react-native-vision-
 * camera v5 re-configures the native session whenever the camera element
 * re-renders with new props, which can abort in-flight captures with
 * "Camera is closed.". Memoizing with only stable props prevents that
 * (same pattern as the face flow's StableFaceCamera).
 */
const StableIdCamera = memo(function StableIdCamera({
  Camera,
  device,
  isActive,
  photoOutput,
  onPreviewStarted,
  onPreviewStopped,
  onError,
}: {
  Camera: VisionCameraModule["Camera"];
  device: NonNullable<ReturnType<VisionCameraModule["useCameraDevice"]>>;
  isActive: boolean;
  photoOutput: ReturnType<VisionCameraModule["usePhotoOutput"]>;
  onPreviewStarted: () => void;
  onPreviewStopped: () => void;
  onError: (error: Error) => void;
}) {
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
      outputs={[photoOutput]}
      onPreviewStarted={onPreviewStarted}
      onPreviewStopped={onPreviewStopped}
      onError={onError}
    />
  );
});


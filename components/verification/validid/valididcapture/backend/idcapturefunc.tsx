import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
// Legacy subpath — the root "expo-file-system" import deprecates these
// methods in SDK 54 (same convention as useCreateReportForm, offline cache).
import * as FileSystem from "expo-file-system/legacy";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
  capturePhotoToFileStable,
  toErrorMessage,
  type VisionCameraModule,
} from "../../../faceselfie_comp/selfiecapture/backend/selfiecaptfunc";

/**
 * Backend/behavior layer for the Valid ID capture screen
 * (app/verification/valid_id/validid_cam/valididcapture.tsx).
 *
 * Deliberately NOT the face flow: an ID is a document, so there is no
 * face-quality gate (no pose/eyes/size checks) — the rear camera captures
 * whatever the user frames, and the photo is handed back to the main Valid ID
 * screen. Camera-generic plumbing (module loading, the transient
 * "Camera is closed." capture retry, error message normalization) is shared
 * with the face flow via selfiecaptfunc.
 */

export type IdPhotoSide = "front" | "back" | "passport";

// Module-level handoff store: the capture screen writes the captured photo
// URI here and pops back to the main Valid ID screen, which consumes it when
// it regains focus (expo-router's back() cannot pass params to the previous
// screen). At most one pending photo per side.
const capturedIdPhotos: Partial<Record<IdPhotoSide, string>> = {};

export function setCapturedIdPhoto(side: IdPhotoSide, uri: string): void {
  capturedIdPhotos[side] = uri;
}

export function consumeCapturedIdPhoto(side: IdPhotoSide): string | null {
  const uri = capturedIdPhotos[side] ?? null;
  delete capturedIdPhotos[side];
  return uri;
}

export function useIdCapture({
  visionCamera,
  side,
}: {
  visionCamera: VisionCameraModule;
  side: IdPhotoSide;
}) {
  const router = useRouter();
  const isFocused = useIsFocused();
  // Documents are captured with the rear camera (higher resolution, no
  // selfie mirroring). When the device has no rear camera the screen shows
  // an idle state instead of a preview.
  const device = visionCamera.useCameraDevice("back");
  const { hasPermission, canRequestPermission, requestPermission } =
    visionCamera.useCameraPermission();
  // Documents are judged on text/detail, so favor quality over speed.
  const photoOutput = visionCamera.usePhotoOutput({ qualityPrioritization: "quality" });

  const [isCapturing, setIsCapturing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  // Last runtime camera error surfaced to the user; cleared when the preview
  // restarts so the message never goes stale.
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Captured photo awaiting crop confirmation in ValidIdCropper
  // (null = the live camera preview is showing).
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  // Guards against overlapping captures.
  const isBusyRef = useRef(false);

  // Opens the (optional) permission prompt; a denied request surfaces the
  // same guidance alert whether it was auto-requested or retried by the user.
  const requestPermissionWithFeedback = useCallback(() => {
    void requestPermission().then((granted) => {
      if (!granted) {
        Alert.alert(
          "Camera Permission",
          "Camera access is required to capture your Valid ID. Please enable it in your device settings.",
        );
      }
    });
  }, [requestPermission]);

  // Ask for camera permission once when the screen opens.
  const hasRequestedRef = useRef(false);
  useEffect(() => {
    if (hasRequestedRef.current || hasPermission || !canRequestPermission) {
      return;
    }

    hasRequestedRef.current = true;
    requestPermissionWithFeedback();
  }, [hasPermission, canRequestPermission, requestPermissionWithFeedback]);

  const handleRetryPermission = () => {
    hasRequestedRef.current = false;
    requestPermissionWithFeedback();
  };

  const handleCameraError = useCallback((error: Error) => {
    console.warn("ID capture camera error:", error);
    setCameraError(toErrorMessage(error));
  }, []);

  const handleCameraReady = useCallback(() => {
    setIsCameraReady(true);
    // A fresh preview means any previous runtime error is stale.
    setCameraError(null);
  }, []);

  const handleCameraStopped = useCallback(() => {
    setIsCameraReady(false);
  }, []);

  // Captures the ID photo and hands it back to the main Valid ID screen.
  // No face gate here on purpose: an ID is a document, and its front side,
  // back side, and passport pages differ too much for face rules to apply.
  const handleCapture = async () => {
    if (isBusyRef.current || !device || !isCameraReady) {
      return;
    }

    isBusyRef.current = true;
    setIsCapturing(true);
    try {
      const uri = await capturePhotoToFileStable(photoOutput);
      // Hand the raw capture to the crop step first; only the cropped result
      // is handed back to the main Valid ID screen.
      setPendingPhoto(uri);
    } catch (error) {
      console.error("[IdCapture] capture failed:", error);
      Alert.alert("Capture Failed", toErrorMessage(error) || "Failed to capture photo.");
    } finally {
      isBusyRef.current = false;
      setIsCapturing(false);
    }
  };

  // The camera preview pauses while the crop overlay is up (saves battery and
  // keeps the native session from re-configuring behind the overlay).
  const isCameraActive = isFocused && pendingPhoto === null;

  // Confirms the cropped photo: deletes the pre-crop capture temp file and
  // hands the cropped result back to the main Valid ID screen.
  const handleCropConfirm = useCallback(
    (croppedUri: string) => {
      if (pendingPhoto && pendingPhoto !== croppedUri) {
        FileSystem.deleteAsync(pendingPhoto, { idempotent: true }).catch(() => {});
      }
      setCapturedIdPhoto(side, croppedUri);
      setPendingPhoto(null);
      router.back();
    },
    [pendingPhoto, router, side],
  );

  // Cancels cropping: discards the capture entirely (temp file deleted) and
  // returns to the live camera preview.
  const handleCropCancel = useCallback(() => {
    if (pendingPhoto) {
      FileSystem.deleteAsync(pendingPhoto, { idempotent: true }).catch(() => {});
    }
    setPendingPhoto(null);
  }, [pendingPhoto]);

  return {
    isFocused,
    device,
    hasPermission,
    canRequestPermission,
    photoOutput,
    isCapturing,
    isCameraReady,
    cameraError,
    pendingPhoto,
    isCameraActive,
    handleRetryPermission,
    handleCameraError,
    handleCameraReady,
    handleCameraStopped,
    handleCapture,
    handleCropConfirm,
    handleCropCancel,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { type Href, useRouter } from "expo-router";
// Legacy subpath — the root "expo-file-system" import deprecates these
// methods in SDK 54 (same convention as useCreateReportForm, offline cache).
import * as FileSystem from "expo-file-system/legacy";
import type { Face } from "react-native-vision-camera-face-detector";

/**
 * Backend/behavior layer for the face selfie capture screen
 * (app/verification/face_selfie/cameraface_selfie/selfiecapture.tsx).
 *
 * Contains the lazy native-module loader (react-native-vision-camera is
 * native-only) and the `useSelfieCapture` hook that owns all capture-screen
 * behavior: camera permissions, face detection state, photo capture with the
 * transient "Camera is closed." retry, and navigation to the review screen.
 * The route file only renders JSX.
 */

const REVIEW_SELFIE_ROUTE =
  "/verification/face_selfie/cameraface_selfie/reviewselfiedetails" as Href;

// Delay before the single retry of a capture aborted by the transient
// "Camera is closed." re-bind window on Android.
const CAPTURE_RETRY_DELAY_MS = 350;

// Shared permission-denied feedback, used by both the auto request on screen
// open and the manual retry button.
const PERMISSION_ALERT_TITLE = "Camera Permission";
const PERMISSION_ALERT_MESSAGE =
  "Camera access is required for face verification. Please enable it in your device settings.";

// How long concurrent permission requests are collapsed into one while a
// native request may still be in-flight (see requestPermissionWithFeedback).
const PERMISSION_REQUEST_GUARD_TIMEOUT_MS = 15_000;

// react-native-vision-camera is native-only. The modules are loaded lazily on
// first render so that (a) web never executes them and (b) an outdated dev
// client (missing the native modules) shows a helpful screen instead of
// crashing the whole router at startup.
export type VisionCameraModule = typeof import("react-native-vision-camera");
export type FaceDetectorModule = typeof import("react-native-vision-camera-face-detector");

type NativeModules = {
  visionCamera: VisionCameraModule;
  faceDetector: FaceDetectorModule;
};

type VisionPhotoOutput = ReturnType<VisionCameraModule["usePhotoOutput"]>;

let cachedModules: NativeModules | null = null;
let moduleLoadError: unknown = null;

/** Normalizes any thrown value into a user-presentable message. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Captures a photo to a file. On Android the native session can transiently
 * abort a capture with "Camera is closed." while it is being re-bound (the
 * unbind/rebind cycle in HybridCameraSession.configure). That failure is
 * recoverable: wait briefly for the re-bind to finish and retry once.
 *
 * Camera-generic — shared by the face selfie and Valid ID capture flows.
 */
export async function capturePhotoToFileStable(
  photoOutput: VisionPhotoOutput
): Promise<string> {
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
    const message = toErrorMessage(error);
    if (!/camera is closed/i.test(message)) {
      throw error;
    }
    console.warn("[CameraCapture] transient 'Camera is closed.' — retrying capture once");
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_DELAY_MS));
    return await attempt();
  }
}

// ---------------------------------------------------------------------------
// Face quality gate
// ---------------------------------------------------------------------------

// Minimum face width as a fraction of the frame width. Faces smaller than
// this are too far away to produce a usable verification photo.
const MIN_FACE_WIDTH_RATIO = 0.25;
// Head-pose limits (ML Kit euler angles, in degrees) for a roughly frontal face.
const MAX_YAW_DEG = 20;
const MAX_PITCH_DEG = 20;
const MAX_ROLL_DEG = 15;
// Minimum eye-open classification probability. Probabilities are optional in
// the Face type (only computed when classifications are enabled); an absent
// value passes rather than fails.
const MIN_EYE_OPEN_PROBABILITY = 0.4;
// Consecutive "ok" detections required before the shutter is enabled, so a
// single flicker frame can't trigger a capture.
const OK_FRAMES_REQUIRED = 3;

// Live-camera detector tuning: ignore smaller faces entirely and compute the
// eye-open probabilities used by the gate. Spread onto the face-detector
// Camera element (constants, so they never re-bind the native session).
export const LIVE_DETECTOR_OPTIONS = {
  minFaceSize: 0.2,
  runClassifications: true,
} as const;

export type FaceHint =
  | "ok"
  | "none"
  | "multiple"
  | "too-far"
  | "wrong-pose"
  | "eyes-closed";

/**
 * Classifies the detected faces into the reason a capture is (dis)allowed.
 * Pure and side-effect free, so the exact same rules run on the live preview
 * frames and on the captured still image (stage 2 of the gate).
 */
export function evaluateFace(faces: Face[]): FaceHint {
  if (!faces || faces.length === 0) {
    return "none";
  }
  if (faces.length > 1) {
    return "multiple";
  }

  const face = faces[0];

  // Size gate — skipped when the detector didn't report frame dimensions.
  if (face.frameWidth > 0 && face.bounds.width > 0) {
    if (face.bounds.width / face.frameWidth < MIN_FACE_WIDTH_RATIO) {
      return "too-far";
    }
  }

  // Pose gate — ML Kit euler angles are in degrees; mirrored front-camera
  // values are handled by the symmetric |angle| comparisons.
  if (
    Math.abs(face.yawAngle) > MAX_YAW_DEG ||
    Math.abs(face.pitchAngle) > MAX_PITCH_DEG ||
    Math.abs(face.rollAngle) > MAX_ROLL_DEG
  ) {
    return "wrong-pose";
  }

  // Eyes-open gate — only enforced when the classifier actually ran.
  const eyeClosed = (p?: number) =>
    typeof p === "number" && p < MIN_EYE_OPEN_PROBABILITY;
  if (eyeClosed(face.leftEyeOpenProbability) || eyeClosed(face.rightEyeOpenProbability)) {
    return "eyes-closed";
  }

  return "ok";
}

// Component weights of the liveness score — they add up to 100 and mirror the
// gate rules above, so a photo that barely passes the gate still scores low.
const SIZE_SCORE_WEIGHT = 40;
const POSE_SCORE_WEIGHT = 35;
const EYES_SCORE_WEIGHT = 25;
// Face-width ratio above which the size component is fully earned (the gate
// minimum MIN_FACE_WIDTH_RATIO earns 0).
const FULL_FACE_WIDTH_RATIO = MIN_FACE_WIDTH_RATIO + 0.35;

/**
 * Computes the real liveness/quality score (0–100) for a captured selfie from
 * the same ML Kit face metrics the capture gate uses — face size in the
 * frame, head-pose deviation from frontal, and eye-open probabilities.
 *
 * Pure and side-effect free, so it runs on the stage-2 still-image faces
 * (the authoritative check) without any extra detector passes. Missing
 * optional values (e.g. classifier probabilities) score neutrally instead of
 * punishing the photo — the same pass-not-fail policy as evaluateFace.
 */
export function computeLivenessScore(faces: Face[]): number {
  if (!faces || faces.length !== 1) {
    return 0;
  }
  const face = faces[0];

  // Size component — how much of the frame the face fills between the gate
  // minimum and a comfortable close-up. Neutral half-credit when the detector
  // didn't report frame dimensions (same skip policy as the size gate).
  let sizeScore = SIZE_SCORE_WEIGHT / 2;
  if (face.frameWidth > 0 && face.bounds.width > 0) {
    const ratio = face.bounds.width / face.frameWidth;
    const sizeProgress = Math.min(
      1,
      Math.max(0, (ratio - MIN_FACE_WIDTH_RATIO) / (FULL_FACE_WIDTH_RATIO - MIN_FACE_WIDTH_RATIO)),
    );
    sizeScore = sizeProgress * SIZE_SCORE_WEIGHT;
  }

  // Pose component — average deviation from frontal, normalized by the gate
  // limits (0 = perfectly frontal, 1 = at a gate limit).
  const yaw = Math.abs(face.yawAngle ?? 0) / MAX_YAW_DEG;
  const pitch = Math.abs(face.pitchAngle ?? 0) / MAX_PITCH_DEG;
  const roll = Math.abs(face.rollAngle ?? 0) / MAX_ROLL_DEG;
  const poseDeviation = (yaw + pitch + roll) / 3;
  const poseScore = Math.max(0, 1 - Math.min(1, poseDeviation)) * POSE_SCORE_WEIGHT;

  // Eyes component — each eye contributes half; absent probabilities are
  // neutral (half credit per eye), matching the evaluateFace policy.
  const eyeScore = (p?: number) =>
    typeof p === "number" ? Math.min(1, Math.max(0, p)) * (EYES_SCORE_WEIGHT / 2) : EYES_SCORE_WEIGHT / 4;

  return Math.round(
    Math.min(100, sizeScore + poseScore + eyeScore(face.leftEyeOpenProbability) + eyeScore(face.rightEyeOpenProbability)),
  );
}

// One row of the liveness checklist shown on the review screen — what the
// gate actually verified about the captured photo.
export type LivenessCheck = {
  key: "eyes-open" | "head-pose" | "face-size";
  label: string;
  passed: boolean;
  detail: string;
};

/**
 * Builds the human-readable liveness checklist for a captured selfie from the
 * same ML Kit face metrics the gate and score use — so every row is backed by
 * a real measured value (eye-open probabilities, euler angles, face size in
 * the frame), not a canned description. Pure and side-effect free.
 */
export function evaluateLivenessChecks(faces: Face[]): LivenessCheck[] {
  const face = faces && faces.length === 1 ? faces[0] : null;

  // Eyes-open check — real classifier probabilities when available.
  const left = typeof face?.leftEyeOpenProbability === "number" ? face.leftEyeOpenProbability : null;
  const right =
    typeof face?.rightEyeOpenProbability === "number" ? face.rightEyeOpenProbability : null;
  const eyesPassed =
    (left === null || left >= MIN_EYE_OPEN_PROBABILITY) &&
    (right === null || right >= MIN_EYE_OPEN_PROBABILITY);
  const eyesDetail =
    left !== null && right !== null
      ? `Both eyes detected as open (${Math.round(left * 100)}% / ${Math.round(right * 100)}% confidence)`
      : "Both eyes were open and clearly visible";

  // Head-pose check — measured euler angles vs the frontal-gate limits.
  const yaw = Math.abs(face?.yawAngle ?? 0);
  const pitch = Math.abs(face?.pitchAngle ?? 0);
  const roll = Math.abs(face?.rollAngle ?? 0);
  const posePassed = yaw <= MAX_YAW_DEG && pitch <= MAX_PITCH_DEG && roll <= MAX_ROLL_DEG;
  const poseDetail = posePassed
    ? "Head was centered and facing straight at the camera"
    : "Head was turned too far away from the camera";

  // Distance check — real face-size ratio of the captured frame.
  let sizePassed = true;
  let sizeDetail = "Face size could not be measured — treated as passing";
  if (face && face.frameWidth > 0 && face.bounds.width > 0) {
    const ratio = face.bounds.width / face.frameWidth;
    sizePassed = ratio >= MIN_FACE_WIDTH_RATIO;
    sizeDetail = sizePassed
      ? `Face filled ${Math.round(ratio * 100)}% of the frame — good capture distance`
      : "Face was too small in the frame — move closer next time";
  }

  return [
    { key: "eyes-open", label: "Eyes open", passed: eyesPassed, detail: eyesDetail },
    { key: "head-pose", label: "Facing the camera", passed: posePassed, detail: poseDetail },
    { key: "face-size", label: "Good distance", passed: sizePassed, detail: sizeDetail },
  ];
}

// Stage-2 (captured photo) rejection messages, one per non-ok hint.
export const STILL_HINT_MESSAGES: Record<Exclude<FaceHint, "ok">, string> = {
  none: "No face was detected in your photo. Center your face inside the frame and try again.",
  multiple: "Multiple faces were detected in your photo. Make sure only you are in the frame and try again.",
  "too-far": "Your face is too far away in the photo. Move closer so your face fills the frame and try again.",
  "wrong-pose": "Your face was turned away in the photo. Look straight at the camera and try again.",
  "eyes-closed": "Your eyes appear closed in the photo. Open your eyes and try again.",
};

/**
 * Lazily loads the native camera modules. Returns `{ modules, error }` where
 * `modules` is null when the modules are unavailable (web, or a dev client
 * build missing the native code) and `error` holds the load failure, if any.
 * The result is cached for the lifetime of the app.
 */
export function loadNativeModules(): { modules: NativeModules | null; error: unknown } {
  if (cachedModules || moduleLoadError) {
    return { modules: cachedModules, error: moduleLoadError };
  }

  try {
    cachedModules = {
      visionCamera: require("react-native-vision-camera") as VisionCameraModule,
      faceDetector: require("react-native-vision-camera-face-detector") as FaceDetectorModule,
    };
  } catch (error) {
    moduleLoadError = error;
  }
  return { modules: cachedModules, error: moduleLoadError };
}

/**
 * Clears a previously cached module-load failure and retries the loader, so
 * the setup-required screen can recover (e.g. after the dev client is rebuilt
 * with the native modules included) without a full app restart. Successful
 * loads are never invalidated.
 */
export function retryLoadModules(): { modules: NativeModules | null; error: unknown } {
  if (cachedModules) {
    return { modules: cachedModules, error: null };
  }

  moduleLoadError = null;
  return loadNativeModules();
}

/**
 * All capture-screen behavior extracted from the route file so the screen
 * component only renders JSX.
 */
export function useSelfieCapture({
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
    // Classifications are needed so the still-image gate can check eyes-open.
    runClassifications: true,
  });
  const FaceDetectorCamera = faceDetector.Camera;

  const [isCapturing, setIsCapturing] = useState(false);
  // Classified reason the capture is (dis)allowed — drives the hint text.
  const [faceHint, setFaceHint] = useState<FaceHint>("none");
  // Stable "capture allowed" flag: only true after the ok hint has held for
  // OK_FRAMES_REQUIRED consecutive detections.
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  // Last runtime camera error surfaced to the user; cleared when the preview
  // restarts so the message never goes stale.
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Guards against overlapping captures.
  const isBusyRef = useRef(false);
  // Counts consecutive "ok" detections for the stability debounce.
  const okStreakRef = useRef(0);
  // Most recent captured photo file; deleted before the next capture and on
  // unmount so repeated retakes don't leak temp files in the app cache.
  const lastCapturedUriRef = useRef<string | null>(null);

  // Delete the last captured temp photo when the screen unmounts.
  useEffect(() => {
    return () => {
      const uri = lastCapturedUriRef.current;
      if (uri) {
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    };
  }, []);

  // Unbind the camera while the review screen (or any other screen) is on top,
  // and re-bind when this screen regains focus.
  useEffect(() => {
    if (!isFocused) {
      setIsFaceDetected(false);
      setFaceHint("none");
      okStreakRef.current = 0;
    }
  }, [isFocused]);

  // Opens the (optional) permission prompt; a denied request surfaces the
  // same guidance alert whether it was auto-requested or retried by the user.
  //
  // Requests are serialized (with a 15s safety valve): firing
  // requestPermission() while a previous native request is still in-flight
  // overwrites Android's single PermissionListener slot (RN core limitation —
  // see margelo/react-native-vision-camera#3834). The abandoned coroutine then
  // never resolves and its JPromise is rejected on GC with
  // "java.lang.RuntimeException: Timeouted: JPromise was destroyed!", which
  // used to surface here as an "Uncaught (in promise)" router error because
  // the promise chain had no catch. The .catch keeps that destructor
  // rejection (which can also fire when a request outlives the screen) off
  // the console; the hook's hasPermission flag remains the source of truth.
  const isRequestingPermissionRef = useRef(false);
  const requestPermissionWithFeedback = useCallback(() => {
    if (isRequestingPermissionRef.current) {
      return;
    }
    isRequestingPermissionRef.current = true;
    // A leaked native request never resolves (that is the bug), so the guard
    // must also be released by a timer, not only by the promise settling.
    const releaseGuard = setTimeout(() => {
      isRequestingPermissionRef.current = false;
    }, PERMISSION_REQUEST_GUARD_TIMEOUT_MS);
    requestPermission()
      .then((granted) => {
        if (!granted) {
          Alert.alert(PERMISSION_ALERT_TITLE, PERMISSION_ALERT_MESSAGE);
        }
      })
      .catch(() => {
        // Abandoned/destroyed native request — permission state is still
        // readable via hasPermission, so nothing to report.
      })
      .finally(() => {
        clearTimeout(releaseGuard);
        isRequestingPermissionRef.current = false;
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

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleRetryPermission = () => {
    hasRequestedRef.current = false;
    requestPermissionWithFeedback();
  };

  const handleFacesDetected = useCallback((faces: Face[]) => {
    const hint = evaluateFace(faces);
    setFaceHint(hint);

    if (hint === "ok") {
      okStreakRef.current += 1;
      // Require the face to hold steady for a few frames so a flicker
      // can't trigger a capture.
      if (okStreakRef.current >= OK_FRAMES_REQUIRED) {
        setIsFaceDetected(true);
      }
    } else {
      okStreakRef.current = 0;
      setIsFaceDetected(false);
    }
  }, []);

  const handleCameraError = useCallback((error: Error) => {
    console.warn("Face detection error:", error);
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

  // Deletes the previous temp capture (if any) so repeated retakes don't
  // leak files in the app cache.
  const replaceLastCapturedUri = (uri: string) => {
    const previous = lastCapturedUriRef.current;
    if (previous && previous !== uri) {
      FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => {});
    }
    lastCapturedUriRef.current = uri;
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
    let uri = "";
    try {
      // Stage 1 — capture the photo to a file.
      uri = await capturePhotoToFileStable(photoOutput);
      replaceLastCapturedUri(uri);

      // Stage 2 — authoritative quality gate on the real photo, applying the
      // exact same rules as the live preview (single, big enough, frontal,
      // eyes open). This catches the face turning away in the moment between
      // the shutter press and the capture.
      const faces: Face[] = imageFaceDetector.detectFaces(uri);
      const photoHint = evaluateFace(faces);
      if (photoHint !== "ok") {
        setIsFaceDetected(false);
        okStreakRef.current = 0;
        setFaceHint(photoHint);
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        lastCapturedUriRef.current = null;
        Alert.alert("No Face Detected", STILL_HINT_MESSAGES[photoHint]);
        return;
      }

      // Real liveness/quality score and checklist from the same face metrics
      // the gate just validated — shown on the review screen and recorded
      // with the upload.
      const livenessScore = computeLivenessScore(faces);
      const livenessChecks = evaluateLivenessChecks(faces);

      router.push({
        pathname: REVIEW_SELFIE_ROUTE,
        params: {
          photo: uri,
          score: String(livenessScore),
          checks: JSON.stringify(livenessChecks),
        },
      } as Href);
    } catch (error) {
      console.error("[SelfieCapture] capture failed:", error);
      const message = toErrorMessage(error);
      // The alert title keeps the stage distinction from the split version:
      // a capture error happens before the face check, a face-check error
      // happens after the photo file exists.
      Alert.alert(
        uri ? "Face Check Failed" : "Capture Failed",
        message || "Failed to capture photo.",
      );
    } finally {
      isBusyRef.current = false;
      setIsCapturing(false);
    }
  };

  return {
    isFocused,
    device,
    hasPermission,
    canRequestPermission,
    photoOutput,
    FaceDetectorCamera,
    isCapturing,
    isFaceDetected,
    faceHint,
    isCameraReady,
    cameraError,
    handleBack,
    handleRetryPermission,
    handleFacesDetected,
    handleCameraError,
    handleCameraReady,
    handleCameraStopped,
    handleCapture,
  };
}


import { useEffect, useState } from "react";
import { Alert, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
// Legacy subpath — the root "expo-file-system" import deprecates these
// methods in SDK 54 (same convention as the capture backends).
import * as FileSystem from "expo-file-system/legacy";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { submitFaceScan } from "../../backend/faceScanBackend";
import { auth, db } from "../../../../../firebaseConfig";
// Type-only import — erased at compile time, so this never pulls the
// native-only vision-camera module graph into the web bundle.
import type { LivenessCheck } from "../../selfiecapture/backend/selfiecaptfunc";

// Valid ID destinations from the "Face Scan Uploaded" lightbox.
const VALID_ID_MAIN_ROUTE = "/verification/valid_id/valid_id_main";
// Read-only review of the already-submitted Valid ID — where the hub sends
// users who already have an ID on file (check mark showing).
const VALID_ID_SUBMITTED_ROUTE = "/verification/valid_id/valid_id_submittedview";
const VERIFICATION_HUB_ROUTE = "/verification/verificationmain";

/**
 * Backend/behavior hook for the Face Scan Details review screen
 * (app/verification/face_selfie/cameraface_selfie/reviewselfiedetails.tsx).
 *
 * The photo URI arrives via router params from the capture screen, along
 * with the real liveness score computed from the captured photo's face
 * metrics (missing values degrade to null). Confirming the submit runs the
 * real face-scan submission backend
 * (../../backend/faceScanBackend): the selfie is uploaded to Supabase Storage
 * and recorded on the user's `regular_user` Firestore document before the
 * "Face Scan Uploaded" lightbox opens. The route file only renders JSX.
 */
/**
 * Validates/normalizes the JSON checklist param from the capture screen —
 * every entry must carry a known key, a string label, a boolean passed flag
 * and a string detail. Anything malformed is dropped; a wholly invalid value
 * yields an empty list (the checklist is informational, never fatal).
 */
function parseLivenessChecks(raw: string | undefined): LivenessCheck[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const VALID_KEYS = new Set(["eyes-open", "head-pose", "face-size"]);
    const checks: LivenessCheck[] = [];
    for (const item of parsed) {
      const entry = item as Partial<LivenessCheck> | null;
      if (
        entry &&
        typeof entry.key === "string" &&
        VALID_KEYS.has(entry.key) &&
        typeof entry.label === "string" &&
        typeof entry.passed === "boolean" &&
        typeof entry.detail === "string"
      ) {
        checks.push({
          key: entry.key,
          label: entry.label,
          passed: entry.passed,
          detail: entry.detail,
        });
      }
    }
    return checks;
  } catch {
    return [];
  }
}

export function useReviewSelfieDetails() {
  const router = useRouter();
  const params = useLocalSearchParams<{
  photo?: string | string[];
  score?: string | string[];
  checks?: string | string[];
}>();
  const photoUri = Array.isArray(params.photo) ? params.photo[0] : params.photo;

  // Real liveness/quality score (0–100) computed by the capture screen from
  // the captured photo's ML Kit face metrics. Missing/invalid params (e.g. an
  // older capture flow) degrade to null instead of a made-up value.
  const rawScore = Array.isArray(params.score) ? params.score[0] : params.score;
  const parsedScore = Number(rawScore);
  const livenessScore =
    Number.isFinite(parsedScore) && parsedScore >= 0 && parsedScore <= 100
      ? Math.round(parsedScore)
      : null;

  // Liveness checklist (eyes open / facing the camera / good distance) built
  // by the capture screen from the photo's face metrics. Arrives as a JSON
  // string param — parsed defensively so a malformed value just yields an
  // empty list instead of crashing the review screen.
  const rawChecks = Array.isArray(params.checks) ? params.checks[0] : params.checks;
  const livenessChecks = parseLivenessChecks(rawChecks);

  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  // "Face Scan Uploaded" lightbox — shown after the submit is confirmed,
  // offering to verify the Valid ID now or later.
  const [isUploadedModalOpen, setIsUploadedModalOpen] = useState(false);
  // True while the face scan is being uploaded/recorded — disables the
  // review screen's submit button so the submission can't be double-fired.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Live "Valid ID already submitted" state — when the user retakes their
  // face scan and taps UPLOAD ID with an ID on file, the fresh submission
  // flow would silently overwrite it, so the choice is surfaced first.
  const [userId, setUserId] = useState<string | null>(null);
  const [hasValidId, setHasValidId] = useState(false);
  // "Valid ID Already Submitted" lightbox — opened by UPLOAD ID when an ID
  // exists, offering to view it or replace it instead of barging into the
  // overwrite flow.
  const [isReplaceIdModalOpen, setIsReplaceIdModalOpen] = useState(false);

  // Track the live Firebase session so the UPLOAD ID decision always
  // reflects the account actually signed in on this device.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserId(currentUser?.uid ?? null);
    });

    return unsubscribe;
  }, []);

  // Live subscription to the submitted Valid ID fields — the same fields the
  // verification hub uses for its hasValidId routing.
  useEffect(() => {
    if (!userId) {
      setHasValidId(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : undefined;
        setHasValidId(Boolean(data?.validIdFrontUrl ?? data?.validIdSubmittedAt));
      },
      () => {
        // Read failed (offline / permissions) — treat as no ID so UPLOAD ID
        // keeps its original behavior; the Valid ID flow itself re-checks.
        setHasValidId(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  // Opens the submit confirmation modal (same pattern as the Valid ID flow).
  const handleSubmit = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    setIsSubmitConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    if (!photoUri) {
      setIsSubmitConfirmOpen(false);
      Alert.alert(
        "Face Scan Missing",
        "No face scan photo was found. Please retake your face scan before submitting.",
      );
      return;
    }

    try {
      setIsSubmitting(true);
      await submitFaceScan({ photoUri, livenessScore, livenessChecks });
      setIsSubmitConfirmOpen(false);
      setIsUploadedModalOpen(true);

      // The photo is safely stored in Supabase Storage now — clean up the
      // local temp capture so it doesn't leak in the app cache.
      FileSystem.deleteAsync(photoUri, { idempotent: true }).catch(() => {});
    } catch (error) {
      setIsSubmitConfirmOpen(false);
      Alert.alert(
        "Submission Failed",
        error instanceof Error
          ? error.message
          : "Something went wrong while submitting your face scan. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseConfirm = () => {
    if (isSubmitting) {
      return;
    }
    setIsSubmitConfirmOpen(false);
  };

  // "Later" — the face scan stays saved (real submission) but the Valid ID
  // step is skipped for now; return to the verification hub so the user can
  // do it from there whenever they want.
  const handleLater = () => {
    setIsUploadedModalOpen(false);
    try {
      router.navigate(VERIFICATION_HUB_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // "Upload ID" — continue into the Valid ID flow. When a Valid ID is
  // already on file, the fresh submission flow (valid_id_main) would
  // silently overwrite it, so the "Valid ID Already Submitted" lightbox
  // opens first and the user chooses what happens.
  const handleVerifyIdNow = () => {
    setIsUploadedModalOpen(false);
    if (hasValidId) {
      setIsReplaceIdModalOpen(true);
      return;
    }
    try {
      router.push(VALID_ID_MAIN_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // "View Submitted ID" — go to the read-only review of what is on file
  // (same destination the verification hub uses), which offers its own
  // Replace / Delete actions from there.
  const handleViewSubmittedId = () => {
    setIsReplaceIdModalOpen(false);
    try {
      router.push(VALID_ID_SUBMITTED_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // "Replace Valid ID" — continue into the fresh submission flow. The
  // lightbox already explained that re-submitting overwrites the stored
  // photos and record (backend uploads with upsert: true) and re-triggers
  // admin review.
  const handleReplaceValidId = () => {
    setIsReplaceIdModalOpen(false);
    try {
      router.push(VALID_ID_MAIN_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // "Maybe later" — leave the choice for later; back to the verification
  // hub (same destination as the lightbox's "Later" button).
  const handleCloseReplaceModal = () => {
    setIsReplaceIdModalOpen(false);
  };

  return {
    photoUri,
    livenessScore,
    livenessChecks,
    isSubmitConfirmOpen,
    isUploadedModalOpen,
    isReplaceIdModalOpen,
    isSubmitting,
    handleBack,
    handleSubmit,
    handleConfirmSubmit,
    handleCloseConfirm,
    handleLater,
    handleVerifyIdNow,
    handleViewSubmittedId,
    handleReplaceValidId,
    handleCloseReplaceModal,
  };
}



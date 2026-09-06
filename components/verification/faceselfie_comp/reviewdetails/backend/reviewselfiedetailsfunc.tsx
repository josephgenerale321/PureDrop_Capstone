import { useState } from "react";
import { Alert, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
// Legacy subpath — the root "expo-file-system" import deprecates these
// methods in SDK 54 (same convention as the capture backends).
import * as FileSystem from "expo-file-system/legacy";
import { submitFaceScan } from "../../backend/faceScanBackend";

/**
 * Backend/behavior hook for the Face Scan Details review screen
 * (app/verification/face_selfie/cameraface_selfie/reviewselfiedetails.tsx).
 *
 * The photo URI arrives via router params from the capture screen. The score
 * is a mockup until the real face-scan backend provides a confidence score.
 * Confirming the submit runs the real face-scan submission backend
 * (../../backend/faceScanBackend): the selfie is uploaded to Supabase Storage
 * and recorded on the user's `regular_user` Firestore document before the
 * "Face Scan Uploaded" lightbox opens. The route file only renders JSX.
 */
export function useReviewSelfieDetails() {
  const router = useRouter();
  const params = useLocalSearchParams<{ photo?: string | string[] }>();
  const photoUri = Array.isArray(params.photo) ? params.photo[0] : params.photo;

  // Mockup score — the real face-scan confidence score will be wired up later.
  const mockScore = "92%";

  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  // "Face Scan Uploaded" lightbox — shown after the submit is confirmed,
  // offering to verify the Valid ID now or later.
  const [isUploadedModalOpen, setIsUploadedModalOpen] = useState(false);
  // True while the face scan is being uploaded/recorded — disables the
  // review screen's submit button so the submission can't be double-fired.
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await submitFaceScan({ photoUri });
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
    router.navigate("/verification/verificationmain");
  };

  // "Upload ID" — continue straight into the Valid ID flow.
  const handleVerifyIdNow = () => {
    setIsUploadedModalOpen(false);
    router.push("/verification/valid_id/valid_id_main");
  };

  return {
    photoUri,
    mockScore,
    isSubmitConfirmOpen,
    isUploadedModalOpen,
    isSubmitting,
    handleBack,
    handleSubmit,
    handleConfirmSubmit,
    handleCloseConfirm,
    handleLater,
    handleVerifyIdNow,
  };
}



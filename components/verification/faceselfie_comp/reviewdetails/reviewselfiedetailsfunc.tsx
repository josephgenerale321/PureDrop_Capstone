import { useState } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";

/**
 * Backend/behavior hook for the Face Scan Details review screen
 * (app/verification/face_selfie/cameraface_selfie/reviewselfiedetails.tsx).
 *
 * The photo URI arrives via router params from the capture screen. The score
 * is a mockup until the real face-scan backend provides a confidence score.
 * The route file only renders JSX.
 */
export function useReviewSelfieDetails() {
  const router = useRouter();
  const params = useLocalSearchParams<{ photo?: string | string[] }>();
  const photoUri = Array.isArray(params.photo) ? params.photo[0] : params.photo;

  // Mockup score — the real face-scan confidence score will be wired up later.
  const mockScore = "92%";

  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  // "Face Scan Uploaded" lightbox — shown after the (mockup) submit is
  // confirmed, offering to verify the Valid ID now or later.
  const [isUploadedModalOpen, setIsUploadedModalOpen] = useState(false);

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

  const handleConfirmSubmit = () => {
    setIsSubmitConfirmOpen(false);

    // Mockup — the real face-scan submission will be wired up later. For now
    // the submit counts as an upload and opens the "Valid ID now or later?"
    // lightbox instead of a backend call.
    setIsUploadedModalOpen(true);
  };

  const handleCloseConfirm = () => {
    setIsSubmitConfirmOpen(false);
  };

  // "Later" — the face scan stays saved (mockup) but the Valid ID step is
  // skipped for now; return to the verification hub so the user can do it
  // from there whenever they want.
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
    handleBack,
    handleSubmit,
    handleConfirmSubmit,
    handleCloseConfirm,
    handleLater,
    handleVerifyIdNow,
  };
}


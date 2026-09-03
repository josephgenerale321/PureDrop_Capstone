import { useState } from "react";
import { Alert, Platform } from "react-native";
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

    // Mockup — the real face-scan submission will be wired up later.
    Alert.alert("Mockup", "Face scan submission is not implemented yet.");
  };

  const handleCloseConfirm = () => {
    setIsSubmitConfirmOpen(false);
  };

  return {
    photoUri,
    mockScore,
    isSubmitConfirmOpen,
    handleBack,
    handleSubmit,
    handleConfirmSubmit,
    handleCloseConfirm,
  };
}


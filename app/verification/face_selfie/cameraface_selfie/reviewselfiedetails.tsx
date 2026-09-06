import {
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../../../../components/verification/faceselfie_comp/reviewdetails/reviewselfiedetailsstyles";
import { useReviewSelfieDetails } from "../../../../components/verification/faceselfie_comp/reviewdetails/backend/reviewselfiedetailsfunc";

/**
 * Face Scan Details — review the captured selfie before submitting.
 *
 * The photo URI arrives via router params from the capture screen. The score
 * is a mockup until the real face-scan backend provides a confidence score.
 */
export default function ReviewSelfieDetailsScreen() {
  const {
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
  } = useReviewSelfieDetails();

  return (
    <>
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Face Scan Details</Text>

          {/* Captured selfie preview — falls back to a placeholder when missing */}
          <View style={styles.previewWrap}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons name="person-circle-outline" size={48} color="#CBD5E1" />
                <Text style={styles.previewPlaceholderText}>Photo preview appears here</Text>
              </View>
            )}
          </View>

          {/* Face-scan score (mockup until the backend provides the real score) */}
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Score</Text>
            <Text style={styles.scoreValue}>{mockScore}</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Submit your face scan"
            accessibilityState={{ disabled: isSubmitting }}
          >
            <Text style={styles.submitButtonText}>{isSubmitting ? "Submitting..." : "Submit"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {isSubmitConfirmOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Submit Face Scan?</Text>
            <Text style={styles.confirmMessage}>
              Please double check your face scan before you submit. You won&apos;t be able to edit
              it after submission.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleCloseConfirm}
                activeOpacity={0.8}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Go back without submitting"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  GO BACK
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleConfirmSubmit}
                activeOpacity={0.8}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Confirm and submit your face scan"
              >
                <Text style={styles.confirmButtonText}>
                  {isSubmitting ? "SUBMITTING..." : "SUBMIT"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* "Face Scan Uploaded" lightbox (mockup) — the face scan counts as
          saved; the user can verify their Valid ID now or pick Later. */}
      {isUploadedModalOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.uploadedIconWrap}>
              <Ionicons name="checkmark-circle" size={40} color="#16A34A" />
            </View>

            <Text style={styles.confirmTitle}>Face Scan Uploaded</Text>
            <Text style={styles.confirmMessage}>
              Your face scan has been saved. Verify your Valid ID now to complete your
              identity verification, or do it later.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleLater}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Skip the Valid ID for now"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  LATER
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleVerifyIdNow}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Verify your Valid ID now"
              >
                <Text style={styles.confirmButtonText}>UPLOAD ID</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </>
  );
}



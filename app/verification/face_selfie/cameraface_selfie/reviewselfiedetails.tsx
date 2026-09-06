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
 * The photo URI and liveness score arrive via router params from the capture
 * screen. The score is computed from the captured photo's real face metrics
 * (size, pose, eye-open probabilities) — it shows a neutral placeholder when
 * it is missing.
 */
export default function ReviewSelfieDetailsScreen() {
  const {
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

          {/* Real liveness score — computed from the captured photo's face
              metrics; neutral placeholder when it is missing. */}
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Liveness Score</Text>
            <Text style={styles.scoreValue}>
              {livenessScore !== null ? `${livenessScore}%` : "—"}
            </Text>
          </View>

          {/* Liveness checklist — what the capture gate verified about the
              photo, each row backed by a real measured value. Hidden when the
              checklist is missing (older capture flows). */}
          {livenessChecks.length > 0 && (
            <View style={styles.checklistCard}>
              <Text style={styles.checklistHeading}>What was checked</Text>
              {livenessChecks.map((check) => (
                <View key={check.key} style={styles.checkRow}>
                  <Ionicons
                    name={check.passed ? "checkmark-circle" : "close-circle"}
                    size={18}
                    color={check.passed ? "#16A34A" : "#DC2626"}
                  />
                  <View style={styles.checkTextWrap}>
                    <Text style={styles.checkLabel}>{check.label}</Text>
                    <Text style={styles.checkDetail}>{check.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
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
              Please double check your face scan before you submit. You can retake or
              delete it later from the Face Recognition screen.
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

      {/* "Valid ID Already Submitted" lightbox — opened when the user taps
          UPLOAD ID with a Valid ID already on file (e.g. after retaking
          their face scan): the fresh submission flow would silently
          overwrite it, so the choice is surfaced first. */}
      {isReplaceIdModalOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.uploadedIconWrap}>
              <Ionicons name="id-card-outline" size={36} color="#0EA5E9" />
            </View>

            <Text style={styles.confirmTitle}>Valid ID Already Submitted</Text>
            <Text style={styles.confirmMessage}>
              Your Valid ID is already on file. You can view the submitted ID, or
              replace it with a new submission — replacing will overwrite the
              stored photos and it will be reviewed again by an admin.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleViewSubmittedId}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="View your submitted Valid ID"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  VIEW MY ID
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleReplaceValidId}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Replace your submitted Valid ID"
              >
                <Text style={styles.confirmButtonText}>REPLACE ID</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={handleCloseReplaceModal}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Decide later"
            >
              <Text style={styles.modalCancelButtonText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}



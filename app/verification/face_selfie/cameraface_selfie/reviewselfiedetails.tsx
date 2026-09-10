import { useState } from "react";
import {
  Image,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../../../../components/verification/faceselfie_comp/reviewdetails/reviewselfiedetailsstyles";
import { useReviewSelfieDetails } from "../../../../components/verification/faceselfie_comp/reviewdetails/backend/reviewselfiedetailsfunc";
import useVerificationDecisionWatcher from "../../../../components/verification/backend/useVerificationDecisionWatcher";
import ZoomablePhoto from "../../../../components/verification/photozoom/ZoomablePhoto";

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
    isFaceRejected,
    rejectionReason,
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
  // Realtime admin decision watcher — see useVerificationDecisionWatcher:
  // reacts to approve/reject decisions made in the admin panel while the user
  // is on this screen (deduplicated across all stacked verification screens).
  useVerificationDecisionWatcher();
  // Full-screen zoomable viewer for the captured selfie (null/closed otherwise).
  const [isPhotoViewerOpen, setIsPhotoViewerOpen] = useState(false);

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

          {/* Captured selfie preview — falls back to a placeholder when missing.
              Tapping the photo opens the fullscreen zoomable viewer.
              When the admin rejected the face scan, a red ✕ badge pins to the
              preview corner and the reason shows in the banner underneath. */}
          <TouchableOpacity
            style={[styles.previewWrap, isFaceRejected && styles.previewWrapRejected]}
            onPress={() => setIsPhotoViewerOpen(true)}
            activeOpacity={photoUri ? 0.85 : 1}
            disabled={!photoUri}
            accessibilityRole={photoUri ? "button" : "text"}
            accessibilityLabel={
              photoUri
                ? "View your captured selfie fullscreen. Pinch or double-tap to zoom."
                : "Photo preview appears here"
            }
          >
            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
                <View style={styles.previewZoomHint} pointerEvents="none">
                  <Ionicons name="expand-outline" size={18} color="#FFFFFF" />
                </View>
              </>
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons name="person-circle-outline" size={48} color="#CBD5E1" />
                <Text style={styles.previewPlaceholderText}>Photo preview appears here</Text>
              </View>
            )}
            {isFaceRejected && (
              <View
                style={styles.rejectionBadge}
                accessibilityRole="image"
                accessibilityLabel="Face scan rejected by admin"
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </View>
            )}
          </TouchableOpacity>

          {isFaceRejected && (
            <View style={styles.rejectionBanner}>
              <Ionicons name="close-circle" size={18} color="#DC2626" />
              <Text style={styles.rejectionBannerText}>
                Face scan rejected{rejectionReason ? `: ${rejectionReason}` : " — please retake and resubmit."}
              </Text>
            </View>
          )}

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
        <Modal
          transparent
          animationType="fade"
          onRequestClose={handleCloseConfirm}
        >
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
        </Modal>
      )}

      {/* "Face Scan Uploaded" lightbox (mockup) — the face scan counts as
          saved; the user can verify their Valid ID now or pick Later. Android
          hardware back dismisses it the same way "Later" does: hub. */}
      {isUploadedModalOpen && (
        <Modal transparent animationType="fade" onRequestClose={handleLater}>
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
        </Modal>
      )}

      {/* "Valid ID Already Submitted" lightbox — opened when the user taps
          UPLOAD ID with a Valid ID already on file (e.g. after retaking
          their face scan): the fresh submission flow would silently
          overwrite it, so the choice is surfaced first. Android hardware
          back dismisses it the same way "Maybe later" does. */}
      {isReplaceIdModalOpen && (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={handleCloseReplaceModal}
        >
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
        </Modal>
      )}

      {/* Full-screen zoomable viewer for the captured selfie — same black
          lightbox look as the submitted Valid ID viewer. Android hardware
          back dismisses it without touching any of the confirm modals. */}
      <Modal
        visible={isPhotoViewerOpen && !!photoUri}
        transparent
        animationType="fade"
        onRequestClose={() => setIsPhotoViewerOpen(false)}
      >
        <SafeAreaView style={styles.photoViewerOverlay}>
          <View style={styles.photoViewerHeader}>
            <TouchableOpacity
              style={styles.photoViewerCloseButton}
              onPress={() => setIsPhotoViewerOpen(false)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Close selfie preview"
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.photoViewerTitle}>Captured selfie</Text>
            <Text style={styles.photoViewerHint}>Pinch or double-tap to zoom</Text>
          </View>

          <View style={styles.photoViewerImageWrap}>
            {photoUri && (
              <ZoomablePhoto
                key={photoUri}
                uri={photoUri}
                accessibilityLabel="Your captured selfie. Pinch or double-tap to zoom."
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}



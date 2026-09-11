import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../../../components/verification/validid/valididstyles";
import { deleteSubmittedValidId } from "../../../components/verification/validid/backend/validIdBackend";
import { auth, db } from "../../../firebaseConfig";
import useNavigateOnce from "../../../components/verification/backend/useNavigateOnce";
import useVerificationDecisionWatcher from "../../../components/verification/backend/useVerificationDecisionWatcher";
import ZoomablePhoto from "../../../components/verification/photozoom/ZoomablePhoto";

// Where the user lands when backing out of the submitted-ID review.
const BACK_ROUTE = "/verification/verificationmain" as Href;

// After a delete the user lands on the fresh submission flow (valid_id_main):
// there is nothing left to pre-fill, so they submit a brand-new ID.
const VALID_ID_MAIN_ROUTE = "/verification/valid_id/valid_id_main" as Href;

// "Replace Valid ID" opens the pre-filled edit screen (valid_id_editmain) so
// the already-submitted ID type and photos are shown and can be kept or
// retaken. Re-saving overwrites the stored photos and record (the backend
// uploads with upsert: true) and re-triggers admin review — no delete first.
const VALID_ID_EDIT_ROUTE = "/verification/valid_id/valid_id_editmain" as Href;

// Passport is a booklet — its data page is stored in the "front" slot, so a
// single box is shown for it instead of the front/back pair.
const PASSPORT_ID_TYPE = "Passport";

type SubmittedIdData = {
  idType: string | null;
  frontUrl: string | null;
  backUrl: string | null;
};

/**
 * Submitted Valid ID review screen — a read-only mirror of the Valid ID
 * submission screen (valid_id_main.tsx): same layout and shared styles, but
 * the ID type selector and photo boxes are non-interactive and show what was
 * actually submitted (stored on the user's `regular_user` document by the
 * Valid ID backend). Tapping a photo opens the full-screen lightbox.
 */
export default function ValidIdSubmittedViewScreen() {
  const router = useRouter();
  // Realtime admin decision watcher — see useVerificationDecisionWatcher:
  // reacts to approve/reject decisions made in the admin panel while the user
  // is on this screen (deduplicated across all stacked verification screens).
  useVerificationDecisionWatcher();
  const navigateOnce = useNavigateOnce();
  const [userId, setUserId] = useState<string | null>(null);
  // True until the first snapshot for the signed-in account arrives — keeps
  // the boxes as neutral gray placeholders instead of "unavailable" hints.
  const [isLoading, setIsLoading] = useState(true);
  const [submitted, setSubmitted] = useState<SubmittedIdData>({
    idType: null,
    frontUrl: null,
    backUrl: null,
  });
  // Photo shown in the full-screen lightbox (null = closed).
  const [lightbox, setLightbox] = useState<{ label: string; uri: string } | null>(null);
  // Live admin-rejection state — drives the red ✕ on the submitted photo boxes
  // when the admin rejected the Valid ID (same source as the verification hub:
  // verificationStatus "rejected" + rejectionTarget "valid_id" / "both";
  // a missing target on a legacy row behaves as "both").
  const [isIdRejected, setIsIdRejected] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  // Delete confirmation lightbox + in-flight flag (disables the buttons so
  // the delete can't be double-fired).
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Track the live Firebase session so the review always reflects the account
  // that is actually signed in on this device.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserId(currentUser?.uid ?? null);
    });

    return unsubscribe;
  }, []);

  // Live subscription to the submitted Valid ID fields — updates instantly if
  // the user re-submits a new ID from the submission screen.
  useEffect(() => {
    if (!userId) {
      setSubmitted({ idType: null, frontUrl: null, backUrl: null });
      setIsLoading(false);
      setIsIdRejected(false);
      setRejectionReason(null);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : undefined;
        setSubmitted({
          idType: typeof data?.validIdType === "string" ? data.validIdType : null,
          frontUrl:
            typeof data?.validIdFrontUrl === "string" ? data.validIdFrontUrl : null,
          backUrl: typeof data?.validIdBackUrl === "string" ? data.validIdBackUrl : null,
        });
        setIsLoading(false);
        // Same rejection source as the verification hub
        // (verificationmain.tsx): a "rejected" status whose target covers the
        // Valid ID shows the red ✕ on the submitted photo boxes.
        const status = String(data?.verificationStatus ?? "");
        const target = data?.rejectionTarget;
        const idRejected =
          status === "rejected" &&
          (target === "valid_id" || target === "both" || target == null);
        setIsIdRejected(idRejected);
        const reason = data?.rejectionReason;
        setRejectionReason(
          idRejected && typeof reason === "string" && reason.length > 0
            ? reason
            : null,
        );
      },
      () => {
        // Read failed (offline / permissions) — show the empty state.
        setSubmitted({ idType: null, frontUrl: null, backUrl: null });
        setIsLoading(false);
        setIsIdRejected(false);
        setRejectionReason(null);
      },
    );

    return unsubscribe;
  }, [userId]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(BACK_ROUTE);
    }
  };

  const isPassport = submitted.idType === PASSPORT_ID_TYPE;

  // Edit / Delete actions only make sense when a submission actually exists.
  const showActions = !isLoading && Boolean(submitted.idType);

  // "Replace Valid ID" — the user already has a submission on file, so show
  // an alert explaining what replacing means. Confirming opens the pre-filled
  // edit screen (valid_id_editmain), where the submitted ID type and photos
  // are shown and can be kept or retaken; re-saving overwrites the stored
  // photos and record and re-triggers admin review.
  const handleReplace = () => {
    Alert.alert(
      "Valid ID Already Submitted",
      "You have already submitted your Valid ID. You can keep the submitted photos or retake them — saving will replace the stored photos and ID type, and it will be reviewed again by an admin.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Replace Now",
          onPress: () => navigateOnce(VALID_ID_EDIT_ROUTE),
        },
      ],
    );
  };

  const handleDeletePress = () => {
    setIsDeleteConfirmOpen(true);
  };

  // Confirmed delete — runs the backend (storage cleanup + Firestore field
  // clearing + status revert), then moves the user onto the fresh submission
  // flow (valid_id_main) so they can submit a new ID right away.
  const handleConfirmDelete = async () => {
    if (isDeleting) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteSubmittedValidId();
      setIsDeleteConfirmOpen(false);
      Alert.alert(
        "Valid ID Deleted",
        "Your submitted Valid ID has been removed. Please submit a new one to continue your verification.",
        [{ text: "OK", onPress: () => router.replace(VALID_ID_MAIN_ROUTE) }],
      );
    } catch (error) {
      setIsDeleteConfirmOpen(false);
      Alert.alert(
        "Delete Failed",
        error instanceof Error
          ? error.message
          : "Something went wrong while deleting your Valid ID. Please try again.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCloseDeleteConfirm = () => {
    if (isDeleting) {
      return;
    }
    setIsDeleteConfirmOpen(false);
  };

  return (
    <>
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Review your Valid ID</Text>

          {/* Read-only ID type selector — shows the submitted ID type; no
              chevron/dropdown because it cannot be changed here. */}
          <View
            style={styles.dropdownSelector}
            accessibilityRole="text"
            accessibilityLabel={`Submitted Valid ID type: ${submitted.idType ?? "not submitted"}`}
          >
            <Text
              style={[
                styles.dropdownSelectorText,
                !submitted.idType && styles.dropdownSelectorPlaceholder,
              ]}
            >
              {submitted.idType ?? "Select"}
            </Text>
          </View>

          {isPassport ? (
            // Passport: the data page doubles as the "front" attachment.
            <SubmittedPhotoBox
              label="Passport"
              photoUri={submitted.frontUrl}
              isLoading={isLoading}
              isRejected={isIdRejected}
              onPress={() => {
                if (submitted.frontUrl) {
                  setLightbox({ label: "Passport", uri: submitted.frontUrl });
                }
              }}
            />
          ) : (
            <>
              {/* Front ID photo */}
              <SubmittedPhotoBox
                label="Front"
                photoUri={submitted.frontUrl}
                isLoading={isLoading}
                isRejected={isIdRejected}
                onPress={() => {
                  if (submitted.frontUrl) {
                    setLightbox({ label: "Front", uri: submitted.frontUrl });
                  }
                }}
              />

              {/* Back ID photo */}
              <SubmittedPhotoBox
                label="Back"
                photoUri={submitted.backUrl}
                isLoading={isLoading}
                isRejected={isIdRejected}
                onPress={() => {
                  if (submitted.backUrl) {
                    setLightbox({ label: "Back", uri: submitted.backUrl });
                  }
                }}
              />
            </>
          )}

          {/* Admin-rejection banner — shows the red ✕ context + reason when
              the admin rejected the Valid ID attachment. */}
          {isIdRejected && (
            <View style={styles.rejectionBanner}>
              <Ionicons name="close-circle" size={18} color="#DC2626" />
              <Text style={styles.rejectionBannerText}>
                Valid ID rejected{rejectionReason ? `: ${rejectionReason}` : " — please replace it and resubmit."}
              </Text>
            </View>
          )}

          {/* Edit / Delete actions — only when a submission exists. */}
          {showActions && (
            <View style={styles.submittedActionsWrap}>
              <TouchableOpacity
                style={[styles.actionButton, styles.replaceButton]}
                onPress={handleReplace}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Replace your submitted Valid ID"
              >
                <Ionicons name="create-outline" size={18} color="#FFFFFF" />
                <Text style={styles.confirmButtonText}>Replace Valid ID</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={handleDeletePress}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Delete your submitted Valid ID"
              >
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text style={[styles.confirmButtonText, styles.deleteButtonText]}>
                  Delete Submission
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Delete confirmation lightbox — same pattern as the back-confirm
          lightbox on the verification hub. */}
      <Modal
        visible={isDeleteConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCloseDeleteConfirm}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Delete Valid ID?</Text>
            <Text style={styles.confirmMessage}>
              Your submitted Valid ID photos will be permanently removed. You can submit
              a new one anytime.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleCloseDeleteConfirm}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Keep your submitted Valid ID"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  CANCEL
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmDeleteButton]}
                onPress={handleConfirmDelete}
                activeOpacity={0.8}
                disabled={isDeleting}
                accessibilityRole="button"
                accessibilityLabel="Confirm deleting your submitted Valid ID"
              >
                <Text style={styles.confirmButtonText}>DELETE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full-screen photo lightbox for the submitted Valid ID photo. */}
      <Modal
        visible={lightbox !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <SafeAreaView style={styles.lightboxOverlay}>
          <View style={styles.lightboxHeader}>
            <TouchableOpacity
              style={styles.lightboxCloseButton}
              onPress={() => setLightbox(null)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Close image preview"
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.lightboxTitle}>{lightbox?.label ?? ""} photo</Text>
          </View>

          <View style={styles.lightboxImageWrap}>
            {lightbox && (
              <ZoomablePhoto
                key={lightbox.uri}
                uri={lightbox.uri}
                showPinchHint={false}
                accessibilityLabel={`${lightbox.label} photo of your Valid ID. Pinch or double-tap to zoom.`}
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

type SubmittedPhotoBoxProps = {
  label: string;
  /** Submitted photo URL from Supabase Storage (null = not available). */
  photoUri: string | null;
  /** True until the first Firestore snapshot arrives — shows a neutral box. */
  isLoading: boolean;
  /** True when the admin rejected the Valid ID — swaps the green check for a red ✕. */
  isRejected?: boolean;
  onPress: () => void;
};

/**
 * Read-only counterpart of IdPhotoBox — same box geometry and header, but it
 * only previews the submitted photo (green check, no attach/retake actions).
 * When the admin rejects the Valid ID, the header check swaps to a red ✕ and
 * the box border turns red so it matches the hub's rejection language.
 */
function SubmittedPhotoBox({ label, photoUri, isLoading, isRejected = false, onPress }: SubmittedPhotoBoxProps) {
  return (
    <TouchableOpacity
      style={[styles.photoBox, styles.photoBoxAttached, isRejected && styles.photoBoxRejected]}
      onPress={onPress}
      activeOpacity={photoUri ? 0.8 : 1}
      disabled={!photoUri}
      accessibilityRole={photoUri ? "button" : "text"}
      accessibilityLabel={`View the submitted ${label.toLowerCase()} photo of your Valid ID`}
    >
      <View style={styles.photoBoxHeader}>
        <Text style={styles.photoBoxLabel}>{label}</Text>
        {isRejected ? (
          <Ionicons name="close-circle" size={18} color="#DC2626" />
        ) : (
          <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
        )}
      </View>

      <View style={styles.previewArea}>
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={styles.previewPhoto}
            resizeMode="cover"
          />
        ) : (
          isLoading && (
            <Text style={styles.photoBoxMicrocopy}>Loading your submitted photo…</Text>
          )
        )}
      </View>
    </TouchableOpacity>
  );
}


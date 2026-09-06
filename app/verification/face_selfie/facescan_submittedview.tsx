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
import { styles } from "../../../components/verification/faceselfie_comp/submittedview/facesubmittedstyles";
import { deleteSubmittedFaceScan } from "../../../components/verification/faceselfie_comp/backend/faceScanBackend";
import { auth, db } from "../../../firebaseConfig";
// Type-only import — erased at compile time, so this never pulls the
// native-only vision-camera module graph into the web bundle.
import type { LivenessCheck } from "../../../components/verification/faceselfie_comp/selfiecapture/backend/selfiecaptfunc";

// Where the user lands when backing out of the submitted face-scan review.
const BACK_ROUTE = "/verification/verificationmain" as Href;

// After a delete — OR via "Retake Face Scan" — the user lands on the face
// scan flow entry (faceselfiemain). Retaking goes through the normal capture
// flow and re-submits over the same storage path (selfie.jpg, upsert), so no
// delete is needed first — same overwrite behavior as the Valid ID flow.
const FACE_SELFIE_ROUTE = "/verification/face_selfie/faceselfiemain" as Href;

type SubmittedFaceScan = {
  selfieUrl: string | null;
  livenessPassed: boolean;
  livenessScore: number | null;
  livenessChecks: LivenessCheck[];
  submittedLabel: string | null;
};

const EMPTY_SUBMISSION: SubmittedFaceScan = {
  selfieUrl: null,
  livenessPassed: false,
  livenessScore: null,
  livenessChecks: [],
  submittedLabel: null,
};

// On-device liveness score (0–100) recorded with the submission — null when
// the field is absent or not a usable number (older submissions).
function parseLivenessScore(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// Per-check liveness results recorded with the submission — every entry is
// re-validated so malformed data (or older submissions without the field)
// never breaks the review screen.
function parseLivenessChecks(raw: unknown): LivenessCheck[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const VALID_KEYS = new Set(["eyes-open", "head-pose", "face-size"]);
  const checks: LivenessCheck[] = [];
  for (const item of raw) {
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
}

// Firestore timestamps arrive as Timestamp objects with a toDate(); anything
// else (missing field, unexpected shape) simply renders no date row.
function formatSubmittedAt(raw: unknown): string | null {
  if (!raw || typeof (raw as { toDate?: unknown }).toDate !== "function") {
    return null;
  }
  try {
    const date = (raw as { toDate: () => Date }).toDate();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    // A malformed timestamp must never crash the review screen.
    return null;
  }
}

/**
 * Submitted Face Scan review screen — the face-recognition counterpart of the
 * submitted Valid ID review (valid_id_submittedview.tsx): a read-only mirror
 * of the enrolled selfie (stored on the user's `regular_user` document by the
 * face-scan backend), with Retake / Delete actions below it. Tapping the
 * selfie opens the full-screen lightbox.
 */
export default function FaceScanSubmittedViewScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  // True until the first snapshot for the signed-in account arrives — keeps
  // the preview as a neutral gray placeholder instead of "unavailable" hints.
  const [isLoading, setIsLoading] = useState(true);
  const [submitted, setSubmitted] = useState<SubmittedFaceScan>(EMPTY_SUBMISSION);
  // Photo shown in the full-screen lightbox (null = closed).
  const [lightbox, setLightbox] = useState<string | null>(null);
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

  // Live subscription to the submitted face-scan fields — updates instantly
  // if the user retakes their selfie from the capture flow.
  useEffect(() => {
    if (!userId) {
      setSubmitted(EMPTY_SUBMISSION);
      setIsLoading(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        const data = snapshot.exists()
          ? (snapshot.data() as Record<string, unknown>)
          : undefined;
        setSubmitted({
          selfieUrl:
            typeof data?.faceScanUrl === "string" && data.faceScanUrl.length > 0
              ? data.faceScanUrl
              : null,
          livenessPassed: data?.livenessPassed === true,
          livenessScore: parseLivenessScore(data?.livenessScore),
          livenessChecks: parseLivenessChecks(data?.livenessChecks),
          submittedLabel: formatSubmittedAt(data?.faceScanSubmittedAt),
        });
        setIsLoading(false);
      },
      () => {
        // Read failed (offline / permissions) — show the empty state.
        setSubmitted(EMPTY_SUBMISSION);
        setIsLoading(false);
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

  // Retake / Delete actions only make sense when a submission actually exists.
  const showActions = !isLoading && Boolean(submitted.selfieUrl);

  // "Retake Face Scan" — the user already has an enrollment on file, so show
  // an alert explaining that instead of redirecting anywhere right away (and
  // never straight into the camera). Only if they confirm do we continue into
  // the face-scan flow, where re-submitting overwrites the stored selfie.
  const handleRetake = () => {
    Alert.alert(
      "Face Scan Already Submitted",
      "You have already submitted your face scan. Retaking it will replace the stored selfie, and it will be reviewed again by an admin.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Retake Now",
          onPress: () => {
            try {
              router.push(FACE_SELFIE_ROUTE);
            } catch {
              // Navigation must never crash the app.
            }
          },
        },
      ],
    );
  };

  const handleDeletePress = () => {
    setIsDeleteConfirmOpen(true);
  };

  // Confirmed delete — runs the backend (storage cleanup + Firestore field
  // clearing + status revert), then moves the user onto the face-scan flow
  // so they can enroll a new selfie right away.
  const handleConfirmDelete = async () => {
    if (isDeleting) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteSubmittedFaceScan();
      setIsDeleteConfirmOpen(false);
      Alert.alert(
        "Face Scan Deleted",
        "Your submitted face scan has been removed. Please submit a new one to continue your verification.",
        [
          {
            text: "OK",
            onPress: () => {
              try {
                router.replace(FACE_SELFIE_ROUTE);
              } catch {
                // Navigation must never crash the app.
              }
            },
          },
        ],
      );
    } catch (error) {
      setIsDeleteConfirmOpen(false);
      Alert.alert(
        "Delete Failed",
        error instanceof Error
          ? error.message
          : "Something went wrong while deleting your face scan. Please try again.",
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
          <Text style={styles.title}>Review your Face Scan</Text>

          {/* Read-only enrolled-selfie preview — tap opens the full-screen
              lightbox when a selfie exists. */}
          <TouchableOpacity
            style={[styles.previewBox, submitted.selfieUrl && styles.previewBoxAttached]}
            onPress={() => setLightbox(submitted.selfieUrl)}
            activeOpacity={submitted.selfieUrl ? 0.8 : 1}
            disabled={!submitted.selfieUrl}
            accessibilityRole={submitted.selfieUrl ? "button" : "text"}
            accessibilityLabel="View your submitted face scan photo full screen"
          >
            <View style={styles.previewBoxHeader}>
              <Text style={styles.previewBoxLabel}>Selfie</Text>
              {submitted.selfieUrl && (
                <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              )}
            </View>

            <View style={styles.previewArea}>
              {submitted.selfieUrl ? (
                <Image
                  source={{ uri: submitted.selfieUrl }}
                  style={styles.previewPhoto}
                  resizeMode="cover"
                />
              ) : (
                isLoading && (
                  <Text style={styles.previewBoxMicrocopy}>
                    Loading your submitted face scan…
                  </Text>
                )
              )}
            </View>
          </TouchableOpacity>

          {/* Enrollment info — live snapshot values, hidden until loaded. */}
          {!isLoading && (
            <View style={styles.infoWrap}>
              <View style={styles.infoRow}>
                <Ionicons
                  name={submitted.livenessPassed ? "shield-checkmark" : "shield-outline"}
                  size={18}
                  color={submitted.livenessPassed ? "#16A34A" : "#94A3B8"}
                />
                <Text style={styles.infoRowText}>
                  {submitted.livenessScore !== null
                    ? `Liveness score ${submitted.livenessScore}%`
                    : submitted.livenessPassed
                      ? "Liveness check passed"
                      : "Liveness result not recorded"}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={18} color="#0EA5E9" />
                <Text
                  style={[
                    styles.infoRowText,
                    !submitted.submittedLabel && styles.infoRowTextMuted,
                  ]}
                >
                  {submitted.submittedLabel
                    ? `Submitted ${submitted.submittedLabel}`
                    : "Submission date not recorded"}
                </Text>
              </View>
            </View>
          )}

          {/* Liveness checklist — what the enrollment actually verified, each
              row backed by a real measured value. Hidden for older
              submissions that were saved without a checklist. */}
          {submitted.livenessChecks.length > 0 && (
            <View style={styles.checklistCard}>
              <Text style={styles.checklistHeading}>What was checked</Text>
              {submitted.livenessChecks.map((check) => (
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

          {/* Retake / Delete actions — only when a submission exists. */}
          {showActions && (
            <View style={styles.submittedActionsWrap}>
              <TouchableOpacity
                style={[styles.actionButton, styles.replaceButton]}
                onPress={handleRetake}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Retake your submitted face scan"
              >
                <Ionicons name="create-outline" size={18} color="#FFFFFF" />
                <Text style={styles.confirmButtonText}>Retake Face Scan</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={handleDeletePress}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Delete your submitted face scan"
              >
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text style={styles.deleteButtonText}>Delete Submission</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Delete confirmation lightbox — same pattern as the submitted Valid
          ID review's delete confirm. */}
      <Modal
        visible={isDeleteConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCloseDeleteConfirm}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Delete Face Scan?</Text>
            <Text style={styles.confirmMessage}>
              Your submitted face scan will be permanently removed. You can submit a
              new one anytime.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleCloseDeleteConfirm}
                activeOpacity={0.8}
                disabled={isDeleting}
                accessibilityRole="button"
                accessibilityLabel="Keep your submitted face scan"
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
                accessibilityLabel="Confirm deleting your submitted face scan"
              >
                <Text style={styles.confirmButtonText}>
                  {isDeleting ? "DELETING..." : "DELETE"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full-screen photo lightbox for the enrolled selfie. */}
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
            <Text style={styles.lightboxTitle}>Face scan photo</Text>
          </View>

          <View style={styles.lightboxImageWrap}>
            {lightbox && (
              <Image
                source={{ uri: lightbox }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}


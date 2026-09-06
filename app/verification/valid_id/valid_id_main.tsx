import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
// Legacy subpath — the root "expo-file-system" import deprecates these
// methods in SDK 54 (same convention as useCreateReportForm, offline cache).
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../../../components/verification/validid/valididstyles";
import IdPhotoBox from "../../../components/verification/validid/idphotobox";
import {
  consumeCapturedIdPhoto,
  type IdPhotoSide,
} from "../../../components/verification/validid/valididcapture/backend/idcapturefunc";
import {
  submitValidId,
  type ValidIdSubmissionInput,
} from "../../../components/verification/validid/backend/validIdBackend";

// Route of the Valid ID camera capture screen.
const ID_CAPTURE_ROUTE = "/verification/valid_id/validid_cam/valididcapture";

// Where the app lands after the Valid ID is submitted with the face scan
// already on file — the verification hub. The submission is only "pending"
// at this point: an admin still has to approve the account before it can
// enter the app (the hub auto-advances to Home on approval).
const VERIFICATION_HUB_ROUTE = "/verification/verificationmain" as Href;

// Where the app lands when the Valid ID is in but the face scan is still
// missing — the submission is not "pending review" until BOTH are in, so the
// user is sent to the face-scan flow instead of Home.
const FACE_SELFIE_ROUTE = "/verification/face_selfie/faceselfiemain" as Href;

// Mockup ID types — the real list will come from the backend later.
const VALID_ID_TYPES: string[] = [
  "Philippine National ID (PhilID)",
  "Driver's License",
  "Passport",
  "SSS ID",
  "GSIS UMID",
  "PhilHealth ID",
  "Postal ID",
  "Voter's ID",
  "PRC ID",
  "TIN ID",
];

// Passport is a booklet — a single photo of the data page is enough,
// so it uses one attachment instead of the front/back pair.
const PASSPORT_ID_TYPE = "Passport";

export default function ValidIdMainScreen() {
  const router = useRouter();
  const [selectedIdType, setSelectedIdType] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Captured photo URIs per side (null = not captured yet).
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const [backPhoto, setBackPhoto] = useState<string | null>(null);
  const [passportPhoto, setPassportPhoto] = useState<string | null>(null);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  // True while the Valid ID photos are uploading/being recorded — disables
  // the submit button so the submission can't be double-fired.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Post-submission result lightbox — the same in-app card pattern as the
  // face flow's "Face Scan Uploaded" lightbox (replaces the old OS alerts).
  //   "awaiting-face"   — ID in, face scan still missing (offers to scan now;
  //                       the capture flow is fresh, nothing to overwrite)
  //   "pending-review"  — both steps in, awaiting admin approval (→ hub)
  const [submissionOutcome, setSubmissionOutcome] = useState<
    "awaiting-face" | "pending-review" | null
  >(null);
  // Side whose attached-photo action card (View Image / Retake) is open.
  const [actionSheetSide, setActionSheetSide] = useState<IdPhotoSide | null>(null);
  // Side whose full-screen photo lightbox is open.
  const [lightboxSide, setLightboxSide] = useState<IdPhotoSide | null>(null);

  const isPassport = selectedIdType === PASSPORT_ID_TYPE;
  const frontAttached = frontPhoto !== null;
  const backAttached = backPhoto !== null;
  const passportAttached = passportPhoto !== null;

  // The capture screen hands photos back through a module-level store (back()
  // cannot pass params to the previous screen); consume it whenever this
  // screen regains focus.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused) {
      return;
    }

    const front = consumeCapturedIdPhoto("front");
    const back = consumeCapturedIdPhoto("back");
    const passport = consumeCapturedIdPhoto("passport");
    if (front) {
      setFrontPhoto(front);
    }
    if (back) {
      setBackPhoto(back);
    }
    if (passport) {
      setPassportPhoto(passport);
    }
  }, [isFocused]);

  // Delete the orphaned temp file whenever a retake replaces a photo.
  const prevPhotosRef = useRef<{
    front: string | null;
    back: string | null;
    passport: string | null;
  }>({ front: null, back: null, passport: null });
  useEffect(() => {
    const current = { front: frontPhoto, back: backPhoto, passport: passportPhoto };
    (Object.keys(current) as IdPhotoSide[]).forEach((side) => {
      const prev = prevPhotosRef.current[side];
      const curr = current[side];
      if (prev && prev !== curr) {
        FileSystem.deleteAsync(prev, { idempotent: true }).catch(() => {});
      }
    });
    prevPhotosRef.current = current;
  }, [frontPhoto, backPhoto, passportPhoto]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const goToCapture = (side: IdPhotoSide) => {
    router.push({ pathname: ID_CAPTURE_ROUTE, params: { side } } as Href);
  };

  const getPhotoForSide = (side: IdPhotoSide): string | null =>
    side === "front" ? frontPhoto : side === "back" ? backPhoto : passportPhoto;

  const getSideLabel = (side: IdPhotoSide): string =>
    side === "front" ? "Front" : side === "back" ? "Back" : "Passport";

  // Empty box → opens the camera; attached box → opens the action card
  // (View Image / Retake) instead of the old system alert.
  const handleAttachPhoto = (side: IdPhotoSide) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    if (getPhotoForSide(side)) {
      setActionSheetSide(side);
      return;
    }

    goToCapture(side);
  };

  // From the action card: dismiss it and open the full-screen photo lightbox.
  const handleActionViewImage = () => {
    const side = actionSheetSide;
    setActionSheetSide(null);
    if (side) {
      setLightboxSide(side);
    }
  };

  // From the action card: dismiss it and go straight to the capture screen.
  // The retake replaces the current photo; the orphaned temp file cleanup
  // effect runs automatically once the new capture lands.
  const handleActionRetake = () => {
    const side = actionSheetSide;
    setActionSheetSide(null);
    if (side) {
      goToCapture(side);
    }
  };

  // Switching ID types resets attachments so stale photos never carry over
  // between the single-passport flow and the front/back flow.
  const handleSelectIdType = (idType: string) => {
    setSelectedIdType(idType);
    setIsDropdownOpen(false);
    setFrontPhoto(null);
    setBackPhoto(null);
    setPassportPhoto(null);
  };

  const handleSubmit = () => {
    // Guided mockup validation — tells the user exactly what is still missing.
    if (!selectedIdType) {
      Alert.alert("Select your Valid ID", "Please choose your Valid ID type first.");
      return;
    }

    if (isPassport) {
      if (!passportAttached) {
        Alert.alert("Photo missing", "Please attach a photo of your Passport.");
        return;
      }
    } else {
      if (!frontAttached && !backAttached) {
        Alert.alert("Photos missing", "Please attach the front and back photos of your ID.");
        return;
      }

      if (!frontAttached) {
        Alert.alert("Photo missing", "Please attach the front photo of your ID.");
        return;
      }

      if (!backAttached) {
        Alert.alert("Photo missing", "Please attach the back photo of your ID.");
        return;
      }
    }

    // Confirmation modal — same visual pattern as the signout modal.
    setIsSubmitConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setIsSubmitConfirmOpen(false);

    // Real submission — uploads the captured ID photos to Supabase Storage
    // and records them on the user's `regular_user` Firestore document via
    // the Valid ID submission backend (components/verification/validid/backend).
    if (!selectedIdType) {
      Alert.alert("Select your Valid ID", "Please choose your Valid ID type first.");
      return;
    }

    const submission: ValidIdSubmissionInput = {
      idType: selectedIdType,
      frontPhoto: isPassport ? null : frontPhoto,
      backPhoto: isPassport ? null : backPhoto,
      passportPhoto: isPassport ? passportPhoto : null,
    };

    try {
      setIsSubmitting(true);
      const result = await submitValidId(submission);

      // The photos are safely stored now — clean up the local temp captures
      // so they don't leak in the app cache.
      [frontPhoto, backPhoto, passportPhoto]
        .filter((uri): uri is string => uri !== null)
        .forEach((uri) => {
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        });

      // Without a face scan the submission is NOT "pending review" yet —
      // surface the "Valid ID Submitted" card offering to scan now. Safe to
      // enter the face flow directly: no face scan exists to overwrite.
      if (!result.hasFaceScan) {
        setSubmissionOutcome("awaiting-face");
        return;
      }

      // The whole submission (face scan + Valid ID) is in, but the account is
      // only "pending" — the admin still has to approve it. The card points
      // to the verification hub, which shows both check marks and
      // auto-advances to Home the moment the admin approves.
      setSubmissionOutcome("pending-review");
    } catch (error) {
      Alert.alert(
        "Submission Failed",
        error instanceof Error
          ? error.message
          : "Something went wrong while submitting your Valid ID. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // "Scan Face Now" — the ID is in but the face scan is still missing; the
  // capture flow starts fresh (nothing to overwrite).
  const handleScanFaceNow = () => {
    setSubmissionOutcome(null);
    try {
      router.replace(FACE_SELFIE_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // "Go to Hub" — both steps are in (or the user picked "Later"); the hub
  // shows both check marks and auto-advances to Home on admin approval.
  const handleGoToHub = () => {
    setSubmissionOutcome(null);
    try {
      router.replace(VERIFICATION_HUB_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // Photo + label backing the action card / lightbox for the active side.
  const actionPhoto = actionSheetSide ? getPhotoForSide(actionSheetSide) : null;
  const actionLabel = actionSheetSide ? getSideLabel(actionSheetSide) : "";
  const lightboxPhoto = lightboxSide ? getPhotoForSide(lightboxSide) : null;
  const lightboxLabel = lightboxSide ? getSideLabel(lightboxSide) : "";

  return (
    <>
      <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Choose your Valid ID</Text>

        {/* ID type dropdown (mockup) */}
        <TouchableOpacity
          style={styles.dropdownSelector}
          onPress={() => setIsDropdownOpen((open) => !open)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Select your Valid ID type"
          accessibilityState={{ expanded: isDropdownOpen }}
        >
          <Text
            style={[
              styles.dropdownSelectorText,
              !selectedIdType && styles.dropdownSelectorPlaceholder,
            ]}
          >
            {selectedIdType ?? "Select"}
          </Text>
          <Ionicons
            name={isDropdownOpen ? "chevron-up" : "chevron-down"}
            size={20}
            color="#0F172A"
          />
        </TouchableOpacity>

        {isDropdownOpen && (
          <View style={styles.dropdownList}>
            {VALID_ID_TYPES.map((idType) => (
              <TouchableOpacity
                key={idType}
                style={[
                  styles.dropdownItem,
                  selectedIdType === idType && styles.dropdownItemSelected,
                ]}
                onPress={() => {
                  handleSelectIdType(idType);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${idType}`}
                accessibilityState={{ selected: selectedIdType === idType }}
              >
                <Text style={styles.dropdownItemText}>{idType}</Text>
                {selectedIdType === idType && (
                  <Ionicons name="checkmark" size={18} color="#0EA5E9" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {isPassport ? (
          // Passport: a single photo of the data page is enough
          <IdPhotoBox
            label="Passport"
            attached={passportAttached}
            photoUri={passportPhoto}
            onToggle={() => handleAttachPhoto("passport")}
            onRetakePress={() => goToCapture("passport")}
          />
        ) : (
          <>
            {/* Front ID photo */}
            <IdPhotoBox
              label="Front"
              attached={frontAttached}
              photoUri={frontPhoto}
              onToggle={() => handleAttachPhoto("front")}
              onRetakePress={() => goToCapture("front")}
            />

            {/* Back ID photo */}
            <IdPhotoBox
              label="Back"
              attached={backAttached}
              photoUri={backPhoto}
              onToggle={() => handleAttachPhoto("back")}
              onRetakePress={() => goToCapture("back")}
            />
          </>
        )}

        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          activeOpacity={0.8}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Submit your Valid ID"
          accessibilityState={{ disabled: isSubmitting }}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? "Submitting..." : "Submit Valid ID"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </SafeAreaView>

      {isSubmitConfirmOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Submit this Valid ID?</Text>
            <Text style={styles.confirmMessage}>
              Please double check your Valid ID before you submit. You won&apos;t be able to edit
              it after submission.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={() => setIsSubmitConfirmOpen(false)}
                activeOpacity={0.8}
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
                accessibilityRole="button"
                accessibilityLabel="Confirm and submit your Valid ID"
              >
                <Text style={styles.confirmButtonText}>SUBMIT</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* "Valid ID Submitted" result lightbox — face scan still missing, so
          the card offers to scan now (fresh flow, nothing to overwrite) or
          defer to the hub. Same card pattern as the face flow's "Face Scan
          Uploaded" lightbox. */}
      {submissionOutcome === "awaiting-face" && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={[styles.resultIconWrap, styles.resultIconWrapSuccess]}>
              <Ionicons name="checkmark-circle" size={40} color="#16A34A" />
            </View>

            <Text style={styles.confirmTitle}>Valid ID Submitted</Text>
            <Text style={styles.confirmMessage}>
              Your Valid ID has been saved. Complete your face scan to finish your
              identity verification, or do it later.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleGoToHub}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Do the face scan later"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  LATER
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleScanFaceNow}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Scan your face now"
              >
                <Text style={styles.confirmButtonText}>SCAN FACE NOW</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* "Pending Admin Review" result lightbox — both steps are in; the hub
          shows both check marks and auto-advances to Home on approval. */}
      {submissionOutcome === "pending-review" && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={[styles.resultIconWrap, styles.resultIconWrapPending]}>
              <Ionicons name="hourglass-outline" size={36} color="#854D0E" />
            </View>

            <Text style={styles.confirmTitle}>Pending Admin Review</Text>
            <Text style={styles.confirmMessage}>
              Your face scan and Valid ID are both in. You can start using the app
              once an admin approves your verification.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleGoToHub}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Go to the verification hub"
              >
                <Text style={styles.confirmButtonText}>GO TO HUB</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      {/* Attached-photo action card — opened by tapping an attached box. */}
      <Modal
        visible={actionSheetSide !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheetSide(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{actionLabel} photo attached</Text>

            {actionPhoto && (
              <Image
                source={{ uri: actionPhoto }}
                style={styles.actionThumbnail}
                resizeMode="cover"
              />
            )}

            <Text style={styles.confirmMessage}>
              View the full photo, or retake it to replace the current capture.
            </Text>

            <View style={styles.actionButtonsWrap}>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonPrimary]}
                onPress={handleActionViewImage}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`View the ${actionLabel.toLowerCase()} photo full screen`}
              >
                <Ionicons name="eye-outline" size={18} color="#FFFFFF" />
                <Text style={styles.confirmButtonText}>View Image</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonSecondary]}
                onPress={handleActionRetake}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Retake the ${actionLabel.toLowerCase()} photo`}
              >
                <Ionicons name="camera-outline" size={18} color="#475569" />
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  Retake Photo
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.actionCancelButton}
              onPress={() => setActionSheetSide(null)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Close without changes"
            >
              <Text style={styles.actionCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-screen photo lightbox for the attached Valid ID photo. */}
      <Modal
        visible={lightboxSide !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxSide(null)}
      >
        <SafeAreaView style={styles.lightboxOverlay}>
          <View style={styles.lightboxHeader}>
            <TouchableOpacity
              style={styles.lightboxCloseButton}
              onPress={() => setLightboxSide(null)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Close image preview"
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.lightboxTitle}>{lightboxLabel} photo</Text>
          </View>

          <View style={styles.lightboxImageWrap}>
            {lightboxPhoto && (
              <Image
                source={{ uri: lightboxPhoto }}
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


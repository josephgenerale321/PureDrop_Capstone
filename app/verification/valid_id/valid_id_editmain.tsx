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
// methods in SDK 54 (same convention as valid_id_main.tsx).
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
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
import { auth, db } from "../../../firebaseConfig";

// Route of the Valid ID camera capture screen.
const ID_CAPTURE_ROUTE = "/verification/valid_id/validid_cam/valididcapture";

// Where the app lands after the edited submission is saved — back to the
// read-only review so the user immediately sees the updated ID in place.
const SUBMITTED_VIEW_ROUTE = "/verification/valid_id/valid_id_submittedview" as Href;

// Where the app lands when the Valid ID is in but the face scan is still
// missing — the submission is not "pending review" until BOTH are in, so the
// user is sent to the face-scan flow instead of the review screen (same
// hand-off as the original submission screen).
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

/**
 * Edit Valid ID screen — the editable counterpart of the submission screen
 * (valid_id_main.tsx), for signed-in users who still need to verify their
 * identity. On load it pre-fills the form with what the user submitted last
 * time (stored on the user's `regular_user` document by the Valid ID
 * backend): the ID type dropdown shows the submitted category and the photo
 * boxes show the submitted photos (their stored Supabase URLs).
 *
 *   - Photos that are NOT retaken keep their stored URL — the backend
 *     recognizes the remote URI, skips the re-upload and reuses the stored
 *     object.
 *   - Retaken photos are fresh local captures and upload as usual.
 *   - Changing the ID type clears the carried-over photos (they belong to
 *     the previous ID), same reset behavior as valid_id_main.
 *
 * Editing is locked while the submission is "pending" (under admin review)
 * or "verified" (already approved) — same policy as deleteSubmittedValidId.
 */
export default function ValidIdEditMainScreen() {
  const router = useRouter();
  const [selectedIdType, setSelectedIdType] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // Photo per side — either a fresh local capture URI or the stored Supabase
  // URL of the previously submitted photo (null = not attached yet).
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const [backPhoto, setBackPhoto] = useState<string | null>(null);
  const [passportPhoto, setPassportPhoto] = useState<string | null>(null);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  // True while the Valid ID photos are uploading/being recorded — disables
  // the save button so the submission can't be double-fired.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Side whose attached-photo action card (View Image / Retake) is open.
  const [actionSheetSide, setActionSheetSide] = useState<IdPhotoSide | null>(null);
  // Side whose full-screen photo lightbox is open.
  const [lightboxSide, setLightboxSide] = useState<IdPhotoSide | null>(null);
  // True until the first Firestore snapshot arrives — keeps the boxes neutral
  // instead of flashing "empty" before the previous submission loads.
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  // Ensures the prefill only ever runs once — a later snapshot (or a stale
  // one arriving after the user started editing) must not clobber changes.
  const hasPrefilledRef = useRef(false);

  const isPassport = selectedIdType === PASSPORT_ID_TYPE;
  const frontAttached = frontPhoto !== null;
  const backAttached = backPhoto !== null;
  const passportAttached = passportPhoto !== null;

  // Track the live Firebase session so the prefill always reflects the
  // account that is actually signed in on this device.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserId(currentUser?.uid ?? null);
    });

    return unsubscribe;
  }, []);

  // First snapshot of the user's `regular_user` document — prefill the form
  // with the previously submitted ID type + photo URLs, and lock the screen
  // when the submission is already verified / under review.
  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        if (hasPrefilledRef.current) {
          return;
        }

        const data = snapshot.exists() ? snapshot.data() : undefined;
        const idType =
          typeof data?.validIdType === "string" ? data.validIdType : null;
        const frontUrl =
          typeof data?.validIdFrontUrl === "string" ? data.validIdFrontUrl : null;
        const backUrl =
          typeof data?.validIdBackUrl === "string" ? data.validIdBackUrl : null;
        const status = String(data?.verificationStatus ?? "");

        if (status === "verified" || status === "pending") {
          hasPrefilledRef.current = true;
          setIsLoading(false);
          Alert.alert(
            "Valid ID locked",
            status === "verified"
              ? "Your Valid ID has already been verified and can no longer be edited."
              : "Your Valid ID is currently under review and cannot be edited right now.",
            [{ text: "OK", onPress: () => router.replace(SUBMITTED_VIEW_ROUTE) }],
          );
          return;
        }

        if (idType) {
          hasPrefilledRef.current = true;
          setSelectedIdType(idType);
          if (idType === PASSPORT_ID_TYPE) {
            // The passport data page is stored in the "front" slot.
            setPassportPhoto(frontUrl);
          } else {
            setFrontPhoto(frontUrl);
            setBackPhoto(backUrl);
          }
        }
        setIsLoading(false);
      },
      () => {
        // Read failed (offline / permissions) — start from the empty form.
        setIsLoading(false);
      },
    );

    return unsubscribe;
  }, [userId, router]);

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
  // Carried-over photos are remote URLs (not local files) — deleting those
  // would be a no-op anyway, but the guard keeps the cleanup honest.
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
      if (prev && prev !== curr && !prev.startsWith("http")) {
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

  // Empty box → opens the camera; attached box (stored or fresh photo) →
  // opens the action card (View Image / Retake) — same as valid_id_main.
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

  // Switching ID types resets attachments so the previous ID's photos never
  // carry over between the single-passport flow and the front/back flow —
  // the stored photos belong to the old ID type.
  const handleSelectIdType = (idType: string) => {
    setSelectedIdType(idType);
    setIsDropdownOpen(false);
    setFrontPhoto(null);
    setBackPhoto(null);
    setPassportPhoto(null);
  };

  const handleSubmit = () => {
    // Same guided validation as the original submission screen — tells the
    // user exactly what is still missing.
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

    // Confirmation modal — same visual pattern as the submission screen.
    setIsSubmitConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setIsSubmitConfirmOpen(false);

    if (!selectedIdType) {
      Alert.alert("Select your Valid ID", "Please choose your Valid ID type first.");
      return;
    }

    // Unchanged sides carry their stored Supabase URL — submitValidId
    // recognizes the remote URI, skips the re-upload and keeps the stored
    // object. Retaken sides are fresh local captures and upload as usual.
    const submission: ValidIdSubmissionInput = {
      idType: selectedIdType,
      frontPhoto: isPassport ? null : frontPhoto,
      backPhoto: isPassport ? null : backPhoto,
      passportPhoto: isPassport ? passportPhoto : null,
    };

    try {
      setIsSubmitting(true);
      const result = await submitValidId(submission);

      // Clean up only the local temp captures — the carried-over remote URLs
      // are live storage objects, not files on disk.
      [frontPhoto, backPhoto, passportPhoto]
        .filter((uri): uri is string => uri !== null && !uri.startsWith("http"))
        .forEach((uri) => {
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        });

      // Without a face scan the submission is NOT "pending review" yet —
      // send the user to the face-scan flow so the whole identity
      // verification gets completed (same hand-off as valid_id_main).
      if (!result.hasFaceScan) {
        Alert.alert(
          "Valid ID Submitted",
          "Your Valid ID has been updated. Please complete your face scan to finish your verification.",
          [{ text: "OK", onPress: () => router.replace(FACE_SELFIE_ROUTE) }],
        );
        return;
      }

      Alert.alert(
        "Valid ID Updated",
        "Your changes have been saved and your Valid ID is now pending review.",
        [{ text: "OK", onPress: () => router.replace(SUBMITTED_VIEW_ROUTE) }],
      );
    } catch (error) {
      Alert.alert(
        "Submission Failed",
        error instanceof Error
          ? error.message
          : "Something went wrong while saving your Valid ID. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
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
        <Text style={styles.title}>Edit your Valid ID</Text>

        {/* ID type dropdown — pre-selected with the previously submitted type */}
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
            {selectedIdType ?? (isLoading ? "Loading..." : "Select")}
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
          accessibilityLabel="Save your Valid ID changes"
          accessibilityState={{ disabled: isSubmitting }}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </SafeAreaView>

      {isSubmitConfirmOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Update this Valid ID?</Text>
            <Text style={styles.confirmMessage}>
              Photos you kept stay as they are — retaken photos replace the stored ones.
              Please double check everything before saving.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={() => setIsSubmitConfirmOpen(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Go back without saving"
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
                accessibilityLabel="Confirm and save your Valid ID changes"
              >
                <Text style={styles.confirmButtonText}>SAVE</Text>
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

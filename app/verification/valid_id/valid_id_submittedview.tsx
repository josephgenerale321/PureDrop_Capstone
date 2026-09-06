import { useEffect, useState } from "react";
import { Image, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../../../components/verification/validid/valididstyles";
import { auth, db } from "../../../firebaseConfig";

// Where the user lands when backing out of the submitted-ID review.
const BACK_ROUTE = "/verification/verificationmain" as Href;

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
      },
      () => {
        // Read failed (offline / permissions) — show the empty state.
        setSubmitted({ idType: null, frontUrl: null, backUrl: null });
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

  const isPassport = submitted.idType === PASSPORT_ID_TYPE;

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
                onPress={() => {
                  if (submitted.backUrl) {
                    setLightbox({ label: "Back", uri: submitted.backUrl });
                  }
                }}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>

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
              <Image
                source={{ uri: lightbox.uri }}
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

type SubmittedPhotoBoxProps = {
  label: string;
  /** Submitted photo URL from Supabase Storage (null = not available). */
  photoUri: string | null;
  /** True until the first Firestore snapshot arrives — shows a neutral box. */
  isLoading: boolean;
  onPress: () => void;
};

/**
 * Read-only counterpart of IdPhotoBox — same box geometry and header, but it
 * only previews the submitted photo (green check, no attach/retake actions).
 */
function SubmittedPhotoBox({ label, photoUri, isLoading, onPress }: SubmittedPhotoBoxProps) {
  return (
    <TouchableOpacity
      style={[styles.photoBox, styles.photoBoxAttached]}
      onPress={onPress}
      activeOpacity={photoUri ? 0.8 : 1}
      disabled={!photoUri}
      accessibilityRole={photoUri ? "button" : "text"}
      accessibilityLabel={`View the submitted ${label.toLowerCase()} photo of your Valid ID`}
    >
      <View style={styles.photoBoxHeader}>
        <Text style={styles.photoBoxLabel}>{label}</Text>
        <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
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


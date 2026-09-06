import { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";

const FACE_SELFIE_ROUTE = "/verification/face_selfie/faceselfiemain" as Href;
const VALID_ID_ROUTE = "/verification/valid_id/valid_id_main" as Href;
// Read-only review of the already-submitted Valid ID — the "Verify your id"
// card lands here once a submission exists (the check mark is showing).
const VALID_ID_SUBMITTED_ROUTE =
  "/verification/valid_id/valid_id_submittedview" as Href;
const START_ROUTE = "/start" as Href;

export default function VerificationMainScreen() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Signed-in user id — drives the verification-progress subscription below
  // (the check marks on the Face Recognition / Verify your id cards).
  const [userId, setUserId] = useState<string | null>(null);
  // Verification progress read from the user's `regular_user` document:
  //   hasFaceScan — a face scan (selfie) is on file
  //   hasValidId  — a Valid ID has been submitted
  const [hasFaceScan, setHasFaceScan] = useState(false);
  const [hasValidId, setHasValidId] = useState(false);
  // Lightbox confirmation for the back action — opened by both the on-screen
  // arrow and the Android hardware back button.
  const [isBackConfirmOpen, setIsBackConfirmOpen] = useState(false);

  // Track the live Firebase session so the banner always shows the account
  // that is actually signed in on this device (and updates if it changes).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserEmail(currentUser?.email ?? null);
      setUserId(currentUser?.uid ?? null);
    });

    return unsubscribe;
  }, []);

  // Live verification progress — subscribes to the signed-in user's document
  // so the check marks reflect submissions made from the face / Valid ID
  // flows instantly (including when this screen regains focus afterwards).
  useEffect(() => {
    if (!userId) {
      setHasFaceScan(false);
      setHasValidId(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : undefined;
        setHasFaceScan(
          Boolean(data?.faceScanUrl ?? data?.faceScanPath ?? data?.faceScanSubmittedAt),
        );
        setHasValidId(Boolean(data?.validIdFrontUrl ?? data?.validIdSubmittedAt));
      },
      () => {
        // Read failed (offline / permissions) — hide the checks; the cards
        // stay tappable either way.
        setHasFaceScan(false);
        setHasValidId(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  // A single back press opens the lightbox; the user makes an explicit
  // choice there. Returns true because the press is always consumed (used
  // to consume Android hardware back events).
  const attemptBack = useCallback((): boolean => {
    setIsBackConfirmOpen(true);
    return true;
  }, []);

  // Android hardware back opens the same lightbox; while it is open,
  // hardware back just dismisses it. Active only while this screen is
  // focused, so back navigation from nested screens keeps working.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") {
        return undefined;
      }

      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (isBackConfirmOpen) {
            setIsBackConfirmOpen(false);
            return true;
          }
          return attemptBack();
        }
      );

      return () => {
        subscription.remove();
      };
    }, [attemptBack, isBackConfirmOpen])
  );

  const handleBack = () => {
    attemptBack();
  };

  // [ STAY ] — close the lightbox and stay on this screen.
  const handleStayBack = () => {
    setIsBackConfirmOpen(false);
  };

  // [ GO BACK ] — leave for the start screen.
  const handleConfirmBack = () => {
    setIsBackConfirmOpen(false);
    // navigate() pops back to /start when it is already in the stack (it
    // always is — start pushes this screen), so no duplicate Start screen
    // gets stacked.
    router.navigate(START_ROUTE);
  };

  const handleFaceRecognition = () => {
    router.push(FACE_SELFIE_ROUTE);
  };

  const handleValidId = () => {
    // A submitted ID (check mark showing) opens the read-only review of what
    // was submitted; nothing submitted yet opens the submission flow.
    if (hasValidId) {
      router.push(VALID_ID_SUBMITTED_ROUTE);
      return;
    }
    router.push(VALID_ID_ROUTE);
  };

  return (
    <>
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.title}>Identify Yourself</Text>

          {/* Signed-in account banner — shows the email of the live session */}
          <View style={styles.identityBanner}>
            <View style={styles.identityIconWrap}>
              <Ionicons name="mail-outline" size={18} color="#0EA5E9" />
            </View>
            <View style={styles.identityTextWrap}>
              <Text style={styles.identityLabel}>Verifying as</Text>
              <Text
                style={[styles.identityEmail, !userEmail && styles.identityEmailMissing]}
                numberOfLines={1}
              >
                {userEmail ?? "Not signed in"}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.optionCard}
            onPress={handleFaceRecognition}
            activeOpacity={0.8}
          >
            <Ionicons name="camera-outline" size={30} color="#0F172A" />
            <Text style={styles.optionText}>Face Recognition</Text>
            {hasFaceScan && (
              <Ionicons
                name="checkmark-circle"
                size={24}
                color="#16A34A"
                style={styles.optionCheck}
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.optionCard}
            onPress={handleValidId}
            activeOpacity={0.8}
          >
            {/* Mini ID-card icon (CR80-like proportions): a photo block plus
                text lines, so it reads as an actual valid ID instead of a
                generic card glyph */}
            <View style={styles.idCardIcon}>
              <View style={styles.idCardIconPhoto} />
              <View style={styles.idCardIconLines}>
                <View style={styles.idCardIconLine} />
                <View style={[styles.idCardIconLine, styles.idCardIconLineShort]} />
              </View>
            </View>
            <Text style={styles.optionText}>Verify your id</Text>
            {hasValidId && (
              <Ionicons
                name="checkmark-circle"
                size={24}
                color="#16A34A"
                style={styles.optionCheck}
              />
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Back confirmation lightbox — verification-aware: leaving is safe,
          progress is saved and can be continued later (same pattern as the
          other verification modals). */}
      {isBackConfirmOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Cancel Verification?</Text>
            <Text style={styles.confirmMessage}>
              Your Face Recognition and Valid ID progress will be saved. You can come back
              and continue your verification anytime. Go back to the start screen?
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={handleStayBack}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Stay on this screen"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  STAY
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleConfirmBack}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Go back to the start screen"
              >
                <Text style={styles.confirmButtonText}>LATER</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  // Back confirmation lightbox (same pattern as the other verification modals)
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 10,
  },
  confirmMessage: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 24,
  },
  confirmActions: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-around",
    gap: 16,
  },
  confirmButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmCancelButton: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  confirmSubmitButton: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  confirmCancelButtonText: {
    color: "#475569",
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: 56,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 40,
  },
  identityBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 32,
  },
  identityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#D6E8F7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  identityTextWrap: {
    flex: 1,
  },
  identityLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  identityEmail: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  identityEmailMissing: {
    color: "#94A3B8",
    fontWeight: "400",
  },
  optionCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D6E8F7",
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 28,
    marginBottom: 32,
    borderWidth: 2,
    borderColor: "transparent",
  },
  optionText: {
    fontSize: 17,
    color: "#0F172A",
    marginLeft: 20,
  },
  // Completion check pinned to the right edge of an option card —
  // marginLeft: "auto" pushes it to the end of the row layout.
  optionCheck: {
    marginLeft: "auto",
  },
  // Mini ID-card icon on the "Verify your id" option card. Fixed at 30px
  // wide — the same footprint as the 30px Ionicons used on the Face
  // Recognition card — so both rows' text lines up (height 30/1.586 ≈ 19
  // keeps the CR80 card ratio).
  idCardIcon: {
    width: 30,
    height: 19,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#0F172A",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 3,
  },
  idCardIconPhoto: {
    width: 6,
    height: 9,
    borderRadius: 1,
    backgroundColor: "#0F172A",
  },
  idCardIconLines: {
    flex: 1,
    gap: 2,
  },
  idCardIconLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: "#0F172A",
  },
  idCardIconLineShort: {
    width: "60%",
  },
});


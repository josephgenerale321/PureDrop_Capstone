import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { markVerificationLater } from "../../components/login/backend/postEmailVerificationGate";
import { auth, db } from "../../firebaseConfig";

const FACE_SELFIE_ROUTE = "/verification/face_selfie/faceselfiemain" as Href;
const VALID_ID_ROUTE = "/verification/valid_id/valid_id_main" as Href;
// Read-only review of the already-submitted Valid ID — the "Verify your id"
// card lands here once a submission exists (the check mark is showing).
const VALID_ID_SUBMITTED_ROUTE =
  "/verification/valid_id/valid_id_submittedview" as Href;
const START_ROUTE = "/start" as Href;
// Rejection notice screen — the admin can reject this account's verification
// WHILE the user sits on this screen; the live Firestore subscription below
// detects it in realtime and auto-redirects here.
const REJECTED_NOTICE_ROUTE = "/login/validation/rejectedverif" as Href;
// Verified users' destination — when the admin approves a "pending" account
// while the user sits on this hub, the live snapshot below takes them Home.
const HOME_ROUTE = "/regular_user/home" as Href;
// Read-only overview of EVERYTHING the user has submitted for verification
// (face scan + Valid ID photos) — opened by the "Review Submission" button.
const REVIEW_SUBMISSION_ROUTE = "/verification/reviewsubmission" as Href;

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
  // Live verificationStatus ("awaiting_id" / "pending" / "verified" /
  // "rejected") — drives the pending-admin-review banner below.
  const [verificationStatus, setVerificationStatus] = useState<string>("");
  // Lightbox confirmation for the back action — opened by both the on-screen
  // arrow and the Android hardware back button.
  const [isBackConfirmOpen, setIsBackConfirmOpen] = useState(false);
  // Rejection count already redirected away for on this screen mount — guards
  // the realtime redirect below against firing twice for the same rejection
  // (the Firestore snapshot re-emits on every document write).
  const handledRejectionRef = useRef<number | null>(null);
  // Guards the realtime APPROVAL redirect below — like the rejection guard,
  // it must only ever fire once per screen mount even though the Firestore
  // snapshot re-emits on every document write.
  const handledApprovalRef = useRef(false);

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
        const status = String(data?.verificationStatus ?? "");
        setVerificationStatus(status);

        // Realtime approval redirect — the moment the admin approves this
        // account ("pending" → "verified") while the user sits on this hub,
        // take them into the app. One-shot per mount so the snapshot's
        // re-emissions can never fire it twice.
        if (status === "verified" && !handledApprovalRef.current) {
          handledApprovalRef.current = true;
          Alert.alert(
            "Account Verified",
            "An admin has approved your verification. Welcome to PureDrop!",
            [
              {
                text: "OK",
                onPress: () => {
                  try {
                    router.replace(HOME_ROUTE);
                  } catch {
                    // Navigation must never crash the app.
                  }
                },
              },
            ],
          );
        }

        // Realtime rejection redirect — if the admin rejects this account's
        // verification while the user is on this screen, send them straight
        // to the rejection notice screen (same design as the email success
        // screen; final-warning text at 3 rejections). Mirrors the gate
        // logic in postEmailVerificationGate.ts: the notice fires for a
        // rejection the user has NOT acknowledged yet (seen count differs
        // from the current rejection count), so a user who already
        // acknowledged and came here to re-verify is not interrupted.
        if (data?.verificationStatus === "rejected") {
          const parsedCount = Number(data.verificationRejectionCount);
          const rejectionCount =
            Number.isFinite(parsedCount) && parsedCount > 0
              ? Math.floor(parsedCount)
              : 0;

          // Absent field = never acknowledged any rejection notice (-1),
          // so even a legacy rejected account gets redirected once.
          const seenRaw = data.rejectedNoticeSeenCount;
          let seenCount = -1;
          if (seenRaw !== null && seenRaw !== undefined) {
            const parsedSeen = Number(seenRaw);
            if (Number.isFinite(parsedSeen)) {
              seenCount = Math.floor(parsedSeen);
            }
          }

          if (
            seenCount !== rejectionCount &&
            handledRejectionRef.current !== rejectionCount
          ) {
            handledRejectionRef.current = rejectionCount;
            try {
              router.replace(REJECTED_NOTICE_ROUTE);
            } catch {
              // Navigation must never crash the app — the user can still
              // re-verify manually from here.
            }
          }
        }
      },
      () => {
        // Read failed (offline / permissions) — hide the checks; the cards
        // stay tappable either way.
        setHasFaceScan(false);
        setHasValidId(false);
        setVerificationStatus("");
      },
    );

    return unsubscribe;
  }, [userId, router]);

  // NOTE: deliberately NO clear of the "continue later" marker here. Wiping
  // it whenever this hub mounts erased the user's choice every time they were
  // brought back into the flow (e.g. by logging in again), which made the
  // skip unreliable. The marker is only cleared when verification is actually
  // completed (both steps in — see resolvePostLoginTarget).

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

  // [ GO BACK ] — leave for the start screen ("continue verification later").
  const handleConfirmBack = () => {
    setIsBackConfirmOpen(false);
    // Record the "later" choice — PERSISTED across app restarts: the auto-
    // redirect sync (SaveLoginSync) then leaves the user on index/start/
    // login/register instead of bouncing them back into this screen, whether
    // both steps are submitted or not. The marker is cleared once the admin
    // verifies the account (or re-recorded if they back out again).
    // Fire-and-forget — a failed write only costs one extra redirect.
    void markVerificationLater();
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

  // Review everything submitted so far — face scan AND Valid ID photos in
  // one read-only overview (visible once at least one step is submitted).
  const handleReviewSubmission = () => {
    router.push(REVIEW_SUBMISSION_ROUTE);
  };

  return (
    <>
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.title}>Identify Yourself</Text>

          {/* Pending admin review banner — both steps are submitted but the
              admin has not approved the account yet. */}
          {verificationStatus === "pending" && (
            <View style={styles.pendingBanner}>
              <Ionicons name="hourglass-outline" size={18} color="#854D0E" />
              <Text style={styles.pendingBannerText}>
                Your face scan and Valid ID are under admin review. You can start
                using the app once an admin approves your account.
              </Text>
            </View>
          )}

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

          {/* Review Submission — one read-only overview of everything the
              user has submitted (face scan + Valid ID photos). Only shown
              once at least one step has been submitted. */}
          {(hasFaceScan || hasValidId) && (
            <TouchableOpacity
              style={styles.optionCard}
              onPress={handleReviewSubmission}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Review everything you have submitted for verification"
            >
              <Ionicons name="document-text-outline" size={30} color="#0F172A" />
              <Text style={styles.optionText}>Review Submission</Text>
              <Ionicons
                name="chevron-forward"
                size={24}
                color="#0F172A"
                style={styles.optionCheck}
              />
            </TouchableOpacity>
          )}
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
  // Pending-admin-review banner — shown while verificationStatus is
  // "pending" (both steps in, awaiting the admin's decision).
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#FEF9C3",
    borderColor: "#FACC15",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 28,
  },
  pendingBannerText: {
    flex: 1,
    marginLeft: 8,
    color: "#854D0E",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
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


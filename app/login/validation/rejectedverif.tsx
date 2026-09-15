import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";
import { markRejectedNoticeSeen } from "../../../components/login/backend/postEmailVerificationGate";
import {
  getProfileFast,
} from "../../../components/main_layout/offline_profile_cache";

// After acknowledging the rejection the user MUST re-verify their identity —
// the button goes straight back into the verification flow (face selfie +
// Valid ID), never Home.
const REVERIFY_ROUTE = "/verification/verificationmain" as Href;

// Number of rejections after which the screen switches to the final-warning
// text variant (the admin panel shows the same threshold).
const MAX_REJECTIONS = 3;

const DEFAULT_FIRST_REJECTION_TEXT =
  "Your submitted ID or face photo didn't pass verification. Please re-verify your ID to keep using the app.";

const DEFAULT_FINAL_REJECTION_TEXT =
  "Your ID has been rejected 3 times. Re-verify with a clear, valid ID and a live selfie — further rejections may limit your account.";

export default function RejectedVerificationScreen() {
  const router = useRouter();

  // Loaded from the signed-in user's `regular_user` record on mount:
  // - rejectionCount  — how many times the admin rejected the verification
  //                     (drives the text variant: normal vs final warning)
  // - rejectionReason — the reason the admin typed when rejecting
  // Both fall back to safe defaults so the screen can never crash on a
  // missing record, missing fields, or a failed Firestore read.
  const [rejectionCount, setRejectionCount] = useState(0);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  // Which part the admin rejected ("valid_id" / "face_scan" / "both") —
  // surfaced as an explicit resubmission hint below the reason. Null when
  // the field is absent (legacy rejections).
  const [rejectionTarget, setRejectionTarget] = useState<string | null>(null);
  // Guards the button while the "seen" write + navigation are in flight.
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Rejection details are read cache-first (AsyncStorage, ms) so the reason
    // text paints instantly on warm opens; a cold 1st open still pays one
    // server read but the screen itself (title + button) never waits on it.
    const loadRejectionState = async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          return;
        }

        const applyData = (data: Record<string, unknown> | null): void => {
          if (!data || cancelled) {
            return;
          }
          const parsedCount = Number(
            (data as { verificationRejectionCount?: unknown }).verificationRejectionCount,
          );
          if (Number.isFinite(parsedCount) && parsedCount > 0 && !cancelled) {
            setRejectionCount(Math.floor(parsedCount));
          }

          const reason = (data as { rejectionReason?: unknown }).rejectionReason;
          if (typeof reason === "string" && reason.length > 0 && !cancelled) {
            setRejectionReason(reason);
          }

          const target = (data as { rejectionTarget?: unknown }).rejectionTarget;
          if (
            (target === "valid_id" ||
              target === "face_scan" ||
              target === "both") &&
            !cancelled
          ) {
            setRejectionTarget(target);
          }
        };

        const profileRef = doc(db, "regular_user", uid);
        const fast = await getProfileFast({
          uid,
          emailFallback: auth.currentUser?.email ?? null,
          getCacheSnapshot: async () => null,
          getServerSnapshot: async () => {
            const snapshot = await getDocFromServer(profileRef);
            return snapshot.exists()
              ? (snapshot.data() as Record<string, unknown>)
              : null;
          },
        });
        if (cancelled) {
          return;
        }
        applyData(fast.data);
      } catch {
        // Non-fatal — the screen already renders with the default texts, so
        // an offline device or a Firestore hiccup can never crash it.
      }
    };

    void loadRejectionState();

    return () => {
      cancelled = true;
    };
  }, []);

  // Third rejection (and beyond) gets the different, final-warning text.
  const isFinalWarning = rejectionCount >= MAX_REJECTIONS;

  // A rejected account must finish re-verification — it can NEVER go back to
  // Home (the /regular_user fail-closed gate + this watcher both bounce it
  // back out) or loiter on the pre-login screens (SaveLoginSync sends it
  // straight back here). So the hardware back button is consumed while this
  // notice is up; the ONLY way forward is [Re-verify ID]. BackHandler
  // returning true consumes the event before expo-router acts on it (this
  // screen renders no header back button of its own).
  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => {
      subscription.remove();
    };
  }, []);

  const handleReverify = () => {
    if (isSubmitting) {
      return;
    }
    // Mark the button so double-taps can't push the route twice, then go
    // IMMEDIATELY — the "seen" write is non-fatal (worst case: the notice
    // shows one more time) so it must never block navigation with a 6s
    // "Please wait...". The write lands silently in the background.
    setIsSubmitting(true);

    // Into the re-verification flow — SINGLE replace() (never
    // dismissAll()+replace back-to-back: dismissAll() unmounts this screen
    // mid-flight, so the replace() never runs). Wrapped so an Expo Router
    // hiccup can never crash the app.
    try {
      router.replace(REVERIFY_ROUTE);
    } catch {
      // Navigation must never crash the app.
      setIsSubmitting(false);
    }

    // Mark this rejection's notice as seen so it pops up only ONCE per
    // rejection (a new admin rejection shows it again). Fire-and-forget:
    // never awaited, never blocks the navigation above.
    void (async () => {
      try {
        await markRejectedNoticeSeen(rejectionCount);
      } catch {
        // Non-fatal — navigation already happened.
      }
    })();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.rejectCircle}>
          <Ionicons name="close" size={86} color="#FFFFFF" />
          <View style={styles.rejectShadow} />
        </View>

        <Text style={styles.title}>
          {isFinalWarning
            ? "Verification rejected\n3 times."
            : "Your verification\nwas rejected."}
        </Text>

        <Text style={styles.message}>
          {isFinalWarning
            ? DEFAULT_FINAL_REJECTION_TEXT
            : DEFAULT_FIRST_REJECTION_TEXT}
        </Text>

        {rejectionReason !== null && (
          <Text style={styles.reasonText} numberOfLines={4}>
            Reason: {rejectionReason}
          </Text>
        )}

        {rejectionTarget !== null && (
          <Text style={styles.reasonText} numberOfLines={2}>
            Please resubmit:{" "}
            {rejectionTarget === "valid_id"
              ? "Valid ID"
              : rejectionTarget === "face_scan"
                ? "Face Scan"
                : "Valid ID + Face Scan"}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleReverify}
          disabled={isSubmitting}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Re-verify your ID"
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? "Please wait..." : "Re-verify ID"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f9ff",
  },

  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
    paddingBottom: 130,
  },

  // Same footprint as the success screen's green check circle, in rejection
  // red, with the matching rotated shadow block.
  rejectCircle: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ef4444",
    borderRadius: 16,
    marginBottom: 36,
    overflow: "hidden",
  },

  rejectShadow: {
    position: "absolute",
    right: -22,
    bottom: -26,
    width: 96,
    height: 96,
    backgroundColor: "rgba(190, 30, 45, 0.15)",
    transform: [{ rotate: "45deg" }],
  },

  title: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 32,
    textAlign: "center",
    marginBottom: 12,
  },

  message: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 8,
  },

  reasonText: {
    color: "#b91c1c",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: 8,
  },

  button: {
    backgroundColor: "#0284c7",
    width: 240,
    paddingVertical: 14,
    borderRadius: 6,
    marginTop: 30,
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  buttonText: {
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
});


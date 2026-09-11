import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "../../../firebaseConfig";
import {
  hasSeenFullyVerifiedNotice,
  markFullyVerifiedNoticeSeen,
} from "../../../components/login/backend/postEmailVerificationGate";

// One-time celebration after the admin approves the account: the FIRST login
// (explicit login AND the silent session auto-redirect) lands here, then the
// user continues to Home. The marker is consumed BOTH on mount (safety net —
// backing out via hardware back can never resurrect it) and on button press,
// so the screen shows exactly once per account. Direct visits (deep link, no
// verified session) fall through to Home instead of trapping the user.
const HOME_ROUTE = "/regular_user/home" as Href;

export default function FullyVerifiedScreen() {
  const router = useRouter();
  // Guards the Continue button while the "seen" write + navigation are in flight.
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const guardAndConsume = async () => {
      try {
        const uid = auth.currentUser?.uid ?? null;
        if (!uid) {
          if (!cancelled) {
            router.replace(HOME_ROUTE);
          }
          return;
        }
        // Already celebrated (e.g. reopened via back stack) — skip to Home.
        const seen = await hasSeenFullyVerifiedNotice(uid);
        if (!cancelled && seen) {
          router.replace(HOME_ROUTE);
          return;
        }
        // Consume on mount as a safety net: even if the user backs out
        // without pressing Continue, the next login goes straight Home.
        await markFullyVerifiedNoticeSeen(uid);
      } catch {
        // Non-fatal — the screen still renders; the button press retries the
        // consume write. Never trap the user here.
      }
    };

    void guardAndConsume();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleContinue = async () => {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      await markFullyVerifiedNoticeSeen();
    } catch {
      // Non-fatal — navigation must still proceed.
    } finally {
      setIsSubmitting(false);
    }
    try {
      router.replace(HOME_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={86} color="#FFFFFF" />
          <View style={styles.checkShadow} />
        </View>

        <Text style={styles.title}>{"You're fully verified!"}</Text>

        <Text style={styles.message}>
          {"An admin has approved your verification.\nWelcome to PureDrop!"}
        </Text>

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={isSubmitting}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Continue to home"
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? "Please wait..." : "Continue to Home"}
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

  checkCircle: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10b981",
    borderRadius: 16,
    marginBottom: 36,
    overflow: "hidden",
  },

  checkShadow: {
    position: "absolute",
    right: -22,
    bottom: -26,
    width: 96,
    height: 96,
    backgroundColor: "rgba(0, 145, 85, 0.15)",
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

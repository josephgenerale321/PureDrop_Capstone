import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { resolvePostEmailVerificationTarget } from "../../../components/login/backend/postEmailVerificationGate";

const LOGIN_ROUTE = "/login" as Href;
// The user record ("residents/user" in the regular_user collection) confirmed
// the email as verified — continue into the identity verification flow
// (face selfie + Valid ID) instead of sending the user back to Login.
const VERIFICATION_ROUTE = "/verification/verificationmain" as Href;

export default function EmailVerificationSuccessScreen() {
  const router = useRouter();

  // Resolved on mount from the signed-in user's regular_user record. While it
  // is still resolving the button falls back to the Login label/route, and a
  // resolution failure can never trap the user on this screen.
  const [target, setTarget] = useState<"verification" | "login">("login");

  useEffect(() => {
    let cancelled = false;

    resolvePostEmailVerificationTarget()
      .then((resolved) => {
        if (!cancelled) {
          setTarget(resolved);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTarget("login");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleContinue = () => {
    router.replace(target === "verification" ? VERIFICATION_ROUTE : LOGIN_ROUTE);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={86} color="#FFFFFF" />
          <View style={styles.checkShadow} />
        </View>

        <Text style={styles.title}>Success, your email{"\n"}has been verified.</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleContinue}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={
            target === "verification"
              ? "Continue to identity verification"
              : "Go to login"
          }
        >
          <Text style={styles.buttonText}>
            {target === "verification" ? "Verify Identity" : "Login"}
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
    marginBottom: 36,
  },

  button: {
    backgroundColor: "#0284c7",
    width: 240,
    paddingVertical: 14,
    borderRadius: 6,
    marginTop: 30,
  },

  buttonText: {
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
});

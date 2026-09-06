import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// After acknowledging this notice the user MUST complete both verification
// steps — the button goes straight into the verification flow (the hub),
// never Home.
const VERIFICATION_ROUTE = "/verification/verificationmain" as Href;

/**
 * Legacy verification notice — shown to OLD accounts that the admin marked
 * "verified" before face scans / Valid IDs existed in the app. Same design as
 * the email verification success screen (success.tsx), but different content:
 * it tells the user their account still owes both the Valid ID and the face
 * scan, and the button sends them straight into the verification flow.
 */
export default function LegacyVerificationScreen() {
  const router = useRouter();

  const handleVerify = () => {
    try {
      router.replace(VERIFICATION_ROUTE);
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

        <Text style={styles.title}>
          {"Your account needs ID & face\nscan verification."}
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleVerify}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Continue to identity verification"
        >
          <Text style={styles.buttonText}>Verify Identity</Text>
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
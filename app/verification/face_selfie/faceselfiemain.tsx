import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

const SELFIE_CAPTURE_ROUTE =
  "/verification/face_selfie/cameraface_selfie/selfiecapture" as Href;

// Fallback destination when this screen has no history to pop.
const VERIFICATION_HUB_ROUTE = "/verification/verificationmain" as Href;

const REQUIREMENTS: string[] = [
  "Face is clearly visible",
  "Good lighting",
  "No glasses or hats",
];

export default function FaceSelfieMainScreen() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // No history to pop (deep link / app-restart entry) — land on the
      // verification hub instead of leaving a dead back button.
      try {
        router.replace(VERIFICATION_HUB_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
    }
  };

  // "Start Camera" launches the full-screen face recognition capture screen.
  const handleStartCamera = () => {
    router.push(SELFIE_CAPTURE_ROUTE);
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Static preview placeholder — the live camera opens on the capture screen */}
        <View style={styles.previewFrame}>
          <Ionicons name="person-circle-outline" size={110} color="#94A3B8" />
          <Text style={styles.previewText}>Press “Start Camera” to scan your face</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.hintText}>Make sure that:</Text>

        {REQUIREMENTS.map((label) => (
          <View key={label} style={styles.requirementRow}>
            <View style={styles.requirementBullet} />
            <Text style={styles.requirementText}>{label}</Text>
          </View>
        ))}

        <TouchableOpacity style={styles.startButton} onPress={handleStartCamera} activeOpacity={0.8}>
          <Text style={styles.startButtonText}>Start Camera</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  previewFrame: {
    width: "85%",
    aspectRatio: 3 / 4,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "#0EA5E9",
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewText: {
    fontSize: 15,
    color: "#64748B",
    marginTop: 12,
    marginHorizontal: 16,
    textAlign: "center",
  },
  footer: {
    alignItems: "stretch",
    paddingBottom: 32,
  },
  hintText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 16,
  },
  requirementRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  requirementBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0F172A",
    marginRight: 12,
  },
  requirementText: {
    flex: 1,
    fontSize: 15,
    color: "#0F172A",
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 64,
    marginTop: 20,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});


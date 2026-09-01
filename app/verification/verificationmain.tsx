import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

type VerifyMethod = "face" | "id" | null;

export default function VerificationMainScreen() {
  const router = useRouter();
  const [selectedMethod, setSelectedMethod] = useState<VerifyMethod>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  // Mockup handlers — real face scan / valid ID capture flows will be wired up later.
  const handleReview = () => {
    if (!selectedMethod) {
      return;
    }

    Alert.alert(
      "Mockup",
      selectedMethod === "face"
        ? "Face Recognition verification is not implemented yet."
        : "Valid ID verification is not implemented yet.",
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Identify Yourself</Text>

        <TouchableOpacity
          style={[styles.optionCard, selectedMethod === "face" && styles.optionCardSelected]}
          onPress={() => router.push("/verification/face_selfie/faceselfiemain")}
          activeOpacity={0.8}
        >
          <Ionicons name="camera-outline" size={30} color="#0F172A" />
          <Text style={styles.optionText}>Face Recognition</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionCard, selectedMethod === "id" && styles.optionCardSelected]}
          onPress={() => setSelectedMethod("id")}
          activeOpacity={0.8}
        >
          <Ionicons name="id-card-outline" size={30} color="#0F172A" />
          <Text style={styles.optionText}>Verify your id</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.reviewButton, !selectedMethod && styles.reviewButtonDisabled]}
          onPress={handleReview}
          disabled={!selectedMethod}
          activeOpacity={0.8}
        >
          <Text style={styles.reviewButtonText}>Review</Text>
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
    paddingTop: 56,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 48,
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
  optionCardSelected: {
    borderColor: "#0EA5E9",
  },
  optionText: {
    fontSize: 17,
    color: "#0F172A",
    marginLeft: 20,
  },
  footer: {
    alignItems: "center",
    paddingBottom: 32,
  },
  reviewButton: {
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 64,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  reviewButtonDisabled: {
    opacity: 0.5,
  },
  reviewButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});


import { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../firebaseConfig";

const METHOD_LABELS: Record<string, string> = {
  face: "Face Recognition",
  id: "Valid ID",
};

const METHOD_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  face: "camera-outline",
  id: "id-card-outline",
};

export default function ReviewDetailsVerifMainScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ method?: string | string[] }>();
  const method = Array.isArray(params.method) ? params.method[0] : params.method;
  const methodLabel = method ? (METHOD_LABELS[method] ?? method) : null;
  const methodIcon = method
    ? (METHOD_ICONS[method] ?? "help-circle-outline")
    : "help-circle-outline";
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);

  // Track the live Firebase session so the banner always shows the account
  // that is actually signed in on this device (and updates if it changes).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserEmail(currentUser?.email ?? null);
    });

    return unsubscribe;
  }, []);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  // Opens the submit confirmation modal (same pattern as the Valid ID flow).
  const handleSubmit = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    setIsSubmitConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setIsSubmitConfirmOpen(false);

    // Mockup — the real verification submission will be wired up later.
    Alert.alert(
      "Mockup",
      `Verification submission is not implemented yet.${
        methodLabel ? ` (Method: ${methodLabel})` : ""
      }`,
    );
  };

  return (
    <>
      <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Review Details</Text>

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

        {/* Placeholder preview — the captured face/ID photo will be shown here later. */}
        <View style={[styles.previewPlaceholder, method === "id" && styles.previewPlaceholderId]}>
          <Ionicons
            name={method === "id" ? "id-card-outline" : "person-circle-outline"}
            size={48}
            color="#CBD5E1"
          />
          <Text style={styles.previewPlaceholderText}>Photo preview appears here</Text>
        </View>

        {/* Review summary — what is being verified */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryIconWrap}>
            <Ionicons name={methodIcon} size={18} color="#0EA5E9" />
          </View>
          <View style={styles.summaryTextWrap}>
            <Text style={styles.summaryLabel}>Method</Text>
            <Text style={styles.summaryValue} numberOfLines={1}>
              {methodLabel ?? "Not selected"}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.8}>
          <Text style={styles.submitButtonText}>Submit</Text>
        </TouchableOpacity>
      </View>
      </SafeAreaView>

      {isSubmitConfirmOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Submit Verification?</Text>
            <Text style={styles.confirmMessage}>
              Make sure everything looks correct. You won&apos;t be able to edit this after
              submission.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={() => setIsSubmitConfirmOpen(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Go back without submitting"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  GO BACK
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleConfirmSubmit}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Confirm and submit your verification"
              >
                <Text style={styles.confirmButtonText}>SUBMIT</Text>
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
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: 32,
    paddingBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 24,
  },
  identityBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 24,
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
  previewPlaceholder: {
    width: "85%",
    aspectRatio: 3 / 4,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    borderWidth: 2,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  previewPlaceholderId: {
    aspectRatio: 1.586, // CR80 ID card ratio (85.6mm x 54mm)
  },
  previewPlaceholderText: {
    fontSize: 13,
    color: "#94A3B8",
  },
  summaryCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 24,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#D6E8F7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  summaryTextWrap: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  footer: {
    alignItems: "center",
    paddingBottom: 32,
  },
  submitButton: {
    width: "78%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 14,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // Submit confirmation modal (same pattern as the signout / valid ID modals)
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
});


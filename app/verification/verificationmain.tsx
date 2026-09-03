import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../firebaseConfig";

const FACE_SELFIE_ROUTE = "/verification/face_selfie/faceselfiemain" as Href;
const VALID_ID_ROUTE = "/verification/valid_id/valid_id_main" as Href;

export default function VerificationMainScreen() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

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

  const handleFaceRecognition = () => {
    router.push(FACE_SELFIE_ROUTE);
  };

  const handleValidId = () => {
    router.push(VALID_ID_ROUTE);
  };

  return (
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
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionCard}
          onPress={handleValidId}
          activeOpacity={0.8}
        >
          <Ionicons name="id-card-outline" size={30} color="#0F172A" />
          <Text style={styles.optionText}>Verify your id</Text>
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
});


import { type Href, useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { auth } from "../../../firebaseConfig";
import { clearSavedLogin } from "../../../components/main_layout/save_loginfunc";
import { beginLogout, finishLogout } from "../../../lib/auth/logoutState";
import { markCurrentUserInactive } from "../status/RegularUserPresenceSync";

const LOGIN_ROUTE = "/login" as Href;

export default function SignOutModal() {
  const router = useRouter();

  const handleConfirm = async () => {
    beginLogout();
    try {
      await markCurrentUserInactive("manual_logout");
    } catch {
      // Keep sign-out flow non-blocking even if presence update fails.
    }

    // Forget the locally saved login marker so the app does NOT auto-login
    // again on the next launch after an explicit sign-out.
    try {
      await clearSavedLogin();
    } catch {
      // Non-fatal — Firebase sign-out still proceeds.
    }

    try {
      await signOut(auth);
      router.replace(LOGIN_ROUTE);
    } catch {
      finishLogout();
      Alert.alert("Logout failed", "Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.modalCard}>
        <Text style={styles.title}>Do you want to logout?</Text>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.button, styles.yesButton]} onPress={handleConfirm}>
            <Text style={styles.buttonText}>YES</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.noButton]} onPress={() => router.back()}>
            <Text style={[styles.buttonText, styles.noButtonText]}>NO</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  modalCard: {
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

  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 24,
  },

  actions: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-around",
    gap: 16,
  },

  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },

  yesButton: {
    backgroundColor: "#EF4444",
  },

  noButton: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },

  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },

  noButtonText: {
    color: "#475569",
  },
});

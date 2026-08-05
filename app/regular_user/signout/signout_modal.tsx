import { type Href, useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { auth } from "../../../firebaseConfig";
import { clearSavedLogin } from "../../../components/main_layout/save_loginfunc";
import { beginLogout, finishLogout } from "../../../lib/auth/logoutState";
import { markCurrentUserInactive } from "../status/RegularUserPresenceSync";
import { unregisterPushNotificationsAsync } from "../../../components/notifications/push_notificationfunc";
import { resetFloatingNotificationState } from "../../../components/notifications/floating_notif";
import { resetSystemNotificationState } from "../../../components/notifications/system_notif";

const LOGIN_ROUTE = "/login" as Href;

export default function SignOutModal() {
  const router = useRouter();

const handleConfirm = async () => {
    beginLogout();

    // Capture the uid BEFORE sign-out so we can clear the push token and the
    // in-app notification session state for the correct user. All of these are
    // best-effort and wrapped in try/catch so they never block the logout flow
    // or crash on preview/dev builds.
    const uid = auth.currentUser?.uid ?? null;

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

    // Stop the server from delivering remote pushes to this (now signing-out)
    // user. The push token is re-registered automatically on the next sign-in.
    try {
      if (uid) {
        await unregisterPushNotificationsAsync(uid);
      }
    } catch {
      // Non-fatal — sign-out still proceeds.
    }

    // Reset the module-scoped notification session state so a future sign-in
    // starts clean (no stale floating/system notification dedupe keys leak
    // across sessions). Crash-safe: only mutates in-memory sets.
    try {
      resetFloatingNotificationState(uid);
      resetSystemNotificationState();
    } catch {
      // Non-fatal.
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

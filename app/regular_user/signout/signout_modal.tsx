import { type Href, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { performLogout } from "../../../lib/auth/performLogout";

const LOGIN_ROUTE = "/login" as Href;

export default function SignOutModal() {
  const router = useRouter();

  const handleConfirm = async () => {
    // Full shared logout sequence (presence, saved login, caches, push token,
    // notification state, "later" marker, Firebase sign-out + navigation).
    await performLogout(router, LOGIN_ROUTE);
  };

  const handleCancel = () => {
    // Close the transparent-modal signout stack and land back on the profile
    // tab. `router.back()` dismisses this modal route; `dismissTo` is the
    // guarded fallback when there is nothing to pop. A bare `replace("profile")`
    // fails on the nested Stack (no route literally named "profile" there —
    // the tab is `profile.tsx` one navigator up), which is exactly the dev-only
    // `The action 'REPLACE' with payload {"name":"profile"} was not handled by
    // any navigator` warning. Absolute href keeps it working in dev + preview.
    try {
      if (router.canGoBack?.()) {
        router.back();
        return;
      }
    } catch {
      // Fall through to the dismiss/replace fallbacks below.
    }
    try {
      const nav = router as unknown as {
        dismissTo?: (href: Href) => void;
        dismiss?: () => void;
      };
      if (typeof nav.dismissTo === "function") {
        nav.dismissTo("/regular_user/profile" as Href);
        return;
      }
      if (typeof nav.dismiss === "function") {
        nav.dismiss();
        return;
      }
    } catch {
      // Fall through to absolute replace below.
    }
    try {
      router.replace("/regular_user/profile" as Href);
    } catch {
      // Navigation must never crash the app.
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

          <TouchableOpacity style={[styles.button, styles.noButton]} onPress={handleCancel}>
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

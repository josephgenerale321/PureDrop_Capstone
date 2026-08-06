import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import SavedLoginWait from "../components/loading/restore_session/loading_session";

export default function StartScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      {/* Loading overlay while a saved login is restored (dev + preview safe) */}
      <SavedLoginWait />

      <View style={styles.content}>
        <Image
          source={require("../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>{"Let's get started"}</Text>
        <Text style={styles.subtitle}>Login or create a new account to continue</Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, styles.loginButton]}
          onPress={() => router.push("/login")}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, styles.loginButtonText]}>Login</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.registerButton]}
          onPress={() => router.push("/login/register")}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, styles.registerButtonText]}>Register</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  logo: {
    width: 240,
    height: 240,
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 40,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 16,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  loginButton: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  registerButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "700",
  },
  loginButtonText: {
    color: "#FFFFFF",
  },
  registerButtonText: {
    color: "#0F172A",
  },
});

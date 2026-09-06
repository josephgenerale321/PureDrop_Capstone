import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { finishLogout } from "../../lib/auth/logoutState";
import { getLoginErrorMessage } from "../../lib/login/logerror";
import { loginUser } from "../../lib/login/loginfunctions";
import SavedLoginWait from "../../components/loading/restore_session/loading_session";
import { resolvePostLoginTarget } from "../../components/login/backend/postEmailVerificationGate";

const FORGOT_PASSWORD_ROUTE = "/login/forgot_password" as Href;
// Rejection notice screen — shown when the admin rejected the user's
// verification (ID / face photo). Same design as the email success screen.
const REJECTED_ROUTE = "/login/validation/rejectedverif" as Href;
// Legacy notice screen — old accounts the admin marked "verified" without
// real submissions still owe the Valid ID + face scan (success-style screen).
const LEGACY_ROUTE = "/login/validation/legacyverif" as Href;

export default function LoginScreen() {
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Two-stage login loading so the button label reflects what is happening:
  // - "auth"          — Firebase sign-in in progress ("Logging in...")
  // - "verification"  — the identity-verification gate is checking whether
  //                     the user still owes a face scan / Valid ID
  //                     ("Checking verification...")
  // - "idle"          — not loading (button shows "Login")
  const [stage, setStage] = useState<"idle" | "auth" | "verification">("idle");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    finishLogout();
  }, []);

  const focusPassword = () => {
    try {
      passwordRef.current?.focus();
    } catch {
      // Silently fail — focus errors should not crash the app
    }
  };

const handleLogin = async () => {
    try {
      setStage("auth");

      // `loginUser` now resolves as soon as Firebase Auth succeeds (profile
      // fetch + presence write happen in the background). Before navigating,
      // the identity verification gate checks whether the user has submitted
      // both their face scan and Valid ID — an unverified user is routed to
      // the verification flow instead of Home.
      await loginUser({ email, password });

      setStage("verification");
      // An explicit login is the enforcement point for identity verification:
      // an unverified / pending user is routed into the flow even if they
      // previously chose "later" — the persisted later marker only suppresses
      // the SILENT session auto-redirect on the pre-login screens.
      const loginTarget = await resolvePostLoginTarget();

      // Rejected verifications land on the rejection notice screen first
      // (shown once per rejection), then the user must re-verify their ID.
      router.replace(
        loginTarget === "rejected_notice"
          ? REJECTED_ROUTE
          : loginTarget === "legacy_notice"
            ? LEGACY_ROUTE
            : loginTarget === "verification"
              ? "/verification/verificationmain"
              : "/regular_user/home",
      );
    } catch (err: unknown) {
      Alert.alert("Error", getLoginErrorMessage(err));
    } finally {
      setStage("idle");
    }
  };

  // Button label per loading stage — the second stage tells the user why
  // login is taking an extra beat: their identity verification is being
  // checked (unverified users are sent to "Verify Identity" next).
  const getLoginButtonLabel = () => {
    if (stage === "auth") {
      return "Logging in...";
    }
    if (stage === "verification") {
      return "Checking verification...";
    }
    return "Login";
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
    >
      {/* Loading overlay while a saved login is restored (dev + preview safe) */}
      <SavedLoginWait />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <Image
          source={require("../../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Login to continue</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={focusPassword}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              ref={passwordRef}
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textContentType="password"
              autoComplete="password"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword((prev) => !prev)}
              activeOpacity={0.8}
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={22}
                color="#475569"
              />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleLogin}
          disabled={stage !== "idle"}
        >
          <Text style={styles.buttonText}>{getLoginButtonLabel()}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotButton}
          onPress={() => router.push(FORGOT_PASSWORD_ROUTE)}
          activeOpacity={0.8}
        >
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Login to your Account</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: 120,
    paddingHorizontal: 24,
  },

  scrollView: {
    backgroundColor: "#F8FAFC",
  },

  logo: {
    width: 120,
    height: 120,
    marginBottom: 24,
  },

  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 16,
    color: "#64748B",
    marginBottom: 32,
  },

  form: {
    width: "100%",
  },

  label: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    marginLeft: 4,
    textAlign: "left",
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    color: "#0F172A",
    fontSize: 16,
  },

  passwordWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    height: 52,
    borderRadius: 12,
    paddingLeft: 16,
    paddingRight: 10,
    marginBottom: 20,
  },

  passwordInput: {
    flex: 1,
    height: "100%",
    color: "#0F172A",
    fontSize: 16,
  },

  eyeButton: {
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 10,
    minWidth: 38,
  },

  button: {
    backgroundColor: "#0EA5E9",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },

  buttonText: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  forgotButton: {
    marginTop: 24,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  forgotText: {
    color: "#0EA5E9",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },

  footer: {
    marginTop: "auto",
    fontSize: 14,
    color: "#94A3B8",
  },
});

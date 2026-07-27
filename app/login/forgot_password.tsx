import {
  sendEmailVerificationOtp,
  verifyEmailVerificationOtp,
} from "@/lib/login/emailVerificationOtp";
import {
  directPasswordReset,
  getPasswordResetErrorMessage,
} from "@/lib/login/passwordReset";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const CODE_LENGTH = 6;
const LOGIN_ROUTE = "/login" as Href;
const isMobile = Platform.OS !== "web";

/** Offset above the field to keep label/padding visible */
const SCROLL_OFFSET = 130;

type ForgotPasswordStep = "email" | "code" | "password" | "success";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const codeInputRef = useRef<TextInput>(null);
  const newPasswordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const [step, setStep] = useState<ForgotPasswordStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Layout Y positions of each field wrapper (relative to ScrollView content)
  const fieldYPositions = useRef<Record<string, number>>({});

  const formattedEmail = email.trim();

  const scrollToField = useCallback((fieldName: string) => {
    const y = fieldYPositions.current[fieldName];
    if (y !== undefined && scrollViewRef.current) {
      const targetY = Math.max(y - SCROLL_OFFSET, 0);
      scrollViewRef.current.scrollTo({ y: targetY, animated: true });
    }
  }, []);

  // When the keyboard shows while a field is focused, re-scroll to that field
  useEffect(() => {
    if (!isMobile) return undefined;

    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (focusedField) {
        scrollToField(focusedField);
      }
    });

    return () => sub.remove();
  }, [focusedField, scrollToField]);

  /** Helper to register a field's Y position via onLayout */
  const onFieldLayout = (fieldName: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
    fieldYPositions.current[fieldName] = event.nativeEvent.layout.y;
  };

  /** Focus handler that also scrolls to the field */
  const handleFieldFocus = (fieldName: string) => {
    setFocusedField(fieldName);
    scrollToField(fieldName);
  };

  const handleSendCode = async (): Promise<void> => {
    if (!formattedEmail) {
      Alert.alert("Email Required", "Please enter your email address.");
      return;
    }

    try {
      setLoading(true);
      await sendEmailVerificationOtp(formattedEmail);
      setCode("");
      setStep("code");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to send code.";
      Alert.alert("Send Failed", message);
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (value: string): void => {
    setCode(value.replace(/\D/g, "").slice(0, CODE_LENGTH));
  };

  const handleVerifyCode = async (): Promise<void> => {
    if (code.length !== CODE_LENGTH) {
      Alert.alert("Invalid Code", "Please enter the 6-digit code sent to your email.");
      return;
    }

    try {
      setLoading(true);
      await verifyEmailVerificationOtp(formattedEmail, code);
      Keyboard.dismiss();
      setStep("password");
      // Auto-focus the new password field after transition
      setTimeout(() => newPasswordRef.current?.focus(), 400);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to verify code.";
      Alert.alert("Verification Failed", message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (): Promise<void> => {
    if (!password || !confirmPassword) {
      Alert.alert("Password Required", "Please enter and confirm your new password.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Passwords Do Not Match", "Please make sure both passwords are the same.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters.");
      return;
    }

    try {
      setLoading(true);
      await directPasswordReset(formattedEmail, password);
      Keyboard.dismiss();
      setStep("success");
    } catch (err: unknown) {
      Alert.alert("Reset Failed", getPasswordResetErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const renderEmailStep = () => (
    <>
      <Text style={styles.title}>Forgot Password</Text>
      <Text style={styles.description}>Enter your email to reset your password.</Text>

      <View style={styles.form}>
        <View onLayout={onFieldLayout("email")}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, focusedField === "email" && styles.inputFocused]}
            value={email}
            onChangeText={setEmail}
            onFocus={() => handleFieldFocus("email")}
            onBlur={() => setFocusedField(null)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="done"
            onSubmitEditing={handleSendCode}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSendCode}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>{loading ? "Sending..." : "Send Code"}</Text>
      </TouchableOpacity>
    </>
  );

  const renderCodeStep = () => (
    <>
      <Text style={styles.title}>Enter your code to{"\n"}Reset Password</Text>
      <Text style={styles.description}>Enter the 6-digit code sent to your email.</Text>

      <Pressable
        style={styles.pinRow}
        onPress={() => codeInputRef.current?.focus()}
        accessibilityRole="button"
        accessibilityLabel="Enter reset code"
      >
        {Array.from({ length: CODE_LENGTH }).map((_, index) => (
          <View key={index} style={[styles.pinBox, focusedField === "code" && code.length === index && styles.inputFocused]}>
            <Text style={styles.pinDigit}>{code[index] ?? ""}</Text>
          </View>
        ))}
      </Pressable>

      <TextInput
        ref={codeInputRef}
        value={code}
        onChangeText={handleCodeChange}
        onFocus={() => setFocusedField("code")}
        onBlur={() => setFocusedField(null)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        style={styles.hiddenInput}
        returnKeyType="done"
        onSubmitEditing={handleVerifyCode}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleVerifyCode}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>{loading ? "Checking..." : "Reset"}</Text>
      </TouchableOpacity>
    </>
  );

  const renderPasswordStep = () => (
    <>
      <Text style={styles.title}>Reset Your Password</Text>

      <View style={styles.form}>
        {/* New Password */}
        <View onLayout={onFieldLayout("password")}>
          <Text style={styles.label}>Password</Text>
          <View style={[styles.passwordRow, focusedField === "password" && styles.inputFocused]}>
            <TextInput
              ref={newPasswordRef}
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              onFocus={() => handleFieldFocus("password")}
              onBlur={() => setFocusedField(null)}
              secureTextEntry={!showPassword}
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color="#666"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Confirm Password */}
        <View onLayout={onFieldLayout("confirmPassword")}>
          <Text style={styles.label}>Confirm Password</Text>
          <View style={[styles.passwordRow, focusedField === "confirmPassword" && styles.inputFocused]}>
            <TextInput
              ref={confirmPasswordRef}
              style={styles.passwordInput}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onFocus={() => handleFieldFocus("confirmPassword")}
              onBlur={() => setFocusedField(null)}
              secureTextEntry={!showConfirmPassword}
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleResetPassword}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              style={styles.eyeButton}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showConfirmPassword ? "eye-off" : "eye"}
                size={18}
                color="#666"
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleResetPassword}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>{loading ? "Resetting..." : "Reset"}</Text>
      </TouchableOpacity>
    </>
  );

  const renderSuccessStep = () => (
    <>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={90} color="#FFFFFF" />
        <View style={styles.checkShadow} />
      </View>

      <Text style={styles.successText}>Your password has been{"\n"}reset successfully.</Text>
      <Text style={styles.successText}>Please log in.</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace(LOGIN_ROUTE)}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>Login</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.content, step === "success" && styles.successContent]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          {step === "email" ? renderEmailStep() : null}
          {step === "code" ? renderCodeStep() : null}
          {step === "password" ? renderPasswordStep() : null}
          {step === "success" ? renderSuccessStep() : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  keyboardView: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
    paddingBottom: 74,
  },

  successContent: {
    paddingBottom: 96,
  },

  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
    marginBottom: 12,
    textAlign: "center",
  },

  description: {
    color: "#64748B",
    fontSize: 16,
    marginBottom: 32,
    textAlign: "center",
  },

  form: {
    width: "100%",
    maxWidth: 340,
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
    width: "100%",
    fontSize: 16,
  },

  inputFocused: {
    borderColor: "#0EA5E9",
    borderWidth: 1.5,
  },

  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    height: 52,
    marginBottom: 20,
    paddingRight: 8,
  },

  passwordInput: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    color: "#0F172A",
    fontSize: 16,
  },

  eyeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  pinRow: {
    width: "100%",
    maxWidth: 240,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 40,
  },

  pinBox: {
    width: 44,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
  },

  pinDigit: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "700",
  },

  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },

  button: {
    backgroundColor: "#0EA5E9",
    width: "100%",
    maxWidth: 340,
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

  buttonDisabled: {
    opacity: 0.75,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },

  checkCircle: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10B981",
    borderRadius: 60,
    marginBottom: 36,
    overflow: "hidden",
  },

  checkShadow: {
    position: "absolute",
    right: -22,
    bottom: -28,
    width: 96,
    height: 96,
    backgroundColor: "rgba(0, 145, 85, 0.15)",
    transform: [{ rotate: "45deg" }],
  },

  successText: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    marginBottom: 16,
    textAlign: "center",
  },
});

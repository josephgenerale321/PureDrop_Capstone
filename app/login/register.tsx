import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getSelectedAddress,
  setSelectedAddress,
} from "../../lib/login/addressSelectionStore";
import { sendEmailVerificationOtp } from "../../lib/login/emailVerificationOtp";
import { setPendingRegistration } from "../../lib/login/pendingRegistrationStore";
import { useRegisterKeyboardScroll } from "../../lib/login/registerbehavior";
import { prepareRegistrationParams } from "../../lib/login/registerfunctions";

export default function RegisterScreen() {
  const router = useRouter();
  const {
    scrollViewRef,
    registerInputRef,
    registerFieldLayout,
    followFocusedField,
    focusNextField,
    handleScroll,
    handleScrollBeginDrag,
  } = useRegisterKeyboardScroll();

  const [fullName, setFullName] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [waterMeter, setWaterMeter] = useState<string>("0");
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [cityModalVisible, setCityModalVisible] = useState<boolean>(false);

  useFocusEffect(
    useCallback(() => {
      const pickedAddress = getSelectedAddress();

      if (pickedAddress) {
        setAddress(pickedAddress);
      }
    }, []),
  );

  const openAddressSelector = (): void => {
    setCityModalVisible(true);
  };

  const openBarangaySelector = (city: "Toledo" | "Balamban"): void => {
    setCityModalVisible(false);
    setSelectedAddress(address);
    router.push({
      pathname:
        city === "Balamban"
          ? "/login/address_selectblbn"
          : "/login/address_select",
      params: { currentAddress: address },
    });
  };

  const handleRegister = async (): Promise<void> => {
    try {
      setLoading(true);

      const waterMeterValue = parseFloat(waterMeter);
      if (isNaN(waterMeterValue) || waterMeterValue < 0) {
        throw new Error("Water meter must be a valid non-negative number");
      }

      const pendingRegistration = prepareRegistrationParams({
        fullName,
        address,
        email,
        password,
        confirmPassword,
        waterMeter: waterMeterValue,
      });

      setPendingRegistration(pendingRegistration);
      await sendEmailVerificationOtp(pendingRegistration.email);

      router.replace({
        pathname: "/login/email_verification/verify_email",
        params: { email: pendingRegistration.email },
      });
    } catch (err: unknown) {
      let message = "Something went wrong";

      if (err instanceof Error) {
        message = err.message;
      }

      Alert.alert("Registration Failed", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={require("../../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Sign up to get started</Text>

        <View style={styles.form}>
          <View
            style={styles.fieldGroup}
            onLayout={registerFieldLayout("fullName")}
          >
            <Text style={styles.label}>Full Name (eg. Juan Dela Cruz)</Text>
            <TextInput
              ref={registerInputRef("fullName")}
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              onFocus={() => followFocusedField("fullName")}
              onPressIn={() => followFocusedField("fullName")}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => focusNextField("fullName")}
            />
          </View>

          <Text style={styles.label}>Address</Text>
          <TouchableOpacity
            style={styles.input}
            activeOpacity={0.8}
            onPress={openAddressSelector}
          >
            <Text style={address ? styles.inputText : styles.placeholderText}>
              {address || "Select your barangay"}
            </Text>
          </TouchableOpacity>

          <View
            style={styles.fieldGroup}
            onLayout={registerFieldLayout("email")}
          >
            <Text style={styles.label}>Email</Text>
            <TextInput
              ref={registerInputRef("email")}
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              onFocus={() => followFocusedField("email")}
              onPressIn={() => followFocusedField("email")}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => focusNextField("email")}
            />
          </View>

          <View
            style={styles.fieldGroup}
            onLayout={registerFieldLayout("password")}
          >
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                ref={registerInputRef("password")}
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                onFocus={() => followFocusedField("password")}
                onPressIn={() => followFocusedField("password")}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => focusNextField("password")}
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

          <View
            style={styles.fieldGroup}
            onLayout={registerFieldLayout("confirmPassword")}
          >
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                ref={registerInputRef("confirmPassword")}
                style={styles.passwordInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onFocus={() => followFocusedField("confirmPassword")}
                onPressIn={() => followFocusedField("confirmPassword")}
                secureTextEntry={!showConfirmPassword}
                textContentType="newPassword"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => focusNextField("confirmPassword")}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword((prev) => !prev)}
                activeOpacity={0.8}
                accessibilityLabel={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                <Ionicons
                  name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color="#475569"
                />
              </TouchableOpacity>
            </View>
          </View>

          <View
            style={styles.fieldGroup}
            onLayout={registerFieldLayout("waterMeter")}
          >
            <Text style={styles.label}>Water Meter (m3)</Text>
            <TextInput
              ref={registerInputRef("waterMeter")}
              style={styles.input}
value={waterMeter}
              onChangeText={(value) =>
                setWaterMeter(value.replace(/[^\d]/g, "").slice(0, 6))
              }
              onFocus={() => followFocusedField("waterMeter")}
              onPressIn={() => followFocusedField("waterMeter")}
              keyboardType="numeric"
              returnKeyType="done"
              onSubmitEditing={() => focusNextField("waterMeter")}
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleRegister}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Sending code..." : "Register"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Register your Account</Text>
      </ScrollView>

      <Modal
        visible={cityModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCityModalVisible(false)}
      >
        <View style={styles.cityOverlay}>
          <View style={styles.citySheet}>
            <Text style={styles.cityTitle}>Select City / Municipality</Text>
            <Text style={styles.citySubtitle}>
              Choose where your barangay belongs
            </Text>

            <TouchableOpacity
              style={styles.cityButton}
              activeOpacity={0.85}
              onPress={() => openBarangaySelector("Toledo")}
            >
              <Text style={styles.cityButtonText}>Toledo City</Text>
              <Text style={styles.cityButtonSub}>38 barangays</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cityButton}
              activeOpacity={0.85}
              onPress={() => openBarangaySelector("Balamban")}
            >
              <Text style={styles.cityButtonText}>Balamban, Cebu</Text>
              <Text style={styles.cityButtonSub}>28 barangays</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cityCancelButton}
              onPress={() => setCityModalVisible(false)}
            >
              <Text style={styles.cityCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 140,
    paddingHorizontal: 24,
  },

  logo: {
    width: 100,
    height: 100,
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

  fieldGroup: {
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
    width: "100%",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    justifyContent: "center",
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

  inputText: {
    color: "#0F172A",
    fontSize: 16,
  },

  placeholderText: {
    color: "#94A3B8",
    fontSize: 16,
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

  footer: {
    marginTop: 32,
    fontSize: 14,
    color: "#94A3B8",
  },

  cityOverlay: {
    flex: 1,
    backgroundColor: "rgba(5, 22, 38, 0.45)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  citySheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  cityTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 4,
  },
  citySubtitle: {
    fontSize: 13,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 16,
  },
  cityButton: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  cityButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  cityButtonSub: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  cityCancelButton: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
  },
  cityCancelText: {
    textAlign: "center",
    color: "#475569",
    fontWeight: "600",
  },
});

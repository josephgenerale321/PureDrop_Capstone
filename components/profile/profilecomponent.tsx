import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

// Height of the floating tab bar rendered by app/regular_user/_layout.jsx
// (position:"absolute", so it overlays the bottom of this screen). Must stay
// in sync with the `tabBar.height` style in that layout.
const TAB_BAR_HEIGHT = 30;

export interface ProfileViewModel {
  fullName: string;
  address: string;
  email: string;
  waterMeter?: number | string | null;
  profileImageUrl?: string | null;
  uid?: string | null;
}

interface ProfileComponentProps {
  profile: ProfileViewModel | null;
  loading: boolean;
  savingProfile: boolean;
  error: string | null;
  onEditProfile: () => void;
  onBack: () => void;
}

export default function ProfileComponent({
  profile,
  loading,
  savingProfile,
  error,
  onEditProfile,
  onBack,
}: ProfileComponentProps) {
  const insets = useSafeAreaInsets();
  const avatarSource = profile?.profileImageUrl
    ? { uri: profile.profileImageUrl }
    : require("../../assets/images/default_account.png");

  return (
    <SafeAreaView
      style={[
        styles.container,
        // Reserve the floating tab bar's height plus the device bottom inset,
        // so the vertically centered card never slides behind the tab bar.
        { paddingBottom: TAB_BAR_HEIGHT + insets.bottom },
      ]}
    >
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 12 }]}
        onPress={onBack}
      >
        <Ionicons name="arrow-back" size={24} color="#ffffff" />
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.avatarWrap}>
          <Image
            source={avatarSource}
            style={styles.avatar}
          />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#1e40af" style={styles.loader} />
        ) : (
          <>
            <Text style={styles.nameText}>{profile?.fullName || "User"}</Text>

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={onBack} activeOpacity={0.85}>
                  <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.retryButtonText}>Go Back</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.changePhotoButton, savingProfile && styles.changePhotoButtonDisabled]}
              onPress={onEditProfile}
              disabled={savingProfile || loading}
              activeOpacity={0.85}
            >
              <Text style={styles.changePhotoText}>
                {savingProfile ? "Saving profile..." : "Edit Profile"}
              </Text>
            </TouchableOpacity>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>USER ID (UID):</Text>
              <Text style={styles.fieldValue} selectable>
                {profile?.uid || "No UID"}
              </Text>
              <View style={styles.line} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>ADDRESS:</Text>
              <Text style={styles.fieldValue}>{profile?.address || "No address"}</Text>
              <View style={styles.line} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>YOUR EMAIL:</Text>
              <Text style={styles.fieldValue}>{profile?.email || "No email"}</Text>
              <View style={styles.line} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>WATER METER:</Text>
              <Text style={styles.fieldValue}>
                {profile?.waterMeter !== undefined && profile?.waterMeter !== null && `${profile.waterMeter}`.length > 0
                  ? profile.waterMeter
                  : "No water meter"}
              </Text>
              <View style={styles.line} />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f9ff",
    alignItems: "center",
    // Vertically center the card in the space above the floating tab bar
    // (bottom padding for the tab bar is applied dynamically in the component).
    justifyContent: "center",
  },
  backButton: {
    position: "absolute",
    // `top` is applied dynamically from the safe-area inset in the component
    // (hardcoded values sit at the wrong distance on devices with different
    // status-bar heights).
    left: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#0284c7",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "90%",
    maxWidth: 360,
    minHeight: 460,
    backgroundColor: "#ffffff",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 20,
  },
  avatarWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: "#e2e8f0",
    overflow: "hidden",
    backgroundColor: "#f1f5f9",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  loader: {
    marginTop: 28,
  },
  nameText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 16,
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    color: "#ef4444",
    marginBottom: 10,
    textAlign: "center",
  },
  errorContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0284c7",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  changePhotoButton: {
    backgroundColor: "#0284c7",
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 24,
  },
  changePhotoButtonDisabled: {
    opacity: 0.7,
  },
  changePhotoText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  fieldGroup: {
    width: "100%",
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  fieldValue: {
    fontSize: 15,
    color: "#0f172a",
    marginBottom: 6,
  },
  line: {
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    width: "100%",
  },
});

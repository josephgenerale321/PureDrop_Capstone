import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { styles } from "../verificationmainstyles";

interface VerificationPendingBannerProps {
  visible: boolean;
}

// Pending admin review banner — both steps are submitted but the admin has
// not approved the account yet.
export default function VerificationPendingBanner({
  visible,
}: VerificationPendingBannerProps) {
  if (!visible) {
    return null;
  }
  return (
    <View style={styles.pendingBanner}>
      <Ionicons name="hourglass-outline" size={18} color="#854D0E" />
      <Text style={styles.pendingBannerText}>
        Your face scan and Valid ID are under admin review. You can start
        using the app once an admin approves your account.
      </Text>
    </View>
  );
}

import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { styles } from "../verificationmainstyles";

interface VerificationIdentityBannerProps {
  userEmail: string | null;
}

// Signed-in account banner — shows the email of the live session.
export default function VerificationIdentityBanner({
  userEmail,
}: VerificationIdentityBannerProps) {
  return (
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
  );
}

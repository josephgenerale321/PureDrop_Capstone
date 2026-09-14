import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "../verificationmainstyles";

interface VerificationBackConfirmLightboxProps {
  visible: boolean;
  isRejected: boolean;
  onStay: () => void;
  onConfirm: () => void;
}

// Back confirmation lightbox — verification-aware: leaving is safe,
// progress is saved and can be continued later (same pattern as the
// other verification modals). When the account is currently rejected,
// the message explains WHY leaving is blocked (the admin rejected the
// submission) instead of promising a resume — a rejected account's
// only way forward is to resubmit.
export default function VerificationBackConfirmLightbox({
  visible,
  isRejected,
  onStay,
  onConfirm,
}: VerificationBackConfirmLightboxProps) {
  if (!visible) {
    return null;
  }
  return (
    <View style={styles.confirmOverlay}>
      <View style={styles.confirmCard}>
        <Text style={styles.confirmTitle}>Cancel Verification?</Text>
        <Text style={styles.confirmMessage}>
          {isRejected
            ? "Your verification was rejected by the admin. You need to resubmit before leaving this screen."
            : "Your Face Recognition and Valid ID progress will be saved. You can come back and continue your verification anytime. Go back to the start screen?"}
        </Text>

        <View style={styles.confirmActions}>
          <TouchableOpacity
            style={[styles.confirmButton, styles.confirmCancelButton]}
            onPress={onStay}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Stay on this screen"
          >
            <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
              STAY
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.confirmButton, styles.confirmSubmitButton]}
            onPress={onConfirm}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Go back to the start screen"
          >
            <Text style={styles.confirmButtonText}>LATER</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

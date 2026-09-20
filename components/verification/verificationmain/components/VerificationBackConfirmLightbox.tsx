import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "../verificationmainstyles";

interface VerificationBackConfirmLightboxProps {
  visible: boolean;
  isRejected: boolean;
  /** True when the account was approved before and re-rejected later
   * ("existing user"). Only this combination gets the LOG OUT exit. */
  wasPreviouslyVerified?: boolean;
  /** True while the logout sequence is running — buttons are disabled. */
  isLoggingOut?: boolean;
  onStay: () => void;
  onConfirm: () => void;
  onLogout?: () => void;
}

// Back confirmation lightbox — verification-aware: leaving is safe,
// progress is saved and can be continued later (same pattern as the
// other verification modals). When the account is currently rejected,
// the message explains WHY leaving is blocked (the admin rejected the
// submission) instead of promising a resume — a rejected account's
// only way forward is to resubmit.
//
// Existing users (approved before, re-rejected later) additionally get a
// LOG OUT button: their "later" choice is refused like every rejected
// account, so without this button there is NO way to leave the hub (the
// regular_user layout is fail-closed for rejected accounts, so even the
// sign-out modal is unreachable). Logging out lands on /start where they
// can switch to a different account.
export default function VerificationBackConfirmLightbox({
  visible,
  isRejected,
  wasPreviouslyVerified = false,
  isLoggingOut = false,
  onStay,
  onConfirm,
  onLogout,
}: VerificationBackConfirmLightboxProps) {
  if (!visible) {
    return null;
  }

  const showLogout = Boolean(isRejected && wasPreviouslyVerified && onLogout);

  const message = showLogout
    ? "Your account was approved before but has been rejected. Please resubmit to continue — or log out to use a different account."
    : isRejected
      ? "Your verification was rejected by the admin. You need to resubmit before leaving this screen."
      : "Your Face Recognition and Valid ID progress will be saved. You can come back and continue your verification anytime. Go back to the start screen?";

  return (
    <View style={styles.confirmOverlay}>
      <View style={styles.confirmCard}>
        <Text style={styles.confirmTitle}>Cancel Verification?</Text>
        <Text style={styles.confirmMessage}>{message}</Text>

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

          {showLogout ? (
            <TouchableOpacity
              style={[styles.confirmButton, styles.confirmLogoutButton]}
              onPress={onLogout}
              disabled={isLoggingOut}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Log out to use a different account"
            >
              <Text style={styles.confirmButtonText}>
                {isLoggingOut ? "LOGGING OUT…" : "LOG OUT"}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.confirmButton, styles.confirmSubmitButton]}
              onPress={onConfirm}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Go back to the start screen"
            >
              <Text style={styles.confirmButtonText}>LATER</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

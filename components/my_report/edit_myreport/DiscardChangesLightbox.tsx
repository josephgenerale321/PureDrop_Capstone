import { Ionicons } from "@expo/vector-icons";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type DiscardChangesLightboxProps = {
  visible: boolean;
  /** Closes the lightbox and stays on the Edit screen (keeps the edits). */
  onKeepEditing: () => void;
  /** Confirms the discard and lets the queued navigation proceed. */
  onDiscard: () => void;
};

/**
 * In-screen lightbox (Modal) that warns the user about unsaved edits when
 * leaving the Edit Report screen. Rendered inside the screen (not a separate
 * route) so it avoids cross-navigator navigation issues — same pattern as
 * `DeleteReportLightbox`. On Android, hardware back dismisses the lightbox
 * itself ("Keep Editing") via `onRequestClose` instead of leaving the screen.
 */
export function DiscardChangesLightbox({
  visible,
  onKeepEditing,
  onDiscard,
}: DiscardChangesLightboxProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeepEditing}>
      <View style={styles.overlay}>
        <View style={styles.lightbox}>
          <View style={styles.header}>
            <Text style={styles.title}>Unsaved Changes</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onKeepEditing}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Close unsaved changes warning"
            >
              <Text style={styles.closeText}>x</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle-outline" size={28} color="#d97706" />
          </View>
          <Text style={styles.message}>
            You have edits that haven&apos;t been saved yet. Do you want to leave
            without saving?
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton]}
              onPress={onKeepEditing}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Keep editing"
            >
              <Text style={styles.cancelText}>Keep Editing</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.discardButton]}
              onPress={onDiscard}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Discard changes"
            >
              <Text style={styles.discardText}>Discard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    paddingHorizontal: 16,
  },
  lightbox: {
    borderRadius: 6,
    backgroundColor: "#ffffff",
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  closeButton: {
    position: "absolute",
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  closeText: {
    color: "#475569",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fffbeb",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  message: {
    fontSize: 15,
    color: "#334155",
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 14,
  },
  actionButton: {
    minWidth: 110,
    minHeight: 44,
    flexGrow: 1,
    maxWidth: 140,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
  },
  cancelText: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
  discardButton: {
    backgroundColor: "#dc2626",
  },
  discardText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
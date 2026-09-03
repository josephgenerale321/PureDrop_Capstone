import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { styles } from "./valididstyles";

export type IdPhotoBoxProps = {
  label: string;
  attached: boolean;
  onToggle: () => void;
};

/**
 * Mockup attach box — dashed "dropzone" when empty, shows a stylized fake ID
 * preview with a Retake chip when attached. The real camera capture and photo
 * preview will be wired up later.
 */
export default function IdPhotoBox({ label, attached, onToggle }: IdPhotoBoxProps) {
  return (
    <TouchableOpacity
      style={[styles.photoBox, attached && styles.photoBoxAttached]}
      onPress={onToggle}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Attach ${label.toLowerCase()} photo of your Valid ID`}
      accessibilityState={{ selected: attached }}
    >
      <View style={styles.photoBoxHeader}>
        <Text style={styles.photoBoxLabel}>{label}</Text>
        {attached && <Ionicons name="checkmark-circle" size={18} color="#22C55E" />}
      </View>

      {attached ? (
        <View style={styles.previewArea}>
          {/* Simulated photo preview — the real capture preview will be wired up later. */}
          <View style={styles.previewCard}>
            <View style={styles.previewPortrait} />
            <View style={styles.previewLinesWrap}>
              <View style={[styles.previewLine, { width: "72%" }]} />
              <View style={[styles.previewLine, { width: "54%" }]} />
              <View style={[styles.previewLine, { width: "63%" }]} />
            </View>
          </View>

          <TouchableOpacity
            style={styles.retakeChip}
            onPress={onToggle}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Retake ${label.toLowerCase()} photo`}
          >
            <Ionicons name="close" size={12} color="#FFFFFF" />
            <Text style={styles.retakeChipText}>Retake</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.photoBoxBody}>
            <View style={styles.cameraBadge}>
              <Ionicons name="camera-outline" size={22} color="#0EA5E9" />
            </View>
            <Text style={styles.photoBoxHint}>Attach {label.toLowerCase()} photo</Text>
          </View>
          <Text style={styles.photoBoxMicrocopy}>All 4 corners visible, no glare</Text>
        </>
      )}
    </TouchableOpacity>
  );
}


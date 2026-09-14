import type { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { styles } from "../verificationmainstyles";

export type VerificationCardTrailing = "check" | "cross" | "chevron" | null;

interface VerificationOptionCardProps {
  icon: ReactNode;
  title: string;
  subtitle?: string | null;
  trailing?: VerificationCardTrailing;
  onPress: () => void;
  accessibilityLabel?: string;
}

// One hub row (Face Recognition / Verify your id / Review Submission).
// Submitted state is conveyed via `trailing`: green check, red X (rejected),
// or chevron (review navigation). Neutral (null) while nothing submitted.
export default function VerificationOptionCard({
  icon,
  title,
  subtitle,
  trailing = null,
  onPress,
  accessibilityLabel,
}: VerificationOptionCardProps) {
  return (
    <TouchableOpacity
      style={styles.optionCard}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {icon}
      {subtitle ? (
        <View style={styles.optionTextWrap}>
          <Text style={styles.optionTextInWrap}>{title}</Text>
          <Text style={styles.optionSubText}>{subtitle}</Text>
        </View>
      ) : (
        <Text style={styles.optionText}>{title}</Text>
      )}
      {trailing === "cross" ? (
        <Ionicons
          name="close-circle"
          size={24}
          color="#DC2626"
          style={styles.optionCheck}
        />
      ) : trailing === "check" ? (
        <Ionicons
          name="checkmark-circle"
          size={24}
          color="#16A34A"
          style={styles.optionCheck}
        />
      ) : trailing === "chevron" ? (
        <Ionicons
          name="chevron-forward"
          size={24}
          color="#0F172A"
          style={styles.optionCheck}
        />
      ) : null}
    </TouchableOpacity>
  );
}

// Mini ID-card icon on the "Verify your id" option card. Fixed at 30px
// wide — the same footprint as the 30px Ionicons used on the Face
// Recognition card — so both rows' text lines up (height 30/1.586 ≈ 19
// keeps the CR80 card ratio).
export function IdCardIcon() {
  return (
    <View style={styles.idCardIcon}>
      <View style={styles.idCardIconPhoto} />
      <View style={styles.idCardIconLines}>
        <View style={styles.idCardIconLine} />
        <View style={[styles.idCardIconLine, styles.idCardIconLineShort]} />
      </View>
    </View>
  );
}

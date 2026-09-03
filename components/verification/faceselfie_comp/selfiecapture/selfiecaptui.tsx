import type { ComponentProps, ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { styles } from "./selfiecaptstyles";

/**
 * Shared presentational pieces for the face selfie capture screens
 * (app/verification/face_selfie/cameraface_selfie/selfiecapture.tsx): the
 * floating back button and the centered icon/message idle layout. Keeps the
 * route file free of duplicated fallback-screen JSX.
 */

export function BackButton() {
  const router = useRouter();
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <TouchableOpacity
      style={styles.backButton}
      onPress={handleBack}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

type IdleScreenProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  message: string;
  children?: ReactNode;
};

/**
 * Centered fallback layout (icon + message + optional action) shared by the
 * unsupported, setup-required, and permission-denied states.
 */
export function IdleScreen({ icon, message, children }: IdleScreenProps) {
  return (
    <View style={[styles.container, styles.containerIdle]}>
      <BackButton />

      <View style={styles.idleContent}>
        <Ionicons name={icon} size={90} color="#94A3B8" />
        <Text style={styles.idleText}>{message}</Text>
        {children}
      </View>
    </View>
  );
}
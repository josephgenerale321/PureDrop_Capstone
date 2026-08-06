import { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";

type HomeMainLoadingProps = {
  /** Accent color of the spinner ring. Defaults to the PureDrop sky-blue. */
  color?: string;
  /** Optional message shown under the logo. Mirrors the Figma design text. */
  message?: string;
};

/**
 * `HomeMainLoading` — full-screen loading screen for the home dashboard
 * (shown after the "Restoring your session" overlay while the dashboard user
 * profile is resolved).
 *
 * Styled to match the PureDrop Figma design ("iPhone 16 Pro Max - 31",
 * node 398:2): a white background, a large centered logo, a custom-designed
 * spinner, and the "Loading your dashboard..." caption below.
 *
 * The spinner is a custom-designed ring (a static track + a rotating arc with
 * the brand color) built on React Native's core `Animated` API. It is NOT a
 * native-only module, so it works on Android, iOS, and react-native-web.
 *
 * Crash-safety guarantees (preview / dev / web builds):
 * - Uses only React Native core primitives (`Animated`, `Image`, `Text`,
 *   `View`, `StyleSheet`) — no native-only imports.
 * - The animation loop is stopped and the transform interpolator is released
 *   on unmount, so it never leaks or keeps running in the background.
 * - No async logic, timers, or external subscriptions.
 * - The logo image is resolved with a static `require` at module load.
 */
export default function HomeMainLoading({
  color = "#0284c7",
  message = "Loading your dashboard...",
}: HomeMainLoadingProps) {
  // Rotates a full 360° continuously. `useNativeDriver: true` keeps it on the
  // UI thread on native; on web it falls back gracefully to the JS driver.
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.container}>
      <Image
        source={require("../../../assets/images/logo.png")}
        style={styles.logo}
        resizeMode="contain"
      />

      {/* Custom-designed spinner: static track + rotating brand-colored arc */}
      <View style={styles.spinnerWrap}>
        <View style={[styles.track, { borderColor: `${color}33` }]} />
        <Animated.View
          style={[
            styles.arc,
            {
              borderTopColor: color,
              borderRightColor: color,
              transform: [{ rotate }],
            },
          ]}
        />
      </View>

      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const SPINNER_SIZE = 44;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 295,
    height: 295,
    marginBottom: 28,
  },
  spinnerWrap: {
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SPINNER_SIZE / 2,
    borderWidth: 4,
  },
  arc: {
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    borderRadius: SPINNER_SIZE / 2,
    borderWidth: 4,
    borderColor: "transparent",
  },
  message: {
    color: "#000000",
    fontSize: 24,
    fontWeight: "400",
    fontFamily: "Inter",
    textAlign: "center",
    marginTop: 24,
  },
});

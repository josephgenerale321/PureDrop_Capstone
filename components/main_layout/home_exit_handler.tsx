import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { BackHandler, Platform, ToastAndroid } from "react-native";
import { useHomeExitBehavior } from "./backend/home_exit_behavior";

/**
 * Renders nothing. While the screen that hosts it is focused (and only then),
 * intercepts the Android hardware back button so that a single press shows a
 * "press back again to exit" hint instead of popping back into the pre-login
 * stack (`start` / `login`), and a second press within the window exits the app.
 *
 * Safety guards:
 * - Android only: on iOS/web the component is completely inert.
 * - `useFocusEffect` ensures the handler is active only when the host screen
 *   is focused, so back navigation from nested screens keeps working.
 * - `ToastAndroid` is Android-only API — it is only referenced on Android,
 *   keeping preview/dev builds (and non-Android platforms) crash-free.
 */
export default function HomeExitHandler() {
  const { registerPress, reset } = useHomeExitBehavior();

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") {
        return undefined;
      }

      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          const shouldExit = registerPress();

          if (shouldExit) {
            BackHandler.exitApp();
            return true;
          }

          ToastAndroid.showWithGravity(
            "Press back again to exit",
            ToastAndroid.SHORT,
            ToastAndroid.BOTTOM
          );
          return true;
        }
      );

      return () => {
        subscription.remove();
        reset();
      };
    }, [registerPress, reset])
  );

  return null;
}


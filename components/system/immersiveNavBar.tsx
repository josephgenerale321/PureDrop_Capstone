/**
 * ImmersiveNavBar — temporarily hides the Android system navigation bar
 * (◁ ○ □) app-wide so it never overlaps the floating tab bar on old phones
 * with 3-button navigation. Slide-up from the bottom edge reveals the bar
 * transiently (OS-enforced `SHOW_TRANSIENT_BARS_BY_SWIPE`); it auto-hides again.
 *
 * Android only: on iOS/web this renders nothing. The hidden state is
 * runtime-only (does not survive restarts), so this component lives in the
 * root layout which stays mounted across all navigations and re-applies the
 * hide on every launch.
 *
 * Requires `expo-navigation-bar` (native module) — needs a dev-client/native
 * rebuild after install. Import is guarded so environments without the native
 * module (Expo Go edge cases) never crash.
 */
import { useEffect } from "react";
import { Platform } from "react-native";

const getNavigationBarModule = () => {
  if (Platform.OS !== "android") {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("expo-navigation-bar");
    if (
      module?.NavigationBar == null ||
      typeof module.NavigationBar.setHidden !== "function"
    ) {
      return null;
    }
    return module.NavigationBar as {
      setHidden: (hidden: boolean) => void;
    };
  } catch {
    return null;
  }
};

const NavigationBarComponent = (() => {
  if (Platform.OS !== "android") {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("expo-navigation-bar");
    return (module?.NavigationBar ?? null) as ((props: {
      hidden?: boolean;
    }) => null) | null;
  } catch {
    return null;
  }
})();

export default function ImmersiveNavBar() {
  useEffect(() => {
    const NavigationBar = getNavigationBarModule();
    if (!NavigationBar) {
      return;
    }
    try {
      // Belt-and-braces alongside the declarative <NavigationBar hidden />
      // below: covers prop-merge ordering when several screens mount their
      // own NavigationBar components.
      NavigationBar.setHidden(true);
    } catch {
      // Hiding must never crash the app — worst case the bar stays visible.
    }
  }, []);

  if (NavigationBarComponent == null) {
    return null;
  }
  return <NavigationBarComponent hidden />;
}

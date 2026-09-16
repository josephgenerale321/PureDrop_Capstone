/**
 * useImmersiveNavBar — keeps the Android system navigation bar (◁ ○ □) hidden
 * while the app is in the foreground.
 *
 * HOW THE BAR STAYS HIDDEN
 * 1. Hides on mount. `app.json` also sets `visibility: "hidden"` through the
 *    expo-navigation-bar config plugin, so the native side hides the bar during
 *    Activity creation - before the JS engine starts - which removes the
 *    first-frame flicker.
 * 2. Re-hides when the app returns to the foreground: several ROMs
 *    (Funtouch/MIUI/...) restore the system bars on resume.
 * 3. AUTO RE-HIDE: the bar legitimately comes back when the user swipes up from
 *    the bottom edge (transient reveal for 3-button navigation) or when the OS
 *    restores it. `NavigationBar.addVisibilityListener` reports that as
 *    `visibility: "visible"`, and this hook re-hides after `autoHideDelayMs` so
 *    Back/Home stay tappable during the reveal.
 *
 * TUNING THE RE-HIDE DELAY
 * - The first `escalateAfter` consecutive reveals are answered with the plain
 *   `autoHideDelayMs` (default 2.5s), so deliberate swipes stay predictable.
 * - After that the delay grows by `backoffFactor` (2.5s -> 5s -> 10s) and the
 *   hook gives up after `maxAutoHides` consecutive re-hides, leaving the bar
 *   visible instead of flicker-fighting the device.
 * - Any reveal arriving more than `loopWindowMs` after the previous auto-hide
 *   resets that budget, so occasional reveals keep working forever.
 *
 * PLATFORM / BUILD NOTES
 * - Android only: on iOS and web this is a no-op.
 * - The native module is `require`d lazily inside try/catch, so web, Expo Go
 *   builds without the module, and Jest never crash.
 * - These APIs have no effect while the device uses "Gesture Navigation"
 *   (Android exposes no public API to detect the mode) - hiding is a no-op.
 * - `setBehaviorAsync` is intentionally NOT called: it is unsupported while
 *   edge-to-edge is enabled (`expo.android.edgeToEdgeEnabled: true`), where
 *   `expo-navigation-bar` warns and skips it.
 */
import { useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";

export type NavigationBarVisibility = "visible" | "hidden";

type NavigationBarVisibilityEvent = {
  visibility?: NavigationBarVisibility;
};

type NavigationBarModule = {
  setVisibilityAsync: (visibility: NavigationBarVisibility) => Promise<void>;
  getVisibilityAsync?: () => Promise<NavigationBarVisibility>;
  addVisibilityListener?: (
    listener: (event: NavigationBarVisibilityEvent) => void
  ) => { remove?: () => void } | undefined;
};

export type UseImmersiveNavBarOptions = {
  /** Master switch — pass `false` to leave the system bar alone. */
  enabled?: boolean;
  /** Grace period before re-hiding a bar the OS (or the user) brought back. */
  autoHideDelayMs?: number;
  /**
   * Consecutive re-hides that still use the plain `autoHideDelayMs` before the
   * delay starts growing. `1` reproduces the classic 2.5s/5s/10s escalation.
   */
  escalateAfter?: number;
  /** Multiplier applied to the delay per re-hide once backoff has started. */
  backoffFactor?: number;
  /** Consecutive re-hides before giving up (leaving the bar visible). */
  maxAutoHides?: number;
  /** A reveal this long after the last auto-hide is treated as user intent. */
  loopWindowMs?: number;
  /**
   * Optional safety net for ROMs whose system-UI events never reach JS: polls
   * `getVisibilityAsync` while active. `0` (the default) disables polling.
   */
  pollIntervalMs?: number;
};

/** Grace period so Back/Home remain usable during a transient reveal. */
export const IMMERSIVE_AUTO_HIDE_DELAY_MS = 2500;
/** Re-hides answered with the plain delay before the delay starts growing. */
export const IMMERSIVE_ESCALATE_AFTER = 3;
/** Delay multiplier applied per re-hide once backoff has started. */
export const IMMERSIVE_BACKOFF_FACTOR = 2;
/** Consecutive re-hides allowed before this hook stops fighting the device. */
export const IMMERSIVE_MAX_AUTO_HIDES = 5;
/** Reveals further apart than this are treated as deliberate, not a loop. */
export const IMMERSIVE_LOOP_WINDOW_MS = 15000;

const getNavigationBarModule = (): NavigationBarModule | null => {
  if (Platform.OS !== "android") {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("expo-navigation-bar");
    if (typeof module?.setVisibilityAsync !== "function") {
      return null;
    }
    return module as NavigationBarModule;
  } catch {
    return null;
  }
};

export function useImmersiveNavBar({
  enabled = true,
  autoHideDelayMs = IMMERSIVE_AUTO_HIDE_DELAY_MS,
  escalateAfter = IMMERSIVE_ESCALATE_AFTER,
  backoffFactor = IMMERSIVE_BACKOFF_FACTOR,
  maxAutoHides = IMMERSIVE_MAX_AUTO_HIDES,
  loopWindowMs = IMMERSIVE_LOOP_WINDOW_MS,
  pollIntervalMs = 0,
}: UseImmersiveNavBarOptions = {}): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const NavigationBar = getNavigationBarModule();
    if (!NavigationBar) {
      return;
    }

    let disposed = false;
    let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let autoHides = 0;
    let lastAutoHideAt = 0;

    const clearAutoHideTimer = () => {
      if (autoHideTimer !== null) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
    };

    const hide = () => {
      if (disposed) {
        return;
      }
      try {
        // Must never surface as an unhandled rejection (no foreground Activity
        // yet, gesture navigation, ...).
        void NavigationBar.setVisibilityAsync("hidden").catch(() => {});
      } catch {
        // Hiding must never crash the app — worst case the bar stays visible.
      }
    };

    const scheduleAutoHide = () => {
      if (disposed || autoHideTimer !== null) {
        // Already scheduled: debounce bursts of visibility events.
        return;
      }

      const now = Date.now();
      if (now - lastAutoHideAt > loopWindowMs) {
        // Isolated reveal (user swiped the bar up) — not a fight, reset budget.
        autoHides = 0;
      }
      if (autoHides >= maxAutoHides) {
        // The device keeps bringing the bar back; stop rather than flicker.
        return;
      }

      // Plain delay for the first `escalateAfter` reveals (deliberate swipes
      // stay predictable), then 2.5s -> 5s -> 10s for a device that keeps
      // forcing the bar back up.
      const escalation = Math.max(0, autoHides - (escalateAfter - 1));
      const delay = autoHideDelayMs * backoffFactor ** escalation;
      autoHides += 1;

      autoHideTimer = setTimeout(() => {
        autoHideTimer = null;
        lastAutoHideAt = Date.now();
        hide();
      }, delay);
    };

    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === "active") {
        // ROMs commonly restore the system bars when the app is resumed.
        hide();
      } else {
        clearAutoHideTimer();
      }
    };

    const subscription = NavigationBar.addVisibilityListener?.((event) => {
      if (disposed || event?.visibility !== "visible") {
        return;
      }
      if (AppState.currentState !== "active") {
        return;
      }
      scheduleAutoHide();
    });

    if (
      pollIntervalMs > 0 &&
      typeof NavigationBar.getVisibilityAsync === "function"
    ) {
      const getVisibilityAsync = NavigationBar.getVisibilityAsync;
      pollTimer = setInterval(() => {
        if (disposed || AppState.currentState !== "active") {
          return;
        }
        void getVisibilityAsync()
          .then((visibility) => {
            if (!disposed && visibility === "visible") {
              scheduleAutoHide();
            }
          })
          .catch(() => {});
      }, pollIntervalMs);
    }

    const appStateSubscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    hide();

    return () => {
      disposed = true;
      clearAutoHideTimer();
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      appStateSubscription.remove();
      if (typeof subscription?.remove === "function") {
        subscription.remove();
      }
    };
  }, [
    enabled,
    autoHideDelayMs,
    escalateAfter,
    backoffFactor,
    maxAutoHides,
    loopWindowMs,
    pollIntervalMs,
  ]);
}
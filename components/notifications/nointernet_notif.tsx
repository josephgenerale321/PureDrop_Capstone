import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "./internet_notifstyles";

/**
 * REACHABILITY CONFIG (pure JS — NO native modules, NO rebuild required).
 * `generate_204` returns HTTP 204 (no body) on success, the lightest reliable
 * internet probe. Works on Android, iOS, and web.
 */
const REACHABILITY_URL = "https://clients3.google.com/generate_204";
const PROBE_TIMEOUT_MS = 5000;
const PROBE_INTERVAL_MS = 3000;

// Animation duration for sliding the banner in/out.
const ANIM_DURATION_MS = 280;
// How long the banner stays visible before auto-dismissing (when still offline
// it re-appears after the next probe cycle, so 5s is a friendly cadence).
const AUTO_DISMISS_MS = 5000;

/**
 * Perform a single reachability probe. Resolves `true` if internet works.
 */
function probeReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => {
      if (controller) {
        controller.abort();
      }
      resolve(false);
    }, PROBE_TIMEOUT_MS);

    fetch(REACHABILITY_URL, controller ? { signal: controller.signal } : {})
      .then((res) => {
        resolve(res.status >= 200 && res.status < 400);
      })
      .catch(() => {
        resolve(false);
      })
      .finally(() => {
        clearTimeout(timeout);
      });
  });
}

/**
 * `NoInternetNotification` — a friendly, in-app floating banner.
 *
 * IMPORTANT: This is an IN-APP notification ONLY. It does NOT use
 * expo-notifications, so it will NEVER appear on the lock screen, in the
 * system notification shade, or as a push banner when the app is closed or
 * backgrounded. It only appears while the app is open and the user is in the
 * regular-user area.
 *
 * When the device loses its internet connection, a small banner slides in at
 * the top of the screen with a "No internet connection" message. It
 * auto-dismisses after a few seconds, and disappears immediately the moment
 * connectivity returns.
 *
 * CRASH-SAFETY (preview / dev / web / production):
 * - Uses ONLY React Native core primitives + `@expo/vector-icons` + the
 *   already-installed `react-native-safe-area-context`. No native modules.
 * - Internet detection is a pure-JavaScript `fetch` probe (NO
 *   `@react-native-community/netinfo`), so the `NativeModule.RNCNetInfo is
 *   null` crash is impossible.
 * - The probe is wrapped in a Promise with a timeout and an `AbortController`
 *   (when available), so a hung/offline request can never hang the app.
 * - All timers/animations are cleaned up on unmount; no state is set after
 *   unmount.
 */
export default function NoInternetNotification() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);
  const probeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const hide = () => {
    clearHideTimer();
    if (!mountedRef.current) {
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: ANIM_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start(() => {
      if (mountedRef.current) {
        setVisible(false);
      }
    });
  };

  const show = () => {
    clearHideTimer();
    if (!mountedRef.current) {
      return;
    }
    setVisible(true);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: ANIM_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start(() => {
      if (mountedRef.current) {
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          hide();
        }, AUTO_DISMISS_MS);
      }
    });
  };

  useEffect(() => {
    mountedRef.current = true;

    const runProbe = () => {
      void probeReachable().then((ok) => {
        if (!mountedRef.current) {
          return;
        }
        setOffline(!ok);
      });
    };

    runProbe();
    probeTimer.current = setInterval(runProbe, PROBE_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearHideTimer();
      if (probeTimer.current) {
        clearInterval(probeTimer.current);
        probeTimer.current = null;
      }
      anim.stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to the offline state: show the banner when offline, hide it when
  // connectivity returns.
  useEffect(() => {
    if (!mountedRef.current) {
      return;
    }
    if (offline) {
      show();
    } else {
      hide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  if (!visible) {
    return null;
  }

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-24, 0],
  });

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { top: insets.top + 8 }]}
    >
      <Animated.View
        style={[styles.banner, { opacity, transform: [{ translateY }] }]}
      >
        <View style={styles.rowBetween}>
          <View style={styles.reportTitleWrap}>
            <View style={styles.iconWrap}>
              <Ionicons name="cloud-offline-outline" size={16} color="#FCA5A5" />
            </View>
            <Text style={styles.title}>No internet connection</Text>
          </View>
          <View style={[styles.statusWrap, styles.statusWrapOffline]}>
            <Text style={[styles.status, styles.statusOffline]}>Offline</Text>
          </View>
        </View>
        <Text style={styles.message}>
          Check your Wi-Fi or mobile data. You'll be back online as soon as
          connectivity returns.
        </Text>
        <View style={styles.footerRow}>
          <Text style={styles.hint}>Auto-reconnects when back online</Text>
          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={hide}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Ionicons name="close" size={16} color="#CBD5E1" />
          </TouchableOpacity>
        </View>
</Animated.View>
    </View>
  );
}

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
// How long the "back online" banner stays visible before auto-dismissing.
const AUTO_DISMISS_MS = 4000;

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
 * `BackInternetNotification` — a friendly, in-app floating banner that lets
 * the user know their connection is back.
 *
 * IMPORTANT: This is an IN-APP notification ONLY. It does NOT use
 * expo-notifications, so it will NEVER appear on the lock screen, in the
 * system notification shade, or as a push banner when the app is closed or
 * backgrounded. It only appears while the app is open and the user is in the
 * regular-user area.
 *
 * It shows ONLY when the app transitions from OFFLINE → ONLINE (e.g. the user
 * turns Wi-Fi or mobile data back on), so it never pops up repeatedly while
 * the app is already online. It slides in at the top with a success message
 * and auto-dismisses after a few seconds.
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
export default function BackInternetNotification() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
const mountedRef = useRef(true);
  const probeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `false` on mount so the banner NEVER shows on the very first probe when
  // the app is already online (e.g. reopening/refreshing with Wi-Fi on). It is
  // only set to `true` after we actually observe an offline state, so the
  // banner appears exclusively on a GENUINE offline → online transition that
  // happens while the app is running.
  const wasOfflineRef = useRef(false);
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
        if (ok) {
          // Now online — if we were previously offline, this is a genuine
          // "connection restored" transition, so show the banner.
          if (wasOfflineRef.current) {
            wasOfflineRef.current = false;
            show();
          }
        } else {
          // Offline — remember it so the next online probe triggers the banner.
          wasOfflineRef.current = true;
        }
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
              <Ionicons
                name="wifi-outline"
                size={16}
                color="#86EFAC"
              />
            </View>
            <Text style={styles.title}>You're back online</Text>
          </View>
          <View style={[styles.statusWrap, styles.statusWrapOnline]}>
            <Text style={[styles.status, styles.statusOnline]}>Online</Text>
          </View>
        </View>
        <Text style={styles.message}>
          Your internet connection is restored. You can continue using
          PureDrop normally.
        </Text>
        <View style={styles.footerRow}>
          <Text style={styles.hint}>Connection restored</Text>
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

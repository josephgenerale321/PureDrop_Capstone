import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../../firebaseConfig";
import { type NotificationItem, useReportNotifications } from "./notif_func";
import { isNotificationUnread } from "./notif_reddot";

/**
 * How long the floating banner stays visible before it auto-dismisses.
 */
const AUTO_DISMISS_MS = 5000;

/**
 * How long the slide-in animation takes.
 */
const ANIM_DURATION_MS = 280;

/**
 * True when the user is already looking at the notifications screen. When the
 * notifications screen is focused there is no point showing a floating
 * "new notification" banner, so the component hides itself.
 */
const isNotificationsRoute = (pathname: string): boolean => {
  return (
    pathname === "/regular_user/notifications" ||
    pathname.startsWith("/regular_user/notifications/")
  );
};

/**
 * Builds a stable "dedupe key" for a notification item.
 *
 * A report's Firestore document id does NOT change when the admin updates its
 * status — only `statusUpdatedAt` (and therefore `createdAtMs`) and `status`
 * change. So we key on the triplet `reportId + createdAtMs + status`, which
 * changes every time the admin sets a new status.
 */
const getNotificationKey = (item: NotificationItem): string =>
  `${item.id}:${item.createdAtMs}:${item.status}`;

/**
 * Module-level "already seen / already presented" trackers.
 *
 * - `seededKeysRef` tracks which notifications this app session has already
 *   seen, so genuinely new arrivals can be detected.
 * - `presentedKeysRef` tracks which notifications have already triggered a
 *   floating banner. It is ALSO persisted to AsyncStorage (per user) so a
 *   notification is presented only ONCE over the app's lifetime — it never
 *   re-appears on a later app reopen or restart.
 *
 * Hoisting to module scope means they survive layout remounts (navigation,
 * tab switches, Fast Refresh) without duplicating a banner.
 */
const seededKeysRef = new Set<string>();
const presentedKeysRef = new Set<string>();
const MAX_PRESENTED_KEYS = 200;

const presentedStoragePrefix = "@puredrop/presented_floating_notifs/";
const getPresentedStorageKey = (uid: string): string =>
  `${presentedStoragePrefix}${uid}`;

/**
 * Loads the persisted set of already-presented notification keys for a user.
 * Survives app restarts so the same notification never re-presents a floating
 * banner on a later app open.
 */
const loadPresentedKeys = async (uid: string): Promise<Set<string>> => {
  try {
    const raw = await AsyncStorage.getItem(getPresentedStorageKey(uid));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((k): k is string => typeof k === "string"));
      }
    }
  } catch {
    // Non-fatal: fall back to an empty set.
  }
  return new Set();
};

/**
 * Persists the current set of presented keys for a user (fire-and-forget).
 * Bound to MAX_PRESENTED_KEYS so the stored array cannot grow unbounded.
 */
const persistPresentedKeys = (uid: string): void => {
  try {
    const arr = Array.from(presentedKeysRef).slice(-MAX_PRESENTED_KEYS);
    void AsyncStorage.setItem(getPresentedStorageKey(uid), JSON.stringify(arr)).catch(
      () => {
        // Non-fatal.
      },
    );
  } catch {
    // Non-fatal.
  }
};

/**
 * Records a key into the module-level "presented" set, pruning the oldest
 * entries when the set grows too large, and persists it to AsyncStorage so it
 * survives app restarts/reopens.
 */
const markPresented = (key: string): void => {
  presentedKeysRef.add(key);
  if (presentedKeysRef.size > MAX_PRESENTED_KEYS) {
    const oldest = presentedKeysRef.values().next().value;
    if (oldest !== undefined) {
      presentedKeysRef.delete(oldest);
    }
  }
const uid = auth.currentUser?.uid;
  if (uid) {
    persistPresentedKeys(uid);
  }
};

/**
 * Clears the module-scoped floating-banner session state so a future sign-in
 * starts with a clean slate (no stale "already presented" keys leaking across
 * sessions). Called on explicit logout. Crash-safe: it only mutates in-memory
 * sets and best-effort clears the persisted keys for the supplied uid.
 */
export const resetFloatingNotificationState = (uid?: string | null): void => {
  seededKeysRef.clear();
  presentedKeysRef.clear();

  if (uid) {
    const key = getPresentedStorageKey(uid);
    try {
      void AsyncStorage.removeItem(key).catch(() => {
        // Non-fatal.
      });
    } catch {
      // Non-fatal.
    }
  }
};

/**
 * Floating notification banner for the regular-user area.
 *
 * Renders a small tappable toast above the bottom tab bar whenever a NEW
 * unread report notification arrives while the app is running. It deliberately
 * does NOT show pending unread notifications on app open, so the same
 * notification never re-appears every time the app is opened. Presented keys
 * are persisted to AsyncStorage, so even across a full restart the same
 * notification is not re-presented.
 *
 * The component is crash-safe:
 * - It imports only core React Native primitives, `@expo/vector-icons`,
 *   `react-native-safe-area-context` and the already-installed
 *   `@react-native-async-storage/async-storage` — all available in dev,
 *   preview, Expo Go, web and production builds.
 * - All navigation, Firestore writes and AsyncStorage reads are wrapped in
 *   try/catch.
 * - Timers and the animation are cleaned up on unmount, and every state
 *   update is guarded by a mounted flag to avoid setState-after-unmount.
 */
export default function FloatingNotification() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const { items, loading, lastSeenMs, lastSeenLoaded, markAllAsRead } =
    useReportNotifications();

  const [toast, setToast] = useState<NotificationItem | null>(null);
  const [visible, setVisible] = useState(false);
  // True once the persisted "presented" keys have been restored. We gate the
  // presentation effect on this so a notification is never (re)presented
  // before we know what was already shown in a previous session.
  const [presentedLoaded, setPresentedLoaded] = useState(false);

const mountedRef = useRef(true);
  const appOpenResolvedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationRef = useRef<Animated.Value>(new Animated.Value(0));
  const animationLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const stopAnimation = useCallback(() => {
    if (animationLoopRef.current) {
      animationLoopRef.current.stop();
      animationLoopRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearHideTimer();
    stopAnimation();

    if (!mountedRef.current) {
      return;
    }

    setVisible(false);
    animationRef.current.stopAnimation();
    const finalValue = 0;
    Animated.timing(animationRef.current, {
      toValue: finalValue,
      duration: ANIM_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start(() => {
      if (mountedRef.current) {
        setToast(null);
      }
    });
  }, [clearHideTimer, stopAnimation]);

  /**
   * Slide the banner up and schedule the auto-dismiss.
   */
  const present = useCallback(
    (item: NotificationItem) => {
      if (!mountedRef.current) {
        return;
      }

      clearHideTimer();
      stopAnimation();

      setToast(item);
      setVisible(true);

      animationRef.current.setValue(0);
      const anim = Animated.timing(animationRef.current, {
        toValue: 1,
        duration: ANIM_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      });
      animationLoopRef.current = anim;
      anim.start(() => {
        animationLoopRef.current = null;
        if (mountedRef.current) {
          hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            dismiss();
          }, AUTO_DISMISS_MS);
        }
      });
    },
    [clearHideTimer, dismiss, stopAnimation],
  );

  /**
   * Restore the persisted "already presented" keys once on mount so the same
   * notification is never re-presented after an app restart/reopen.
   */
  useEffect(() => {
    let isMounted = true;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setPresentedLoaded(true);
      return;
    }
    void loadPresentedKeys(uid).then((loaded) => {
      if (!isMounted) {
        return;
      }
      loaded.forEach((k) => presentedKeysRef.add(k));
      setPresentedLoaded(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

/**
   * Track the incoming notification stream.
   *
   * The floating banner reacts ONLY to genuinely NEW unread report updates
   * that arrive while the app is running. It deliberately does NOT show a
   * banner for pending unread notifications on app open or cold start — the
   * first snapshot simply seeds the "already seen" set. Pending unread updates
   * are surfaced by the OS lock-screen/system notification instead
   * (system_notif.tsx).
   *
   * Presented keys are persisted to AsyncStorage, so even on a cold start the
   * same notification is never re-presented as a floating banner.
   */
  useEffect(() => {
    // Wait until the read timestamp and the persisted presented-key set have
    // been resolved. On a fresh app/phone restart, lastSeenMs is briefly 0
    // while AsyncStorage/Firestore load — if we presented now, every
    // notification would look unread and a phantom banner would appear.
    if (loading || !lastSeenLoaded || !presentedLoaded || items.length === 0) {
      return;
    }

    // Seed the "already seen" set on the first resolved snapshot so only
    // genuinely new updates toast after this. Module scope means it survives
    // remounts.
    if (!appOpenResolvedRef.current) {
      appOpenResolvedRef.current = true;
      items.forEach((item) => {
        seededKeysRef.add(getNotificationKey(item));
      });
      return;
    }

    // Look for a genuinely new unread notification we have not seen before.
    // The key includes status + statusUpdatedAt, so an admin re-setting the
    // status on an EXISTING report produces a new key and is treated as new.
    let newestNew: NotificationItem | null = null;
    for (const item of items) {
      const key = getNotificationKey(item);
      if (seededKeysRef.has(key)) {
        continue;
      }
      seededKeysRef.add(key);
      if (isNotificationUnread(item, lastSeenMs)) {
        if (!newestNew || item.createdAtMs > newestNew.createdAtMs) {
          newestNew = item;
        }
      }
    }

    if (newestNew) {
      const key = getNotificationKey(newestNew);
      if (!presentedKeysRef.has(key) && mountedRef.current) {
        markPresented(key);
        present(newestNew);
      }
    }
  }, [items, lastSeenMs, lastSeenLoaded, presentedLoaded, loading, present]);

  /**
   * Hide the banner when the user navigates to the notifications screen.
   */
  useEffect(() => {
    if (isNotificationsRoute(pathname)) {
      dismiss();
    }
  }, [pathname, dismiss]);

  /**
   * Cleanup on unmount: kill timers and animations, prevent setState.
   */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHideTimer();
      stopAnimation();
    };
  }, [clearHideTimer, stopAnimation]);

  const handleOpen = () => {
    if (!toast) {
      return;
    }

    dismiss();
    try {
      router.push("/regular_user/notifications");
    } catch {
      // Navigation must never crash the app.
    }
    try {
      markAllAsRead();
    } catch {
      // Firestore write errors are non-fatal.
    }
  };

  const handleDismiss = () => {
    dismiss();
  };

  const isActiveRoute = isNotificationsRoute(pathname);
  const showBanner = visible && !!toast && !isActiveRoute;

  // Nothing to render: hide everything and take no layout space.
  if (!showBanner) {
    return null;
  }

  const translateY = animationRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 0],
  });

  const opacity = animationRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlay,
        { bottom: (insets.bottom || 0) + 86 },
      ]}
    >
      <Animated.View
        style={[
          styles.toast,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <TouchableOpacity
          style={styles.toastInner}
          onPress={handleOpen}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`New notification for report ${toast.reportId}`}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="notifications" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title} numberOfLines={1}>
              Report #{toast.reportId}
            </Text>
            <Text style={styles.message} numberOfLines={1}>
              {toast.message}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={handleDismiss}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
          >
            <Ionicons name="close" size={16} color="#94A3B8" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0F172A",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  toastInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 2,
  },
  message: {
    color: "#CBD5E1",
    fontSize: 12,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});

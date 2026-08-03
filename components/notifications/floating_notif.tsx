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
 * change. Tracking by document id alone means a status update to an already
 * seen report is silently ignored (the banner / system notification never
 * appears). So we key on the triplet `reportId + createdAtMs + status`, which
 * changes every time the admin sets a new status.
 */
const getNotificationKey = (item: NotificationItem): string =>
  `${item.id}:${item.createdAtMs}:${item.status}`;

/**
 * Floating notification banner for the regular-user area.
 *
 * Renders a small tappable toast above the bottom tab bar whenever a NEW
 * unread report notification arrives while the app is running. The component
 * is deliberately crash-safe:
 *
 * - It imports only core React Native primitives, `@expo/vector-icons` and
 *   `react-native-safe-area-context` — every one of these is available on
 *   Android, iOS, web, Expo Go, preview builds and dev builds. There are no
 *   native-only modules (no ToastAndroid, no expo-notifications, no maps).
 * - All navigation and Firestore writes are wrapped in try/catch.
 * - On a fresh mount (app open / screen remount) a single banner is shown for
 *   the newest unread notification, so reopening the app surfaces pending
 *   notifications. After that, only genuinely new notifications that arrive
 *   while the app is running trigger the banner.
 * - Timers and the animation are cleaned up on unmount, and every state
 *   update is guarded by a mounted flag to avoid setState-after-unmount.
 */
export default function FloatingNotification() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const { items, loading, lastSeenMs, markAllAsRead } = useReportNotifications();

  const [toast, setToast] = useState<NotificationItem | null>(null);
  const [visible, setVisible] = useState(false);

  const mountedRef = useRef(true);
  const appOpenResolvedRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
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
   * Track the incoming notification stream.
   *
   * The first non-empty snapshot (after loading finishes) resolves the
   * "app open" state: it seeds the known-ids set AND shows a single banner
   * for the newest unread notification, so reopening the app surfaces
   * pending notifications. Subsequent snapshots only toast notifications
   * that are genuinely new AND unread.
   */
  useEffect(() => {
    if (loading || items.length === 0) {
      return;
    }

    if (!appOpenResolvedRef.current) {
      appOpenResolvedRef.current = true;

      let newestUnread: NotificationItem | null = null;
      items.forEach((item) => {
        // Seed the known set so only genuinely new updates toast after this.
        knownIdsRef.current.add(getNotificationKey(item));
        if (isNotificationUnread(item, lastSeenMs)) {
          if (!newestUnread || item.createdAtMs > newestUnread.createdAtMs) {
            newestUnread = item;
          }
        }
      });

      if (newestUnread && mountedRef.current) {
        present(newestUnread);
      }
      return;
    }

    // Look for a genuinely new unread notification we have not seen before.
    // The key includes status + statusUpdatedAt, so an admin re-setting the
    // status on an EXISTING report is treated as new and shown.
    let newestNew: NotificationItem | null = null;
    for (const item of items) {
      const key = getNotificationKey(item);
      if (knownIdsRef.current.has(key)) {
        continue;
      }
      knownIdsRef.current.add(key);
      if (isNotificationUnread(item, lastSeenMs)) {
        if (!newestNew || item.createdAtMs > newestNew.createdAtMs) {
          newestNew = item;
        }
      }
    }

    if (newestNew && mountedRef.current) {
      present(newestNew);
    }
  }, [items, lastSeenMs, loading, present]);

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


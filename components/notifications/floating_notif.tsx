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
import {
  getNotificationDedupeKey,
  isPresentedLoadedForUser,
  loadPresentedKeys,
  resetPresentedState,
  tryClaimPresentedKey,
} from "./supabase_presented_store";

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
 * Delegates to the shared Supabase-backed store so the floating banner and
 * the system notification use the EXACT same key space (this is what stops
 * the same update presenting twice on app open).
 */
const getNotificationKey = (item: NotificationItem): string =>
  getNotificationDedupeKey(item);

/**
 * Module-level "already seen" tracker for this app session.
 *
 * - `seededKeysRef` tracks which notifications this app session has already
 *   seen, so genuinely new arrivals can be detected.
 * - "Already presented" tracking lives in the shared Supabase-backed store
 *   (`supabase_presented_store.ts`), shared with system_notif.tsx, persisted
 *   to the Supabase `notification_dedupe` table + AsyncStorage mirror so a
 *   notification presents only ONCE over the app's lifetime.
 * Hoisting to module scope means they survive layout remounts (navigation,
 * tab switches, Fast Refresh) without duplicating a banner.
 */
const seededKeysRef = new Set<string>();

/**
 * Clears the module-scoped floating-banner session state so a future sign-in
 * starts with a clean slate. "Already presented" keys live in the shared
 * Supabase-backed store and are cleared there too (Supabase + AsyncStorage).
 */
export const resetFloatingNotificationState = (uid?: string | null): void => {
  seededKeysRef.clear();
  try {
    resetPresentedState(uid ?? null);
  } catch {
    // Non-fatal.
  }
};

/**
 * Floating notification banner for the regular-user area.
 *
 * Renders a small tappable toast above the bottom tab bar whenever a NEW
 * unread report notification arrives while the app is running. It deliberately
 * does NOT show pending unread notifications on app open, so the same
 * notification never re-appears every time the app is opened. Presented keys
 * are claimed in the shared Supabase-backed store (`notification_dedupe`
 * table + AsyncStorage mirror, never Firestore), so even across a full
 * restart the same notification is not re-presented -- and the system
 * notification path cannot double it on the same open.
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

  const {
    items,
    loading,
    lastSeenMs,
    lastSeenLoaded,
    verificationSeenKey,
    verificationSeenLoaded,
    markAllAsRead,
    markVerificationAsSeen,
  } = useReportNotifications();

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
   * notification is never re-presented after an app restart/reopen. Uses the
   * shared Supabase-backed store (Supabase `notification_dedupe` table +
   * AsyncStorage mirror) -- never Firestore.
   */
  useEffect(() => {
    let isMounted = true;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setPresentedLoaded(true);
      return;
    }
    void loadPresentedKeys(uid)
      .catch(() => new Set<string>())
      .then(() => {
        if (!isMounted) {
          return;
        }
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
   * first snapshot simply seeds the "already seen" set AND claims every
   * still-unread update as presented in the shared Supabase-backed store,
   * so neither this banner nor the system notification re-fires it later.
   *
   * Presented claims live in Supabase (`notification_dedupe`) + AsyncStorage,
   * shared atomically with system_notif.tsx via tryClaimPresentedKey.
   */
  useEffect(() => {
    // Wait until the read states and the persisted presented-key set have
    // been resolved. On a fresh app/phone restart these are briefly
    // unresolved while AsyncStorage/Supabase load — presenting now would
    // treat everything as new and a phantom banner would appear. The
    // verification gate matters most: its card timestamps are frozen after
    // the decision, so without it EVERY restart replays "Account verified".
    const activeUid = auth.currentUser?.uid ?? null;
    if (
      loading ||
      !lastSeenLoaded ||
      !verificationSeenLoaded ||
      !presentedLoaded ||
      !isPresentedLoadedForUser(activeUid) ||
      items.length === 0
    ) {
      return;
    }

    // Seed the "already seen" set on the first resolved snapshot so only
    // genuinely new updates toast after this. Also CLAIM every still-unread
    // update in the shared Supabase store: the user is inside the app, so the
    // floating banner path owns presentation -- without this claim the system
    // path (system_notif.tsx) would schedule a duplicate OS notification for
    // the same update on the SAME app open (the "doubles" bug), and both
    // would replay on every reopen while still unread.
    if (!appOpenResolvedRef.current) {
      appOpenResolvedRef.current = true;
      const uid = auth.currentUser?.uid ?? null;
      items.forEach((item) => {
        const key = getNotificationKey(item);
        seededKeysRef.add(key);
        try {
          if (
            isNotificationUnread(
              item,
              lastSeenMs,
              verificationSeenKey,
              verificationSeenLoaded,
            ) &&
            isPresentedLoadedForUser(uid)
          ) {
            tryClaimPresentedKey(uid, key);
          }
        } catch {
          // Non-fatal.
        }
      });
      return;
    }

    // Look for a genuinely new unread notification we have not seen before.
    // The key includes status + statusUpdatedAt, so an admin re-setting the
    // status on an EXISTING report produces a new key and is treated as new.
    // Verification unread is per-decision (seenKey), never wall-clock.
    let newestNew: NotificationItem | null = null;
    for (const item of items) {
      const key = getNotificationKey(item);
      if (seededKeysRef.has(key)) {
        continue;
      }
      seededKeysRef.add(key);
      if (
        isNotificationUnread(item, lastSeenMs, verificationSeenKey, verificationSeenLoaded)
      ) {
        if (!newestNew || item.createdAtMs > newestNew.createdAtMs) {
          newestNew = item;
        }
      }
    }

    if (newestNew) {
      const key = getNotificationKey(newestNew);
      const uid = auth.currentUser?.uid ?? null;
      // Atomic cross-presenter claim: if the system path already claimed this
      // key (same tick), stay silent instead of doubling.
      if (mountedRef.current && tryClaimPresentedKey(uid, key)) {
        present(newestNew);
      }
    }
  }, [
    items,
    lastSeenMs,
    lastSeenLoaded,
    verificationSeenKey,
    verificationSeenLoaded,
    presentedLoaded,
    loading,
    present,
  ]);

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

    const openedKind = toast.kind;
    dismiss();
    try {
      router.push("/regular_user/notifications");
    } catch {
      // Navigation must never crash the app.
    }
    try {
      // Verification toasts acknowledge ONLY the verification decision —
      // never bump the report wall-clock. Report toasts keep the existing
      // mark-all behavior.
      if (openedKind === "verification") {
        void markVerificationAsSeen();
      } else {
        void markAllAsRead();
      }
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
          accessibilityLabel={
            toast.kind === "verification"
              ? `Account verification ${toast.status} notification`
              : `New notification for report ${toast.reportId}`
          }
        >
          <View style={styles.iconWrap}>
            <Ionicons
              name={toast.kind === "verification" ? "shield-checkmark" : "notifications"}
              size={20}
              color="#FFFFFF"
            />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {toast.kind === "verification"
                ? toast.status === "Verified"
                  ? "Account verified"
                  : "Verification update"
                : `Report #${toast.reportId}`}
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

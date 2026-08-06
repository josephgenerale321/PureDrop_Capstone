import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { type NotificationItem, useReportNotifications } from "./notif_func";
import { isNotificationUnread } from "./notif_reddot";

/**
 * Android notification channel used for report-update local notifications.
 * Imported from the same constants shared with the push-registration flow so
 * the OS channel is consistent across both paths.
 */
const LOCAL_CHANNEL_ID = "report-updates";

/**
 * Native module names required by the expo-notifications module graph.
 * These are the exact `requireNativeModule(...)` names used inside
 * expo-notifications' build output (verified against 0.32.17). Loading
 * expo-notifications on a runtime that lacks these native modules throws
 * `Cannot find native module '...'` at module evaluation time, so we MUST
 * check availability BEFORE requiring the module.
 *
 * Using `requireOptionalNativeModule` returns `null` instead of throwing,
 * which lets us detect the missing module safely and skip local system
 * notifications entirely (no crash on Expo Go / web / stale builds).
 */
const REQUIRED_NOTIFICATION_MODULES = [
  "ExpoPushTokenManager",
  "ExpoNotificationScheduler",
  "ExpoNotificationChannelManager",
  "ExpoNotificationPermissionsModule",
  "ExpoNotificationsHandlerModule",
  "ExpoNotificationsEmitter",
  "ExpoBadgeModule",
  "ExpoNotificationCategoriesModule",
  "ExpoNotificationChannelGroupManager",
  "ExpoNotificationPresenter",
  "NotificationsServerRegistrationModule",
  "ExpoBackgroundNotificationTasksModule",
] as const;

/**
 * True when the `expo-notifications` native module graph is available in the
 * current runtime. We only attempt local system notifications when this is
 * true, so dev/preview/Expo Go/web builds that lack the native module are
 * completely safe (the component just renders nothing).
 */
const isLocalNotificationsAvailable = (): boolean => {
  if (Platform.OS === "web") {
    return false;
  }

  try {
    return REQUIRED_NOTIFICATION_MODULES.every((moduleName) => {
      const nativeModule = requireOptionalNativeModule(moduleName);
      return nativeModule != null;
    });
  } catch {
    return false;
  }
};

/**
 * Lazily loads the expo-notifications module, but ONLY when the required
 * native modules are present.
 *
 * IMPORTANT: This path uses `scheduleNotificationAsync` (local notification),
 * NOT `getExpoPushTokenAsync` (remote push). This means it never touches FCM
 * or APNs and never requires a Firebase App instance — so it does NOT trigger
 * the `Default FirebaseApp is not initialized` warning, and it works in
 * development and preview builds without push credentials.
 */
const getLocalNotificationsModule = () => {
  if (!isLocalNotificationsAvailable()) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    return Notifications;
  } catch {
    return null;
  }
};

/**
 * Builds a stable "dedupe key" for a notification item.
 *
 * A report's Firestore document id does NOT change when the admin updates its
 * status — only `statusUpdatedAt` (and therefore `createdAtMs`) and `status`
 * change. Tracking by document id alone would make a status update to an
 * already-seen report invisible (the system notification never appears). So we
 * key on the triplet `reportId + createdAtMs + status`, which changes every
 * time the admin sets a new status.
 */
const getNotificationKey = (item: NotificationItem): string =>
  `${item.id}:${item.createdAtMs}:${item.status}`;

/**
 * Module-level "already seen / already presented" trackers.
 *
 * Same rationale as floating_notif.tsx: component-scoped refs reset when the
 * layout remounts, which would re-present the same notification as a duplicate
 * system notification. Hoisting the sets to module scope makes each
 * notification present exactly once per app session. They survive a reopen
 * (background -> foreground, which keeps the same JS context), but are empty on
 * a cold phone/emulator restart (new JS context), so the app-open presentation
 * only fires after a genuine restart.
 */
const seededKeysRef = new Set<string>();
const presentedKeysRef = new Set<string>();
const MAX_PRESENTED_KEYS = 200;

/**
 * Records a key into the module-level "presented" set, pruning the oldest
 * entries when the set grows too large to avoid unbounded memory growth.
 */
const markPresented = (key: string): void => {
  presentedKeysRef.add(key);
  if (presentedKeysRef.size > MAX_PRESENTED_KEYS) {
    const oldest = presentedKeysRef.values().next().value;
    if (oldest !== undefined) {
      presentedKeysRef.delete(oldest);
    }
  }
};

/**
 * Clears the module-scoped system-notification session state so a future
 * sign-in starts clean (no stale "already seen / presented" keys leaking
 * across sessions). Called on explicit logout. Crash-safe: it only mutates
 * in-memory sets.
 */
export const resetSystemNotificationState = (): void => {
  seededKeysRef.clear();
  presentedKeysRef.clear();
};

/**
 * Builds the human-readable message for a report-update local notification.
 * Mirrors the message used by the in-app banner and the push functions so the
 * wording is consistent everywhere.
 */
const buildLocalMessage = (item: NotificationItem): string => {
  if (item.changedByAdmin) {
    if (item.status === "Approved") {
      return `Admin approved your report #${item.reportId}.`;
    }
    if (item.status === "Resolving") {
      return `Admin marked your report #${item.reportId} as resolving.`;
    }
if (item.status === "Pending") {
      return `Admin set your report #${item.reportId} to pending.`;
    }
    if (item.status === "Rejected") {
      return `Admin rejected your report #${item.reportId}.`;
    }
  }

  if (item.status === "Approved") {
    return `Your report #${item.reportId} has been approved.`;
  }
  if (item.status === "Resolving") {
    return `Your report #${item.reportId} is now resolving.`;
  }
  if (item.status === "Rejected") {
    return `Your report #${item.reportId} has been rejected.`;
  }
  return `Your report #${item.reportId} is still pending.`;
};

/**
 * Presents a single local system notification immediately.
 *
 * @returns the notification id on success, or null if it could not be shown.
 */
const presentLocalNotification = async (
  Notifications: any,
  item: NotificationItem,
): Promise<string | null> => {
  try {
    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync(LOCAL_CHANNEL_ID, {
          name: "Report Updates",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#0EA5E9",
        });
      } catch {
        // Channel setup is best-effort; the default channel still works.
      }
    }

    const existingPermissions = await Notifications.getPermissionsAsync();
    if (existingPermissions.status !== "granted") {
      const requestedPermissions = await Notifications.requestPermissionsAsync();
      if (requestedPermissions.status !== "granted") {
        return null;
      }
    }

    const projectId = Constants.easConfig?.projectId;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Report update",
        body: buildLocalMessage(item),
        sound: "default",
        data: {
          reportId: item.reportId,
          route: "/regular_user/notifications",
          projectId,
        },
      },
      trigger: null, // Present immediately — no remote push, no FCM.
    });

    return notificationId;
  } catch {
    return null;
  }
};

/**
 * `SystemNotificationSync` — renders nothing.
 *
 * Bridges the Firestore report-notification stream into native OS
 * notifications that appear OUTSIDE the app (the system notification shade /
 * tray). This is the "floating notification" the user sees on the lock screen
 * or notification center, independent of the in-app banner.
 *
 * Behavior:
 * - On a cold app start (new JS context) it presents ONE local system
 *   notification for the newest unread report update, so reopening the app
 *   surfaces pending updates.
 * - After that, it presents a local system notification for each genuinely
 *   NEW unread report update that arrives while the app is running.
 * - A plain reopen (background -> foreground, same JS context) does NOT
 *   re-present: the module-scoped dedup sets survive the reopen, so the same
 *   notification is not shown again.
 * - It never crashes on dev/preview/web/Expo Go: all native calls are wrapped
 *   in try/catch, gated by a native-module availability check, and guarded by
 *   an `isMounted` flag.
 */
export default function SystemNotificationSync() {
  const { items, loading, lastSeenMs, lastSeenLoaded } = useReportNotifications();

const mountedRef = useRef(true);
  const appOpenResolvedRef = useRef(false);
  // Tracks whether the app is currently in the foreground. While the app is
  // ACTIVE the in-app floating banner (floating_notif.tsx) already surfaces a
  // new status change, so we suppress the native heads-up notification to avoid
  // showing the same update twice. When the app is backgrounded or on the lock
  // screen there is no in-app banner, so the native notification is shown.
  const appStateRef = useRef<boolean>(AppState.currentState === "active");

  useEffect(() => {
    mountedRef.current = true;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        appStateRef.current = true;
      } else if (nextState === "background" || nextState === "inactive") {
        appStateRef.current = false;
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    // Wait until the read timestamp has been resolved. On a fresh app/phone
    // restart, lastSeenMs is briefly 0 while AsyncStorage/Firestore load — if
    // we presented now, every notification would look unread and a phantom
    // system/push notification would appear. Gating on lastSeenLoaded prevents
    // that.
    if (loading || !lastSeenLoaded || items.length === 0) {
      return;
    }

    const Notifications = getLocalNotificationsModule();
    if (!Notifications) {
      return;
    }

    if (!appOpenResolvedRef.current) {
      appOpenResolvedRef.current = true;

      // App open: surface the newest unread report update as a system
      // notification (so the user sees it even if they weren't looking at
      // the app when it arrived).
      let newestUnread: NotificationItem | null = null;
      items.forEach((item) => {
        // Seed the module-level known set so only genuinely new updates
        // notify after this. Module scope means it survives remounts.
        seededKeysRef.add(getNotificationKey(item));
        if (isNotificationUnread(item, lastSeenMs)) {
          if (!newestUnread || item.createdAtMs > newestUnread.createdAtMs) {
            newestUnread = item;
          }
        }
      });

      if (newestUnread) {
        const key = getNotificationKey(newestUnread);
        if (!presentedKeysRef.has(key) && mountedRef.current) {
          markPresented(key);
          void presentLocalNotification(Notifications, newestUnread);
        }
      }
      return;
    }

    // Subsequent snapshots: only notify for genuinely NEW unread updates.
    // The key includes status + statusUpdatedAt, so an admin re-setting the
    // status on an EXISTING report is treated as new and shown.
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
        // Always record the key as "presented" so this update is never shown
        // again later (e.g. when the app returns to the foreground).
        markPresented(key);

        // While the app is ACTIVE the in-app floating banner has already
        // surfaced this update, so presenting a native heads-up notification
        // here would show the same status change twice. Only fire the native
        // notification when the app is NOT in the foreground (backgrounded or
        // on the lock screen), where there is no in-app banner.
        if (!appStateRef.current) {
          void presentLocalNotification(Notifications, newestNew);
        }
      }
    }
  }, [items, lastSeenMs, lastSeenLoaded, loading]);

  return null;
}

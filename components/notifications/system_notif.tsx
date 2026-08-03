import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
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
  }

  if (item.status === "Approved") {
    return `Your report #${item.reportId} has been approved.`;
  }
  if (item.status === "Resolving") {
    return `Your report #${item.reportId} is now resolving.`;
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
 * - On the first snapshot (app open / remount), it presents ONE local system
 *   notification for the newest unread report update, so reopening the app
 *   surfaces pending updates.
 * - After that, it presents a local system notification for each genuinely
 *   NEW unread report update that arrives while the app is running.
 * - It never crashes on dev/preview/web/Expo Go: all native calls are wrapped
 *   in try/catch, gated by a native-module availability check, and guarded by
 *   an `isMounted` flag.
 */
export default function SystemNotificationSync() {
  const { items, loading, lastSeenMs } = useReportNotifications();

  const mountedRef = useRef(true);
  const appOpenResolvedRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (loading || items.length === 0) {
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
        knownIdsRef.current.add(item.id);
        if (isNotificationUnread(item, lastSeenMs)) {
          if (!newestUnread || item.createdAtMs > newestUnread.createdAtMs) {
            newestUnread = item;
          }
        }
      });

      if (newestUnread && mountedRef.current) {
        void presentLocalNotification(Notifications, newestUnread);
      }
      return;
    }

    // Subsequent snapshots: only notify for genuinely NEW unread updates.
    let newestNew: NotificationItem | null = null;
    for (const item of items) {
      if (knownIdsRef.current.has(item.id)) {
        continue;
      }
      knownIdsRef.current.add(item.id);
      if (isNotificationUnread(item, lastSeenMs)) {
        if (!newestNew || item.createdAtMs > newestNew.createdAtMs) {
          newestNew = item;
        }
      }
    }

    if (newestNew && mountedRef.current) {
      void presentLocalNotification(Notifications, newestNew);
    }
  }, [items, lastSeenMs, loading]);

  return null;
}

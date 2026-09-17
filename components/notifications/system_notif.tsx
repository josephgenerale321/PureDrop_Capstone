import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { type NotificationItem, useReportNotifications } from "./notif_func";
import { isNotificationUnread } from "./notif_reddot";
import {
  getNotificationDedupeKey,
  isPresentedLoadedForUser,
  loadPresentedKeys,
  resetPresentedState,
  tryClaimPresentedKey,
} from "./supabase_presented_store";
import { auth } from "../../firebaseConfig";

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
 * Builds a stable "dedupe key" for a notification.
 * Delegates to the shared Supabase-backed store so the system notification
 * and the floating banner use the EXACT same key space (this is what stops
 * the same update presenting twice on app open). A report's document id does
 * NOT change when the admin updates its status, so the shared key uses the
 * triplet `reportId + createdAtMs + status`; verification cards key on the
 * per-decision `seenKey`.
 */
const getNotificationKey = (item: NotificationItem): string =>
  getNotificationDedupeKey(item);

/**
 * Module-level "already seen" tracker for this app session.
 * "Already presented" tracking lives in the shared Supabase-backed store
 * (`supabase_presented_store.ts`), shared with floating_notif.tsx, persisted
 * to the Supabase `notification_dedupe` table + AsyncStorage mirror.
 */
const seededKeysRef = new Set<string>();

/**
 * Clears the module-scoped system-notification session state so a future
 * sign-in starts clean. "Already presented" keys live in the shared
 * Supabase-backed store and are cleared there too (Supabase + AsyncStorage).
 */
export const resetSystemNotificationState = (): void => {
  seededKeysRef.clear();
  try {
    resetPresentedState(auth.currentUser?.uid ?? null);
  } catch {
    // Non-fatal.
  }
};

/**
 * Builds the human-readable message for a report-update local notification.
 * Mirrors the message used by the in-app banner and the push functions so the
 * wording is consistent everywhere.
 */
const buildLocalMessage = (item: NotificationItem): string => {
  // Verification cards carry their own pre-built message (same wording as
  // the outside push) — never run them through the report template.
  if (item.kind === "verification") {
    return item.message;
  }
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
    const isVerification = item.kind === "verification";
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: isVerification
          ? item.status === "Verified"
            ? "Account verified"
            : "Verification update"
          : "Report update",
        body: buildLocalMessage(item),
        sound: "default",
        data: isVerification
          ? {
              kind: "verification",
              verificationStatus: item.status.toLowerCase(),
              rejectionTarget: item.rejectionTarget ?? "both",
              route: item.route ?? "/login/validation/rejectedverif",
              projectId,
            }
          : {
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
 * Bridges the report-notification stream into native OS notifications that
 * appear OUTSIDE the app (system shade / tray). This is the user-visible
 * notification on the lock screen or notification center.
 *
 * FIX (Supabase, not Firebase): presentation is owned by the shared
 * Supabase-backed store (`supabase_presented_store.ts` -- `notification_dedupe`
 * table + AsyncStorage mirror), atomically shared with the in-app floating
 * banner. Rules:
 * - While the app is ACTIVE the floating banner owns presentation, so this
 *   path only CLAIMS the key and stays silent (no duplicate OS heads-up).
 * - On app open / cold start it seeds + claims and stays SILENT (the user is
 *   looking at the app; still-unread items live in the notifications screen).
 * - It schedules an OS notification ONLY for genuinely NEW unread updates
 *   that arrive while the app is backgrounded/inactive (no banner visible).
 * - It never fires before the shared presented-keys + read states load, so
 *   restarts never replay old updates as phantom notifications.
 */
export default function SystemNotificationSync() {
  const {
    items,
    loading,
    lastSeenMs,
    lastSeenLoaded,
    verificationSeenKey,
    verificationSeenLoaded,
  } = useReportNotifications();

const mountedRef = useRef(true);
  const appOpenResolvedRef = useRef(false);
  const appStateRef = useRef<boolean>(AppState.currentState === "active");
  const [presentedReady, setPresentedReady] = useState(false);
  // Tracks whether the app is currently in the foreground. While ACTIVE the
  // in-app floating banner (floating_notif.tsx) already surfaces a
  // new status change, so we suppress the native heads-up notification to avoid
  // showing the same update twice. When the app is backgrounded or on the lock
  // screen there is no in-app banner, so the native notification is shown.

  useEffect(() => {
    mountedRef.current = true;

    // Join the shared Supabase-backed presented-keys load so this path never
    // fires before knowing what the floating banner already presented.
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setPresentedReady(true);
      } else {
        void loadPresentedKeys(uid)
          .catch(() => new Set<string>())
          .then(() => {
            if (mountedRef.current) {
              setPresentedReady(true);
            }
          });
      }
    } catch {
      setPresentedReady(true);
    }

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
    // Wait until BOTH read states AND the shared presented-keys are loaded.
    // On a restart these are briefly unresolved while AsyncStorage/Supabase
    // load -- presenting now would replay old updates as phantom OS banners.
    // The verification gate matters most: its timestamps are frozen after the
    // decision, so without it EVERY restart replays "Account verified".
    const uid = auth.currentUser?.uid ?? null;
    if (
      loading ||
      !lastSeenLoaded ||
      !verificationSeenLoaded ||
      !presentedReady ||
      !isPresentedLoadedForUser(uid) ||
      items.length === 0
    ) {
      return;
    }

    const Notifications = getLocalNotificationsModule();
    if (!Notifications) {
      return;
    }

    if (!appOpenResolvedRef.current) {
      appOpenResolvedRef.current = true;

      // App open / cold start: seed + CLAIM every still-unread key in the
      // shared store and stay SILENT. The user is looking at the app -- the
      // floating banner owns in-app presentation and the notifications screen
      // holds the unread items. Scheduling an OS notification here is exactly
      // the "appeared when I closed/reopened the app + doubles" bug.
      items.forEach((item) => {
        seededKeysRef.add(getNotificationKey(item));
        try {
          if (
            isNotificationUnread(
              item,
              lastSeenMs,
              verificationSeenKey,
              verificationSeenLoaded,
            )
          ) {
            tryClaimPresentedKey(uid, getNotificationKey(item));
          }
        } catch {
          // Non-fatal.
        }
      });
      return;
    }

    // Subsequent snapshots: only notify for genuinely NEW unread updates.
    // The key includes status + statusUpdatedAt, so an admin re-setting the
    // status on an EXISTING report is treated as new and shown.
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
      // Atomic cross-presenter claim FIRST: if the floating banner already
      // claimed this key (same tick while ACTIVE), stay silent -- no double.
      // Only the background/inactive case schedules the OS notification.
      if (tryClaimPresentedKey(uid, key) && mountedRef.current) {
        if (!appStateRef.current) {
          void presentLocalNotification(Notifications, newestNew);
        }
      }
    }
  }, [
    items,
    lastSeenMs,
    lastSeenLoaded,
    verificationSeenKey,
    verificationSeenLoaded,
    loading,
    presentedReady,
  ]);

  return null;
}

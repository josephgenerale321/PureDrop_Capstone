import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { auth, db } from "../../firebaseConfig";

const PUSH_CHANNEL_ID = "report-updates";

type PushRegistrationResult = {
  token: string | null;
  enabled: boolean;
  error?: string;
};

/**
 * Native module names required by the expo-notifications module graph.
 * Each maps to a `requireNativeModule(...)` call inside expo-notifications'
 * build output. Loading expo-notifications on a runtime that lacks these
 * native modules throws `Cannot find native module '...'` at module
 * evaluation time.
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
 * Pre-checks whether the native modules required by expo-notifications are
 * available in the current runtime.
 *
 * IMPORTANT: We MUST check this BEFORE requiring expo-notifications. Metro's
 * `guardedLoadModule` intercepts any error thrown while a module graph is
 * being evaluated and reports it as a fatal error (via
 * `global.ErrorUtils.reportFatalError`), regardless of any surrounding
 * try/catch. So a lazy `require("expo-notifications")` inside try/catch is
 * NOT enough — the fatal error still crashes the app on runtimes that lack
 * the native module (Expo Go, web, or a stale dev build).
 *
 * Using `requireOptionalNativeModule` returns `null` instead of throwing,
 * which lets us detect the missing module safely and skip push entirely.
 */
const isPushNotificationsAvailable = (): boolean => {
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
 * Some dev environments (Expo Go, dev clients without the native module, or
 * stale builds) do not include the `ExpoPushTokenManager` native module. A
 * static `import * as Notifications from "expo-notifications"` throws at module
 * evaluation time in those environments, which crashes any route that imports
 * this file (e.g. app/regular_user/_layout.jsx).
 *
 * By pre-checking native module availability and only requiring the module
 * lazily when available, the surrounding route always loads; push
 * notifications are simply skipped when unavailable.
 */
const getNotificationsModule = () => {
  if (!isPushNotificationsAvailable()) {
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

const getProjectId = (): string | undefined => {
  const easProjectId = Constants.easConfig?.projectId;
  const extraProjectId = Constants.expoConfig?.extra?.eas?.projectId;

  return typeof easProjectId === "string" && easProjectId.length > 0
    ? easProjectId
    : typeof extraProjectId === "string" && extraProjectId.length > 0
      ? extraProjectId
      : undefined;
};

export const registerForPushNotificationsAsync =
  async (): Promise<PushRegistrationResult> => {
    try {
      if (Platform.OS === "web") {
        return { token: null, enabled: false, error: "Push notifications are not available on web." };
      }

      const Notifications = getNotificationsModule();
      if (!Notifications) {
        return {
          token: null,
          enabled: false,
          error: "expo-notifications is unavailable on this device.",
        };
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
          name: "Report Updates",
          // HIGH importance so remote pushes appear in the system shade even
          // when the app is backgrounded or fully closed. Kept consistent
          // with the local channel in system_notif.tsx.
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#0EA5E9",
        });
      }

      const existingPermissions = await Notifications.getPermissionsAsync();
      let finalStatus = existingPermissions.status;

      if (existingPermissions.status !== "granted") {
        const requestedPermissions = await Notifications.requestPermissionsAsync();
        finalStatus = requestedPermissions.status;
      }

      if (finalStatus !== "granted") {
        return { token: null, enabled: false, error: "Notification permission was not granted." };
      }

      const projectId = getProjectId();
      if (!projectId) {
        return { token: null, enabled: false, error: "Missing EAS project id." };
      }

      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      return { token: token.data, enabled: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Push notification registration failed.";

      // In dev/preview builds that do not have FCM/APNs credentials configured,
      // `getExpoPushTokenAsync` throws (e.g. "Default FirebaseApp is not
      // initialized ... fcm-credentials"). This is EXPECTED and non-fatal, and
      // the local system notification path (system_notif.tsx) covers delivery
      // in those builds. Downgrade this expected case to a quiet debug log so
      // it does not surface as a scary console warning. Remote push still
      // works normally in production builds where FCM/APNs ARE configured.
      const normalized = message.toLowerCase();
      const isFcmNotConfigured =
        normalized.includes("fcm-credentials") ||
        normalized.includes("firebaseapp is not initialized") ||
        normalized.includes("fcm") ||
        normalized.includes("apns");

      if (isFcmNotConfigured) {
        console.debug("Remote push skipped (credentials not configured for this build):", message);
      } else {
        console.warn("Push notification setup skipped:", message);
      }

      return { token: null, enabled: false, error: message };
    }
  };

export default function PushNotificationSync() {
  const router = useRouter();
  const responseSubscriptionRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        return;
      }

      const result = await registerForPushNotificationsAsync();
      if (!isMounted || !result.token) {
        return;
      }

      try {
        await updateDoc(doc(db, "regular_user", currentUser.uid), {
          expoPushToken: result.token,
          pushNotificationEnabled: result.enabled,
          pushTokenUpdatedAt: serverTimestamp(),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save push token.";
        console.warn("Push token save skipped:", message);
      }
    });

    const Notifications = getNotificationsModule();
    if (Notifications) {
      responseSubscriptionRef.current =
        Notifications.addNotificationResponseReceivedListener(() => {
          try {
            router.push("/regular_user/notifications");
          } catch {
            // Notification taps should never crash navigation.
          }
        });
    }

    return () => {
      isMounted = false;
      unsubscribeAuth();
      responseSubscriptionRef.current?.remove();
      responseSubscriptionRef.current = null;
    };
  }, [router]);

  return null;
}


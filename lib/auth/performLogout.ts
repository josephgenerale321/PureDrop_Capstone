import { type Href } from "expo-router";
import { Alert } from "react-native";
import { signOut } from "firebase/auth";
import { auth } from "../../firebaseConfig";
import {
  clearSavedLogin,
  noteManualLogout,
} from "../../components/main_layout/save_loginfunc";
import { clearProfileCache } from "../../components/main_layout/offline_profile_cache";
import { clearReports } from "../../components/my_report/offlinefunc";
import { beginLogout, finishLogout } from "./logoutState";
import { markCurrentUserInactive } from "../../app/regular_user/status/RegularUserPresenceSync";
import {
  clearPendingReportsRoute,
  unregisterPushNotificationsAsync,
} from "../../components/notifications/push_notificationfunc";
import { resetFloatingNotificationState } from "../../components/notifications/floating_notif";
import { resetSystemNotificationState } from "../../components/notifications/system_notif";
import { resetVerificationPushSyncState } from "../../components/verification/backend/verificationPushSync";
import { clearVerificationLater } from "../../components/login/backend/postEmailVerificationGate";

/** Minimal structural type so both `useRouter()` results and expo-router's
 * imperative router satisfy the parameter without importing runtime types. */
interface LogoutNavigation {
  replace: (href: Href) => void;
}

/**
 * Full sign-out sequence, shared by every logout entry point (the sign-out
 * modal, the verification hub's LOG OUT for re-rejected existing users, …).
 *
 * Steps (each best-effort — a failure never blocks the logout):
 *   1. Mark a manual logout (suppresses SaveLoginSync's optimistic restore
 *      fast path, so the app cannot bounce straight back into verification
 *      or Home after navigating away).
 *   2. Presence → offline ("manual_logout").
 *   3. Forget the locally saved login marker (no auto-login next launch).
 *   4. Clear the per-user offline profile + reports caches so the next
 *      account that signs in does not see this user's cached data.
 *   5. Unregister this user's push token (server stops delivering pushes;
 *      re-registered automatically on the next sign-in).
 *   6. Reset the module-scoped notification session state (no stale dedupe
 *      keys leaking across sessions).
 *   7. Clear the persisted "continue verification later" marker — an explicit
 *      logout must never leave a stale marker behind.
 *   8. signOut(auth) then replace to `destination`.
 *
 * On sign-out failure the logout flag is released and the standard
 * "Logout failed" alert is shown; the caller needs no extra handling.
 */
export async function performLogout(
  router: LogoutNavigation,
  destination: Href,
): Promise<void> {
  beginLogout();

  // Capture the uid BEFORE sign-out so caches, the push token and the
  // in-app notification session state are cleared for the correct user.
  const uid = auth.currentUser?.uid ?? null;

  try {
    await markCurrentUserInactive("manual_logout");
  } catch {
    // Keep sign-out flow non-blocking even if presence update fails.
  }

  try {
    noteManualLogout();
    await clearSavedLogin();
  } catch {
    // Non-fatal — Firebase sign-out still proceeds.
  }

  try {
    if (uid) {
      await clearProfileCache(uid);
      await clearReports(uid);
    }
  } catch {
    // Non-fatal — sign-out still proceeds.
  }

  try {
    if (uid) {
      await unregisterPushNotificationsAsync(uid);
    }
  } catch {
    // Non-fatal — sign-out still proceeds.
  }

  try {
    resetFloatingNotificationState(uid);
    resetSystemNotificationState();
    resetVerificationPushSyncState();
  } catch {
    // Non-fatal — only mutates in-memory sets.
  }

  try {
    await clearVerificationLater();
    if (uid) {
      await clearPendingReportsRoute(uid);
    }
  } catch {
    // Non-fatal — clearing the marker is hygiene, not a requirement.
  }

  try {
    await signOut(auth);
    router.replace(destination);
  } catch {
    finishLogout();
    Alert.alert("Logout failed", "Please try again.");
  }
}
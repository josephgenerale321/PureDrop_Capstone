/**
 * VerificationPushSync — background local push for identity-verification decisions.
 * Mounted in app/_layout.tsx (every route) because report syncs only mount in
 * regular_user/_layout.jsx which pending users can't reach. Watches
 * regular_user/{uid}.verificationStatus and fires scheduleNotificationAsync on
 * the same report-updates channel. Killed-app delivery is server-side via
 * sendVerificationStatusPush Cloud Function + admin fireVerificationStatusPush.
 */
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { auth, db } from "../../../firebaseConfig";
import { readVerificationPushHandledKey } from "../../notifications/notif_func";

const VERIFICATION_CHANNEL_ID = "report-updates";

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

const isVerificationPushAvailable = (): boolean => {
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

const getVerificationNotificationsModule = () => {
  if (!isVerificationPushAvailable()) {
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

const normalizeStatus = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "verified") return "verified";
  if (normalized === "rejected") return "rejected";
  return normalized;
};

const normalizeTarget = (value: unknown): "valid_id" | "face_scan" | "both" => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "valid_id" || normalized === "face_scan") return normalized;
  return "both";
};

const buildVerificationMessage = (
  status: string,
  rejectionTarget: "valid_id" | "face_scan" | "both",
  wasReapproved = false,
): string => {
  if (status === "verified") {
    // Mirrors notif_func: explicit admin `wasReapproved` flag selects the
    // "verified again / welcome back" wording; first approvals keep Welcome text.
    if (wasReapproved) {
      return "Your account has been verified again. Welcome back to PureDrop!";
    }
    return "Your account has been verified. Welcome to PureDrop!";
  }
  if (status === "rejected") {
    if (rejectionTarget === "valid_id") {
      return "Your Valid ID was rejected. Please resubmit it to continue.";
    }
    if (rejectionTarget === "face_scan") {
      return "Your face scan was rejected. Please resubmit it to continue.";
    }
    return "Your verification was rejected. Please re-verify your ID to continue.";
  }
  return "Your verification status has been updated. Please open the app to review it.";
};

/**
 * Per-decision fingerprint for a verification status snapshot. Mirrors the
 * seenKey built by mapUserDocToVerificationNotification in
 * components/notifications/notif_func.tsx (status + rejection count +
 * rejectionTarget) — STABLE fields only. updatedAt/verifiedAt are
 * deliberately excluded: they move on unrelated user-doc writes (push-token
 * re-register, presence heartbeat, our own ack write), which would rotate
 * the key and resurrect the badge after every reload.
 */
export const buildVerificationSeenKey = (data: {
  verificationStatus?: unknown;
  verificationRejectionCount?: unknown;
  rejectionTarget?: unknown;
  wasReapproved?: unknown;
  reapprovalCycle?: unknown;
}): string | null => {
  const normalized =
    typeof data?.verificationStatus === "string"
      ? data.verificationStatus.trim().toLowerCase()
      : "";
  if (normalized !== "verified" && normalized !== "rejected") {
    return null;
  }
  const parsedCount = Number(data?.verificationRejectionCount);
  const rejectionCount =
    Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 0;
  const rawTarget =
    typeof data?.rejectionTarget === "string"
      ? data.rejectionTarget.trim().toLowerCase()
      : "";
  const target =
    rawTarget === "valid_id" || rawTarget === "face_scan" ? rawTarget : "both";
  // Re-approval needs a NEW key: the admin approve resets
  // verificationRejectionCount to 0, so `verified:0:both` would otherwise
  // collide with the first approval (and consecutive re-approvals with each
  // other) and the "verified again" notice would never fire. The trailing
  // cycle segment mirrors mapUserDocToVerificationNotification in
  // notif_func.tsx byte-for-byte. First approvals keep the legacy 3-part shape.
  const parts = [normalized, String(rejectionCount), target];
  if (data?.wasReapproved === true) {
    const parsedReapprovalCycle = Number(data?.reapprovalCycle);
    const reapprovalCycle =
      Number.isFinite(parsedReapprovalCycle) && parsedReapprovalCycle > 0
        ? Math.floor(parsedReapprovalCycle)
        : 0;
    parts.push("reapproved", String(reapprovalCycle));
  }
  return parts.join(":");
};

/**
 * Per-user AsyncStorage key for the verification decision already seen, so
 * the background local push never re-fires for the same decision after a
 * restart. Same fingerprint contract as the in-app provider's
 * `@puredrop/verification_seen/{uid}` — both sides share the key format.
 */
const verificationSeenStorageKey = (uid: string): string =>
  `@puredrop/verification_seen/${uid}`;

let seededStatus: string | null = null;
let handledDecisionKey: string | null = null;
const appStateRef = { current: true };

/**
 * Clears the module-scoped verification-push session state so a future
 * sign-in starts clean (no stale seeded status / handled key leaking across
 * sessions). Called on explicit logout alongside the floating/system resets.
 */
export const resetVerificationPushSyncState = (): void => {
  seededStatus = null;
  handledDecisionKey = null;
};

const presentVerificationNotification = async (
  Notifications: any,
  status: string,
  rejectionTarget: "valid_id" | "face_scan" | "both",
  wasReapproved = false,
): Promise<void> => {
  try {
    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync(VERIFICATION_CHANNEL_ID, {
          name: "Report updates",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#0EA5E9",
        });
      } catch {
        // Channel setup must never block the notification.
      }
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: status === "verified" ? "Account verified" : "Verification update",
        body: buildVerificationMessage(status, rejectionTarget, wasReapproved),
        sound: "default",
        data: {
          kind: "verification",
          verificationStatus: status,
          rejectionTarget,
          wasReapproved,
          route:
            status === "verified"
              ? "/login/validation/fullyverif"
              : "/login/validation/rejectedverif",
        },
      },
      trigger: null,
    });
  } catch {
    // Local presentation must never crash the app.
  }
};

export default function VerificationPushSync() {
  // Per-login restore of the already-seen decision key. A backgrounded
  // reopen must NEVER replay the last decision as a system notification —
  // the stored key is loaded BEFORE the snapshot comparison below runs.
  const seenLoadedRef = useRef(false);
  const seenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        appStateRef.current = true;
      } else if (nextState === "background" || nextState === "inactive") {
        appStateRef.current = false;
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let unsubscribeDoc: (() => void) | undefined;
    let cancelled = false;
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      unsubscribeDoc?.();
      unsubscribeDoc = undefined;
      seenLoadedRef.current = false;
      seenKeyRef.current = null;
      if (!currentUser) {
        seededStatus = null;
        return;
      }
      const Notifications = getVerificationNotificationsModule();
      if (!Notifications) {
        return;
      }
      const uid = currentUser.uid;
      const userRef = doc(db, "regular_user", uid);
      // Restore the already-seen decision BEFORE the first snapshot: without
      // this, every backgrounded reopen replays the last decision as a fresh
      // system notification (the old "many times" bug).
      void AsyncStorage.getItem(verificationSeenStorageKey(uid))
        .then((stored) => {
          if (cancelled || auth.currentUser?.uid !== uid) {
            return;
          }
          seenKeyRef.current =
            typeof stored === "string" && stored.length > 0 ? stored : null;
        })
        .catch(() => {
          if (!cancelled && auth.currentUser?.uid === uid) {
            seenKeyRef.current = null;
          }
        })
        .finally(() => {
          if (!cancelled && auth.currentUser?.uid === uid) {
            seenLoadedRef.current = true;
          }
        });
      unsubscribeDoc = onSnapshot(
        userRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            return;
          }
          const data = snapshot.data();
          const status = normalizeStatus(data?.verificationStatus);
          const rejectionTarget = normalizeTarget(data?.rejectionTarget);
          if (seededStatus === null) {
            seededStatus = status;
            return;
          }
          if (!status || status === seededStatus) {
            seededStatus = status;
            return;
          }
          seededStatus = status;
          if (status !== "verified" && status !== "rejected") {
            return;
          }
          // Per-decision fingerprint (status + updatedAt + count + target):
          // the SAME decision across restarts / re-snapshots is never
          // re-presented, while a genuinely NEW decision always fires once.
          const seenKey = buildVerificationSeenKey(data);
          const decisionKey =
            seenKey ?? `${uid}:${status}:${String(data?.updatedAt ?? data?.verifiedAt ?? "")}`;
          if (handledDecisionKey === decisionKey) {
            return;
          }
          // Already acknowledged in-app (or on a previous run) — the in-app
          // provider writes the handled ref on every ack path, so converge
          // here and stay silent instead of replaying.
          if (readVerificationPushHandledKey() === decisionKey) {
            handledDecisionKey = decisionKey;
            return;
          }
          if (seenLoadedRef.current && seenKey != null && seenKey === seenKeyRef.current) {
            handledDecisionKey = decisionKey;
            return;
          }
          handledDecisionKey = decisionKey;
          // Persist the acknowledgement immediately so a restart before the
          // in-app provider's own write still can't replay this decision.
          if (seenKey != null) {
            seenKeyRef.current = seenKey;
            void AsyncStorage.setItem(verificationSeenStorageKey(uid), seenKey).catch(() => {
              // Non-fatal: local cache only.
            });
          }
          if (appStateRef.current) {
            return;
          }
          void presentVerificationNotification(
            Notifications,
            status,
            rejectionTarget,
            data?.wasReapproved === true,
          );
        },
        () => {
          // Read failed (offline / permissions) — safe to ignore.
        },
      );
    });
    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeDoc?.();
    };
  }, []);

  return null;
}

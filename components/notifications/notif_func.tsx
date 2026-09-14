import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../../firebaseConfig";
// Synced with verificationPushSync (module-level handled key) so every
// acknowledgement path converges — defined locally (not imported) to avoid
// a notif_func <-> verificationPushSync import cycle.
const verificationPushHandledRef: { current: string | null } = (
  globalThis as unknown as {
    __puredropVerificationHandled?: { current: string | null };
  }
).__puredropVerificationHandled ?? {
  current: null,
};
(
  globalThis as unknown as {
    __puredropVerificationHandled?: { current: string | null };
  }
).__puredropVerificationHandled = verificationPushHandledRef;

const noteVerificationDecisionSeen = (seenKey: string | null): void => {
  if (seenKey != null && seenKey.length > 0) {
    verificationPushHandledRef.current = seenKey;
  }
};

export const readVerificationPushHandledKey = (): string | null =>
  verificationPushHandledRef.current;

export const writeVerificationPushHandledKey = (seenKey: string | null): void =>
  noteVerificationDecisionSeen(seenKey);

/**
 * Per-user AsyncStorage key for the last "seen/read" notification timestamp.
 * Persisting it locally means a fresh app/phone restart can restore the read
 * state immediately instead of briefly treating every notification as unread
 * while the Firestore user snapshot (which carries `notificationsLastSeenAt`)
 * is still loading.
 */
const lastSeenStorageKey = (uid: string): string =>
  `@puredrop/notifications_last_seen/${uid}`;

/**
 * Per-user AsyncStorage key for the verification decision the user has
 * already SEEN in-app. Unlike `notificationsLastSeenAt` (a wall-clock
 * timestamp compared against report `statusUpdatedAt`s), the verification
 * card is derived from doc fields that NEVER move (`verifiedAt` can be days
 * old while the card must still show until acknowledged). So "seen" here is
 * a decision fingerprint, not a timestamp:
 *   `${status}:${updatedAt-or-verifiedAt}:${rejectionCount}`.
 *
 * A reject → re-approve → reject cycle produces a NEW fingerprint (different
 * status / updatedAt / count), so it re-fires exactly once per decision —
 * while restarts, tab switches and "Later" reopens keep the SAME fingerprint
 * and never re-fire. Persisted to AsyncStorage so the mark survives restarts
 * before the Firestore write lands (and when offline).
 *
 * Legacy installs (no stored value) treat the CURRENT decision as already
 * seen — the user lived with these decisions before this feature existed, so
 * upgrading must NOT replay a banner + system notification for a week-old
 * approval on first open. Stored legacy keys from the previous format
 * (`status:updatedAtMs:count`, 3 parts, no target) are migrated forward to
 * the current format (`status:count:target`) so one upgrade doesn't replay
 * the banner once for users who already acknowledged.
 */
const verificationSeenStorageKey = (uid: string): string =>
  `@puredrop/verification_seen/${uid}`;

/**
 * Normalizes a stored verification seen-key to the CURRENT format
 * (`status:count:target`). The previous format (`status:updatedAtMs:count`)
 * rotated on unrelated user-doc writes, so it can never equal a fresh key —
 * but its (status, count) prefix still identifies the acknowledged decision.
 * Returns null for values that match neither format.
 */
const normalizeVerificationSeenKey = (
  stored: string | null,
  current: { status: string; count: number; target: string } | null,
): string | null => {
  if (typeof stored !== "string" || stored.length === 0) {
    return null;
  }
  const parts = stored.split(":");
  // Current format already: status:count:target.
  if (
    parts.length === 3 &&
    (parts[2] === "valid_id" || parts[2] === "face_scan" || parts[2] === "both")
  ) {
    return stored;
  }
  // Legacy format: status:updatedAtMs:count. Migrate when it acknowledges the
  // same decision that is current now (same status + same count); the target
  // comes from the live doc since the legacy key never stored it.
  if (parts.length === 3 && current != null && /^\d+$/.test(parts[1])) {
    if (parts[0] === current.status && parts[2] === String(current.count)) {
      return [current.status, current.count, current.target].join(":");
    }
  }
  return null;
};

const verificationDecisionParts = (
  data: DocumentData,
): { status: string; count: number; target: string } | null => {
  const status = normalizeVerificationStatus(data?.verificationStatus);
  if (status !== "Verified" && status !== "Rejected") {
    return null;
  }
  const parsedCount = Number(data?.verificationRejectionCount);
  return {
    status: status.toLowerCase(),
    count:
      Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 0,
    target: normalizeRejectionTarget(data?.rejectionTarget),
  };
};

export type NotificationItemKind = "report" | "verification";

export type NotificationItem = {
  id: string;
  kind: NotificationItemKind;
  reportId: string;
  status: string;
  changedByAdmin: boolean;
  message: string;
  createdLabel: string;
  createdAtMs: number;
  category?: string;
  issue?: string;
  /** Deep-link route for verification cards (fullyverif / rejectedverif). */
  route?: string;
  /** Which part the admin rejected — drives the verification message. */
  rejectionTarget?: "valid_id" | "face_scan" | "both";
  /**
   * Per-decision seen fingerprint (`status:updatedAt:rejectionCount`).
   * Presenters fire once per fingerprint and "mark as read" acknowledges it;
   * restarts keep the same fingerprint so nothing replays. Reports ignore it
   * (they use wall-clock `createdAtMs > lastSeenMs`).
   */
  seenKey?: string | null;
};

const normalizeStatus = (value: unknown): string => {
  if (typeof value !== "string") {
    return "Pending";
  }

const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  if (normalized === "pending") return "Pending";
  if (normalized === "rejected") return "Rejected";

  return "Pending";
};

const formatTimestampLabel = (value: unknown): string => {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }

  const maybeTimestamp = value as Timestamp | undefined;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") {
    return maybeTimestamp.toDate().toLocaleString();
  }

  return "Date unavailable";
};

export const formatRelativeTime = (createdAtMs: number): string => {
  if (!createdAtMs || createdAtMs <= 0) {
    return "";
  }

  const now = Date.now();
  const diffMs = now - createdAtMs;
  if (diffMs < 0) {
    return "Just now";
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return "Just now";
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  try {
    return new Date(createdAtMs).toLocaleDateString();
  } catch {
    return "";
  }
};

const resolveTimestampMs = (value: unknown): number => {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }

  const maybeTimestamp = value as Timestamp | undefined;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") {
    const ms = maybeTimestamp.toDate().getTime();
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }

  return 0;
};

const buildMessage = (status: string, reportId: string, changedByAdmin: boolean) => {
  if (changedByAdmin) {
    if (status === "Approved") {
      return `Admin approved your report #${reportId}.`;
    }

    if (status === "Resolving") {
      return `Admin marked your report #${reportId} as resolving.`;
    }

if (status === "Pending") {
      return `Admin set your report #${reportId} to pending.`;
    }

    if (status === "Rejected") {
      return `Admin rejected your report #${reportId}.`;
    }
  }

  if (status === "Approved") {
    return `Your report #${reportId} has been approved.`;
  }

  if (status === "Resolving") {
    return `Your report #${reportId} is now resolving.`;
  }

  if (status === "Rejected") {
    return `Your report #${reportId} has been rejected.`;
  }

  return `Your report #${reportId} is still pending.`;
};

const normalizeVerificationStatus = (value: unknown): "Verified" | "Rejected" | "" => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "verified") return "Verified";
  if (normalized === "rejected") return "Rejected";
  return "";
};

const normalizeRejectionTarget = (
  value: unknown,
): "valid_id" | "face_scan" | "both" => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "valid_id" || normalized === "face_scan") return normalized;
  return "both";
};

const buildVerificationMessage = (
  status: "Verified" | "Rejected",
  rejectionTarget: "valid_id" | "face_scan" | "both",
): string => {
  if (status === "Verified") {
    return "Your account has been verified. Welcome to PureDrop!";
  }
  if (rejectionTarget === "valid_id") {
    return "Your Valid ID was rejected. Please resubmit it to continue.";
  }
  if (rejectionTarget === "face_scan") {
    return "Your face scan was rejected. Please resubmit it to continue.";
  }
  return "Your verification was rejected. Please re-verify your ID to continue.";
};

const resolveChangedByAdmin = (data: DocumentData): boolean => {
  const rawValue = data.statusUpdatedBy;
  if (typeof rawValue !== "string") {
    return false;
  }

  return rawValue.trim().toLowerCase() === "admin";
};

const NOTIFICATION_TIME_FIELDS = [
  "statusUpdatedAt",
  "reviewedAt",
  "resolvedAt",
  "updatedAt",
  "lastUpdatedAt",
  "submittedAt",
  "createdAt",
] as const;

const resolveVerificationDecisionTime = (data: DocumentData, status: string): unknown => {
  // STABLE decision time only — NEVER updatedAt, NEVER the "latest history
  // entry regardless of action" (anyMs/anyRaw). Those jump on unrelated
  // user-doc writes and on admin re-snapshots that rewrite verificationHistory.
  //
  // BUG FIX (order flip): the verification card used to resolve its sort/group
  // time via resolveNotificationTime(), whose fallback chain ends at
  // `updatedAt`. The user doc's `updatedAt` moves on UNRELATED writes
  // (presence heartbeat every 2 min, push-token re-register, our own
  // verificationNoticeSeenAt / notificationsLastSeenAt ack writes), so the
  // verification card's `createdAtMs` kept jumping to "now" — leaping above
  // report cards (and between Today/Earlier buckets) on every heartbeat/ack.
  // Reports keep resolveNotificationTime() (their `statusUpdatedAt` only moves
  // on a genuine admin status change, which SHOULD reorder). Verification
  // uses only decision-anchored fields below, which never move after the
  // admin decides — so the list order stays put.
  //
  // Verified: `verifiedAt` is server-stamped on approve and untouched by
  // anything else — most accurate, prefer it.
  // Rejected: `verifiedAt` is cleared to null on reject, so the audit-trail
  // `verificationHistory` entry (`at`, written once per decision) is the only
  // true decision time. Submission/creation times are stable fallbacks for
  // legacy docs without history (approximate but never jump).
  //
  // We deliberately DO NOT fall back to "the latest history entry regardless
  // of action": if the admin service rewrites verificationHistory on every
  // re-snapshot (even when the decision hasn't changed), that latest entry's
  // `at` would jump to now and re-flip the list order. Only the EXACT matching
  // decision entry (or, when absent, the stable submission/creation times) is
  // used — never a "latest whatever" entry.
  if (status === "Verified" && resolveTimestampMs(data?.verifiedAt) > 0) {
    return data.verifiedAt;
  }

  const history = Array.isArray(data?.verificationHistory)
    ? (data.verificationHistory as Record<string, unknown>[])
    : [];
  let matchMs = 0;
  let matchRaw: unknown = null;
  for (const entry of history) {
    const action =
      entry != null && typeof entry.action === "string"
        ? entry.action.toLowerCase()
        : "";
    const entryStatus =
      action === "approved" ? "Verified" : action === "rejected" ? "Rejected" : "";
    if (entryStatus !== status) {
      continue;
    }
    const ms = resolveTimestampMs(entry?.at);
    if (ms > matchMs) {
      matchMs = ms;
      matchRaw = entry?.at;
    }
  }
  if (matchMs > 0) {
    return matchRaw;
  }

  // No matching decision entry in history (legacy doc / missing history).
  // Use stable submission/creation times only — never a "latest history entry"
  // which could be volatile.
  const faceMs = resolveTimestampMs(data?.faceScanSubmittedAt);
  const validMs = resolveTimestampMs(data?.validIdSubmittedAt);
  if (faceMs > 0 || validMs > 0) {
    return faceMs >= validMs ? data.faceScanSubmittedAt : data.validIdSubmittedAt;
  }
  if (resolveTimestampMs(data?.createdAt) > 0) {
    return data.createdAt;
  }
  return null;
};

const resolveNotificationTime = (data: DocumentData): unknown => {
  for (const field of NOTIFICATION_TIME_FIELDS) {
    const value = data[field];
    if (resolveTimestampMs(value) > 0) {
      return value;
    }
  }

  return undefined;
};

const mapReportToNotification = (
  snap: QueryDocumentSnapshot<DocumentData>,
): NotificationItem => {
  const data = snap.data();
  const reportId =
    typeof data.reportId === "string" && data.reportId.length > 0
      ? data.reportId
      : snap.id;
  const status = normalizeStatus(data.status);
  const notificationTime = resolveNotificationTime(data);
  const changedByAdmin = resolveChangedByAdmin(data);

  return {
    id: snap.id,
    kind: "report",
    reportId,
    status,
    changedByAdmin,
    message: buildMessage(status, reportId, changedByAdmin),
    createdLabel: formatTimestampLabel(notificationTime),
    createdAtMs: resolveTimestampMs(notificationTime),
    category:
      typeof data.category === "string" && data.category.length > 0
        ? data.category
        : undefined,
    issue:
      typeof data.issue === "string" && data.issue.length > 0
        ? data.issue
        : undefined,
  };
};

/**
 * Maps the signed-in user's `regular_user` document to a synthetic
 * verification notification card when the admin has made a terminal decision
 * (approved / rejected). Mirrors the outside-push wording (edge function +
 * Cloud Function + VerificationPushSync) so the in-app list, the in-app
 * floating banner and the lock-screen banner all say the same thing.
 */
const mapUserDocToVerificationNotification = (
  uid: string,
  data: DocumentData,
): NotificationItem | null => {
  const status = normalizeVerificationStatus(data?.verificationStatus);
  if (status !== "Verified" && status !== "Rejected") {
    return null;
  }

  const rejectionTarget = normalizeRejectionTarget(data?.rejectionTarget);
  const isVerified = status === "Verified";
  // Stable decision time (verifiedAt / verificationHistory / submissions) —
  // NEVER updatedAt, which jumps on heartbeats/acks and flipped the list order.
  const decidedAt = resolveVerificationDecisionTime(data, status);
  const createdAtMs = resolveTimestampMs(decidedAt);

  // Per-decision fingerprint — STABLE fields only. Same admin decision across
  // restarts = same key (no replay); a NEW decision (status flip, bumped
  // rejection count, or a target correction like both -> valid_id) = new key
  // (fires exactly once).
  //
  // Deliberately EXCLUDES updatedAt/verifiedAt: those move on UNRELATED
  // user-doc writes (push-token re-register on every foreground, presence
  // heartbeat every 2 min, and — critically — our own
  // verificationNoticeSeenAt ack write). Including them made the key rotate
  // on every save/mark-as-read, so the badge resurrected after every reload.
  const parsedCount = Number(data?.verificationRejectionCount);
  const rejectionCount =
    Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 0;
  const seenKey = [
    status.toLowerCase(),
    String(rejectionCount),
    rejectionTarget,
  ].join(":");

  return {
    id: `verification:${uid}:${status.toLowerCase()}`,
    kind: "verification",
    reportId: "",
    status,
    changedByAdmin: true,
    message: buildVerificationMessage(status, rejectionTarget),
    createdLabel: formatTimestampLabel(decidedAt),
    createdAtMs,
    rejectionTarget,
    seenKey,
    route: isVerified
      ? "/login/validation/fullyverif"
      : "/login/validation/rejectedverif",
  };
};

export type NotificationContextValue = {
  items: NotificationItem[];
  loading: boolean;
  hasError: boolean;
  refreshing: boolean;
  unreadCount: number;
  lastSeenMs: number;
  /**
   * True once the last-seen/read timestamp has been resolved from local
   * storage and/or Firestore. Until this is true, unreadCount is 0 and the
   * floating/system notification presenters wait — so a fresh app/phone
   * restart never shows phantom unread notifications while the read state is
   * still loading.
   */
  lastSeenLoaded: boolean;
  /**
   * Per-decision verification seen fingerprint
   * (`status:updatedAt:rejectionCount`), or null when no decision / not yet
   * restored. Pass to isNotificationUnread/hasUnreadNotifications for
   * verification items — wall-clock lastSeenMs can never clear them.
   */
  verificationSeenKey: string | null;
  /**
   * True once the verification seen-key has been restored (AsyncStorage read
   * settled for this login). Verification presenters + unread checks must
   * wait for this, same as lastSeenLoaded for reports.
   */
  verificationSeenLoaded: boolean;
  markAllAsRead: () => Promise<void>;
  /** Acknowledges the verification card only (reports untouched). */
  markVerificationAsSeen: () => Promise<void>;
  refresh: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function ReportNotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [reportItems, setReportItems] = useState<NotificationItem[]>([]);
  const [verificationItem, setVerificationItem] =
    useState<NotificationItem | null>(null);
  // Decision fingerprint of the verification card the user has already SEEN
  // in-app (status + updatedAt + rejectionCount). Unlike the report
  // wall-clock `lastSeenMs`, this must NOT move with timestamps — the card's
  // underlying fields (verifiedAt/updatedAt) are frozen after the decision,
  // so read state = "this exact decision was acknowledged". Loaded from
  // AsyncStorage (instant, survives restarts) then reconciled with the
  // Firestore `verificationNoticeSeenKey` field below.
  const [verificationSeenKey, setVerificationSeenKey] = useState<string | null>(
    null,
  );
  // True once the local seen-key has been restored (per login). Presenters
  // must wait for this — otherwise a restart replays the banner while the
  // stored key is still loading.
  const [verificationSeenLoaded, setVerificationSeenLoaded] =
    useState<boolean>(false);
  const verificationSeenKeyRef = useRef<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastSeenMs, setLastSeenMs] = useState<number>(0);
  const [lastSeenLoaded, setLastSeenLoaded] = useState<boolean>(false);
  const currentUidRef = useRef<string | null>(null);
  const lastSeenMsRef = useRef<number>(0);
  const itemsRef = useRef<NotificationItem[]>([]);
  const [hasError, setHasError] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const setLastSeenMsSafe = useCallback((value: number) => {
    lastSeenMsRef.current = value;
    setLastSeenMs((prev) => (prev === value ? prev : value));
  }, []);

// Persist the last-seen/read timestamp to local storage whenever it changes
  // so a fresh app/phone restart can restore read state immediately (no false
  // "everything unread" window while Firestore is still loading).
  useEffect(() => {
    const uid = currentUidRef.current;
    if (!uid || lastSeenMs <= 0) {
      return;
    }
    void AsyncStorage.setItem(lastSeenStorageKey(uid), String(lastSeenMs)).catch(
      () => {
        // Non-fatal: read state still lives in Firestore.
      },
    );
  }, [lastSeenMs]);

  useEffect(() => {
    let unsubscribeReports: (() => void) | null = null;
    let unsubscribeUser: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeReports) {
        unsubscribeReports();
        unsubscribeReports = null;
      }
      if (unsubscribeUser) {
        unsubscribeUser();
        unsubscribeUser = null;
      }

      if (!currentUser) {
        currentUidRef.current = null;
        verificationSeenKeyRef.current = null;
        setItems([]);
        setReportItems([]);
        setVerificationItem(null);
        setVerificationSeenKey(null);
        setVerificationSeenLoaded(false);
        setLastSeenMsSafe(0);
        setLastSeenLoaded(false);
        setLoading(false);
        setHasError(false);
        setRefreshing(false);
        return;
      }

      // Same-user auth re-emit (Firebase re-fires onAuthStateChanged on token
      // refresh / warm reload WITHOUT changing uid): listeners are already
      // healthy and their snapshots still fresh — re-subscribing would briefly
      // reset to empty snapshots and drop the merged read state, making the
      // [1] badge flash after reopen. Only full subscribe on a DIFFERENT uid.
      if (
        currentUidRef.current === currentUser.uid &&
        (unsubscribeReports || unsubscribeUser)
      ) {
        return;
      }

      currentUidRef.current = currentUser.uid;
      setLoading(itemsRef.current.length === 0);
      setHasError(false);

      // Restore the read timestamp from local storage immediately so there is
      // never a window where lastSeenMs is 0 (which would make every
      // notification look unread on a fresh app/phone restart). This is
      // best-effort and non-fatal.
      void (async () => {
        try {
          const stored = await AsyncStorage.getItem(lastSeenStorageKey(currentUser.uid));
          const parsed = stored ? Number(stored) : 0;
          const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          if (resolved > 0) {
            setLastSeenMsSafe(Math.max(resolved, lastSeenMsRef.current));
          }
        } catch {
          // Non-fatal: Firestore will provide the authoritative value below.
        }
      })();

      // Restore the verification seen-key from local storage. Presenters gate
      // on verificationSeenLoaded so no banner fires before this resolves.
      // Stored legacy keys (previous `status:updatedAtMs:count` format) can't
      // be migrated yet — the live doc hasn't loaded — so keep the raw value
      // for now; the user-snapshot handler below migrates it against the doc.
      void (async () => {
        try {
          const stored = await AsyncStorage.getItem(
            verificationSeenStorageKey(currentUser.uid),
          );
          const resolved =
            typeof stored === "string" && stored.length > 0 ? stored : null;
          verificationSeenKeyRef.current = resolved;
          setVerificationSeenKey(resolved);
        } catch {
          verificationSeenKeyRef.current = null;
          setVerificationSeenKey(null);
        } finally {
          setVerificationSeenLoaded(true);
        }
      })();

      const userRef = doc(db, "regular_user", currentUser.uid);
      unsubscribeUser = onSnapshot(
        userRef,
        (userSnap) => {
          if (!userSnap.exists()) {
            setLastSeenMsSafe(0);
            setLastSeenLoaded(true);
            setVerificationItem(null);
            return;
          }

          const userData = userSnap.data() as { notificationsLastSeenAt?: unknown };
          const resolvedLastSeenMs = resolveTimestampMs(userData.notificationsLastSeenAt);

          // Take the max so a locally-restored value is never regressed by a
          // stale server value, and vice versa. Read state only moves forward.
          if (resolvedLastSeenMs > 0 || lastSeenMsRef.current <= 0) {
            setLastSeenMsSafe(
              resolvedLastSeenMs > lastSeenMsRef.current
                ? resolvedLastSeenMs
                : lastSeenMsRef.current,
            );
          }
          setLastSeenLoaded(true);

          // Verification card: derive from the same user snapshot so the
          // in-app list shows the latest admin approve / reject decision on
          // top, alongside the report cards. Also reconciles the Firestore
          // `verificationNoticeSeenKey` (cross-device) — take max semantics:
          // either side having seen this exact decision marks it seen.
          const userDocData = userSnap.data() as DocumentData;
          const nextVerification = mapUserDocToVerificationNotification(
            currentUser.uid,
            userDocData,
          );
          setVerificationItem(nextVerification);

          // Migrate a stored legacy seen-key (`status:updatedAtMs:count`) to
          // the current format once the live doc is available, so users who
          // already acknowledged don't replay the banner once after upgrade.
          const decisionParts = verificationDecisionParts(userDocData);
          const migratedSeenKey = normalizeVerificationSeenKey(
            verificationSeenKeyRef.current,
            decisionParts,
          );
          if (
            migratedSeenKey != null &&
            migratedSeenKey !== verificationSeenKeyRef.current
          ) {
            verificationSeenKeyRef.current = migratedSeenKey;
            setVerificationSeenKey(migratedSeenKey);
            noteVerificationDecisionSeen(migratedSeenKey);
            void AsyncStorage.setItem(
              verificationSeenStorageKey(currentUser.uid),
              migratedSeenKey,
            ).catch(() => {
              // Non-fatal: local cache only.
            });
          }

          const serverSeenKey =
            typeof userDocData?.verificationNoticeSeenKey === "string" &&
            userDocData.verificationNoticeSeenKey.length > 0
              ? (userDocData.verificationNoticeSeenKey as string)
              : null;
          if (
            serverSeenKey &&
            serverSeenKey !== verificationSeenKeyRef.current
          ) {
            verificationSeenKeyRef.current = serverSeenKey;
            setVerificationSeenKey(serverSeenKey);
            noteVerificationDecisionSeen(serverSeenKey);
            void AsyncStorage.setItem(
              verificationSeenStorageKey(currentUser.uid),
              serverSeenKey,
            ).catch(() => {
              // Non-fatal: local cache only.
            });
          }

          // Legacy upgrade path: no local key AND no server key means this
          // install predates per-decision seen tracking — the current decision
          // was already lived-with, so adopt it as seen instead of replaying
          // a banner + system notification for a days-old approval on first
          // open. Genuinely NEW decisions (different fingerprint arriving
          // later) still fire exactly once via the presenter + ack below.
          if (
            verificationSeenKeyRef.current == null &&
            serverSeenKey == null &&
            nextVerification?.seenKey != null
          ) {
            verificationSeenKeyRef.current = nextVerification.seenKey;
            setVerificationSeenKey(nextVerification.seenKey);
            noteVerificationDecisionSeen(nextVerification.seenKey);
            void AsyncStorage.setItem(
              verificationSeenStorageKey(currentUser.uid),
              nextVerification.seenKey,
            ).catch(() => {
              // Non-fatal: local cache only.
            });
          }
        },
        () => {
          // On error, still mark lastSeen as loaded so the UI is usable and
          // the floating/system presenters are not blocked forever.
          setLastSeenLoaded(true);
          setRefreshing(false);
        },
      );

      const reportsRef = collection(db, "regular_user", currentUser.uid, "reports");

      unsubscribeReports = onSnapshot(
        reportsRef,
        (snap) => {
          const mapped = snap.docs
            .map(mapReportToNotification)
            .sort((a, b) => b.createdAtMs - a.createdAtMs);

          setReportItems(mapped);
          setLoading(false);
          setHasError(false);
          setRefreshing(false);
        },
        () => {
          setHasError(true);
          setRefreshing(false);
          setLoading(false);
        },
      );

    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeReports) {
        unsubscribeReports();
      }
      if (unsubscribeUser) {
        unsubscribeUser();
      }
    };
  }, [refreshToken, setLastSeenMsSafe]);

  const unreadCount = useMemo(() => {
    // Only count unread once the read timestamp has been resolved. Until then
    // (fresh app/phone restart, snapshots still loading) there is a window
    // where lastSeenMs is 0 — showing every notification as unread would be a
    // false "phantom unread" count. Returning 0 + the presenters being gated on
    // lastSeenLoaded avoids that.
    if (!lastSeenLoaded) {
      return 0;
    }
    let count = 0;
    for (const item of items) {
      if (item.kind === "verification") {
        // Verification read state is per-decision (seenKey), NOT wall-clock:
        // its underlying timestamps are frozen after the decision, so
        // comparing createdAtMs > lastSeenMs would stay unread forever.
        if (
          verificationSeenLoaded &&
          item.seenKey != null &&
          item.seenKey !== verificationSeenKey
        ) {
          count += 1;
        }
        continue;
      }
      if (lastSeenMs <= 0 || item.createdAtMs > lastSeenMs) {
        count += 1;
      }
    }
    return count;
  }, [items, lastSeenMs, lastSeenLoaded, verificationSeenKey, verificationSeenLoaded]);

  const markAllAsRead = useCallback(async () => {
    const uid = currentUidRef.current;
    if (!uid) {
      return;
    }

    const currentItems = itemsRef.current;
    const currentLastSeen = lastSeenMsRef.current;
    const hasUnreadReport = currentItems.some(
      (item) => item.kind !== "verification" && item.createdAtMs > currentLastSeen,
    );
    const currentVerification = currentItems.find(
      (item) => item.kind === "verification",
    );
    const hasUnseenVerification =
      verificationSeenLoaded &&
      currentVerification?.seenKey != null &&
      currentVerification.seenKey !== verificationSeenKeyRef.current;

    // Idempotent: skip the Firestore write when there is nothing new to
    // mark as read. Focus/tab events can fire repeatedly, and without this
    // guard each call would issue a redundant serverTimestamp() write.
    if (!hasUnreadReport && !hasUnseenVerification) {
      return;
    }

    const optimisticLastSeenMs = Date.now();
    const previousLastSeenMs = lastSeenMsRef.current;
    const previousVerificationSeen = verificationSeenKeyRef.current;
    setLastSeenMsSafe(optimisticLastSeenMs);
    if (hasUnseenVerification && currentVerification?.seenKey != null) {
      verificationSeenKeyRef.current = currentVerification.seenKey;
      setVerificationSeenKey(currentVerification.seenKey);
      noteVerificationDecisionSeen(currentVerification.seenKey);
      void AsyncStorage.setItem(
        verificationSeenStorageKey(uid),
        currentVerification.seenKey,
      ).catch(() => {
        // Non-fatal: server write below is authoritative.
      });
    }
    try {
      const userRef = doc(db, "regular_user", uid);
      // One write covers both: wall-clock for reports + decision fingerprint
      // for verification. A SINGLE serverTimestamp() for BOTH timestamps
      // keeps them consistent (no ordering skew between two separate writes).
      await updateDoc(userRef, {
        notificationsLastSeenAt: serverTimestamp(),
        ...(hasUnseenVerification && currentVerification?.seenKey != null
          ? {
              verificationNoticeSeenKey: currentVerification.seenKey,
              verificationNoticeSeenAt: serverTimestamp(),
            }
          : {}),
      });
    } catch {
      setLastSeenMsSafe(previousLastSeenMs);
      if (hasUnseenVerification) {
        verificationSeenKeyRef.current = previousVerificationSeen;
        setVerificationSeenKey(previousVerificationSeen);
      }
    }
  }, [setLastSeenMsSafe, verificationSeenLoaded]);

  /**
   * Acknowledges the verification card WITHOUT touching reports: marks the
   * current decision fingerprint seen locally + in Firestore. The same write
   * the presenters watch, so acknowledging silences the banner path too.
   */
  const markVerificationAsSeen = useCallback(async () => {
    const uid = currentUidRef.current;
    const currentVerification = itemsRef.current.find(
      (item) => item.kind === "verification",
    );
    if (!uid || currentVerification?.seenKey == null) {
      return;
    }
    if (
      verificationSeenKeyRef.current === currentVerification.seenKey
    ) {
      return;
    }
    const previous = verificationSeenKeyRef.current;
    verificationSeenKeyRef.current = currentVerification.seenKey;
    setVerificationSeenKey(currentVerification.seenKey);
    noteVerificationDecisionSeen(currentVerification.seenKey);
    void AsyncStorage.setItem(
      verificationSeenStorageKey(uid),
      currentVerification.seenKey,
    ).catch(() => {
      // Non-fatal.
    });
    try {
      await updateDoc(doc(db, "regular_user", uid), {
        verificationNoticeSeenKey: currentVerification.seenKey,
        verificationNoticeSeenAt: serverTimestamp(),
      });
    } catch {
      verificationSeenKeyRef.current = previous;
      setVerificationSeenKey(previous);
    }
  }, []);

  const refresh = useCallback(() => {
    setHasError(false);
    setRefreshing(true);
    setRefreshToken((token) => token + 1);
  }, []);

  // Merge: verification decision card on top (by decision time), then report
  // cards. Keeps the previous array reference when nothing changed so
  // downstream presenters don't re-fire.
  //
  // STALE-SOURCE GUARD: reportItems/verificationItem are snapshot-derived and
  // briefly STALE (empty reportItems + null verificationItem) while listeners
  // re-subscribe after auth restore. Blindly merging them here would rebuild
  // `items` empty and DROP the fresh merged state — resurrecting an already-
  // read verification card (and its [1] badge) right after reload. Skip the
  // merge until at least one source has produced data, same as the report
  // section subscribe does.
  useEffect(() => {
    if (reportItems.length === 0 && verificationItem == null) {
      return;
    }
    // Newest-first by stable decision/status time. Tie-break is deterministic
    // (verification first, then id) so equal-second timestamps can never flip
    // the visible order between snapshots.
    const merged = (
      verificationItem ? [verificationItem, ...reportItems] : [...reportItems]
    ).sort((a, b) => {
      if (b.createdAtMs !== a.createdAtMs) {
        return b.createdAtMs - a.createdAtMs;
      }
      if (a.kind !== b.kind) {
        return a.kind === "verification" ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    setItems((prev) => {
      if (prev.length !== merged.length) {
        return merged;
      }
      for (let i = 0; i < prev.length; i += 1) {
        const a = prev[i];
        const b = merged[i];
        if (
          a.id !== b.id ||
          a.kind !== b.kind ||
          a.reportId !== b.reportId ||
          a.status !== b.status ||
          a.changedByAdmin !== b.changedByAdmin ||
          a.message !== b.message ||
          a.createdLabel !== b.createdLabel ||
          a.createdAtMs !== b.createdAtMs ||
          a.category !== b.category ||
          a.issue !== b.issue ||
          a.route !== b.route ||
          a.rejectionTarget !== b.rejectionTarget ||
          a.seenKey !== b.seenKey
        ) {
          return merged;
        }
      }
      return prev;
    });
  }, [reportItems, verificationItem]);

  return (
    <NotificationContext.Provider
value={{
        items,
        loading,
        hasError,
        refreshing,
        unreadCount,
        lastSeenMs,
        lastSeenLoaded,
        verificationSeenKey,
        verificationSeenLoaded,
        markAllAsRead,
        markVerificationAsSeen,
        refresh,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useReportNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) {
    // Throw only if misused outside the provider tree. In this app the
    // provider wraps the whole regular_user layout, so this is a
    // programming-error guard, not a runtime crash path.
    throw new Error(
      "useReportNotifications must be used within a ReportNotificationsProvider",
    );
  }
  return value;
}

export { ReportNotificationsProvider };

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

/**
 * Per-user AsyncStorage key for the last "seen/read" notification timestamp.
 * Persisting it locally means a fresh app/phone restart can restore the read
 * state immediately instead of briefly treating every notification as unread
 * while the Firestore user snapshot (which carries `notificationsLastSeenAt`)
 * is still loading.
 */
const lastSeenStorageKey = (uid: string): string =>
  `@puredrop/notifications_last_seen/${uid}`;

export type NotificationItem = {
  id: string;
  reportId: string;
  status: string;
  changedByAdmin: boolean;
  message: string;
  createdLabel: string;
  createdAtMs: number;
  category?: string;
  issue?: string;
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
  markAllAsRead: () => Promise<void>;
  refresh: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function ReportNotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
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
        setItems([]);
        setLastSeenMsSafe(0);
        setLastSeenLoaded(false);
        setLoading(false);
        setHasError(false);
        setRefreshing(false);
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

      const userRef = doc(db, "regular_user", currentUser.uid);
      unsubscribeUser = onSnapshot(
        userRef,
        (userSnap) => {
          if (!userSnap.exists()) {
            setLastSeenMsSafe(0);
            setLastSeenLoaded(true);
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

          setItems((prev) => {
            if (prev.length !== mapped.length) {
              return mapped;
            }

            for (let i = 0; i < prev.length; i += 1) {
              const a = prev[i];
              const b = mapped[i];
              if (
                a.id !== b.id ||
                a.reportId !== b.reportId ||
                a.status !== b.status ||
                a.changedByAdmin !== b.changedByAdmin ||
                a.message !== b.message ||
                a.createdLabel !== b.createdLabel ||
                a.createdAtMs !== b.createdAtMs ||
                a.category !== b.category ||
                a.issue !== b.issue
              ) {
                return mapped;
              }
            }

return prev;
          });
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
    if (lastSeenMs <= 0) {
      return items.length;
    }
    return items.filter((item) => item.createdAtMs > lastSeenMs).length;
  }, [items, lastSeenMs, lastSeenLoaded]);

  const markAllAsRead = useCallback(async () => {
    const uid = currentUidRef.current;
    if (!uid) {
      return;
    }

    const currentItems = itemsRef.current;
    const currentLastSeen = lastSeenMsRef.current;
    const hasUnread = currentItems.some(
      (item) => item.createdAtMs > currentLastSeen,
    );

    // Idempotent: skip the Firestore write when there is nothing new to
    // mark as read. Focus/tab events can fire repeatedly, and without this
    // guard each call would issue a redundant serverTimestamp() write.
    if (!hasUnread) {
      return;
    }

    const optimisticLastSeenMs = Date.now();
    const previousLastSeenMs = lastSeenMsRef.current;
    setLastSeenMsSafe(optimisticLastSeenMs);
    try {
      const userRef = doc(db, "regular_user", uid);
      await updateDoc(userRef, {
        notificationsLastSeenAt: serverTimestamp(),
      });
    } catch {
      setLastSeenMsSafe(previousLastSeenMs);
    }
  }, [setLastSeenMsSafe]);

  const refresh = useCallback(() => {
    setHasError(false);
    setRefreshing(true);
    setRefreshToken((token) => token + 1);
  }, []);

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
        markAllAsRead,
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

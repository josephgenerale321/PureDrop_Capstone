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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../firebaseConfig";

export type NotificationItem = {
  id: string;
  reportId: string;
  status: string;
  changedByAdmin: boolean;
  message: string;
  createdLabel: string;
  createdAtMs: number;
};

const normalizeStatus = (value: unknown): string => {
  if (typeof value !== "string") {
    return "Pending";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  if (normalized === "pending") return "Pending";

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
  }

  if (status === "Approved") {
    return `Your report #${reportId} has been approved.`;
  }

  if (status === "Resolving") {
    return `Your report #${reportId} is now resolving.`;
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
  };
};

export function useReportNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastSeenMs, setLastSeenMs] = useState<number>(0);
  const currentUidRef = useRef<string | null>(null);
  const lastSeenMsRef = useRef<number>(0);

  const setLastSeenMsSafe = useCallback((value: number) => {
    lastSeenMsRef.current = value;
    setLastSeenMs((prev) => (prev === value ? prev : value));
  }, []);

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
        setLoading(false);
        return;
      }

      currentUidRef.current = currentUser.uid;
      setLoading(true);

      const userRef = doc(db, "regular_user", currentUser.uid);
      unsubscribeUser = onSnapshot(
        userRef,
        (userSnap) => {
          if (!userSnap.exists()) {
            setLastSeenMsSafe(0);
            return;
          }

          const userData = userSnap.data() as { notificationsLastSeenAt?: unknown };
          const resolvedLastSeenMs = resolveTimestampMs(userData.notificationsLastSeenAt);

          // Preserve optimistic lastSeen while serverTimestamp is still pending.
          if (resolvedLastSeenMs > 0 || lastSeenMsRef.current <= 0) {
            setLastSeenMsSafe(resolvedLastSeenMs);
          }
        },
        () => {
          setLastSeenMsSafe(0);
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
                a.createdAtMs !== b.createdAtMs
              ) {
                return mapped;
              }
            }

            return prev;
          });
          setLoading(false);
        },
        () => {
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
  }, [setLastSeenMsSafe]);

  const unreadCount = useMemo(() => {
    if (lastSeenMs <= 0) {
      return items.length;
    }
    return items.filter((item) => item.createdAtMs > lastSeenMs).length;
  }, [items, lastSeenMs]);

  const markAllAsRead = useCallback(async () => {
    const uid = currentUidRef.current;
    if (!uid) {
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

  return {
    items,
    loading,
    unreadCount,
    markAllAsRead,
  };
}

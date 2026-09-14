import type { NotificationItem } from "./notif_func";

/**
 * Verification unread is per-decision, NOT wall-clock.
 * The verification card's timestamps are frozen after the admin decides
 * (verifiedAt/updatedAt never move again), so `createdAtMs > lastSeenMs`
 * would stay unread FOREVER. Read state for verification = "this exact
 * decision fingerprint (status:updatedAt:rejectionCount) was acknowledged",
 * tracked by the provider. Reports keep the wall-clock comparison.
 *
 * Pass the provider's `verificationSeenKey` (+ loaded flag) for verification
 * items; for report items they are ignored.
 */
export const isNotificationUnread = (
  item: NotificationItem,
  lastSeenMs: number,
  verificationSeenKey?: string | null,
  verificationSeenLoaded?: boolean,
): boolean => {
  if (item.kind === "verification") {
    if (!verificationSeenLoaded || item.seenKey == null) {
      return false;
    }
    return item.seenKey !== verificationSeenKey;
  }

  if (item.createdAtMs <= 0) {
    return false;
  }

  if (lastSeenMs <= 0) {
    return true;
  }

  return item.createdAtMs > lastSeenMs;
};

export const hasUnreadNotifications = (
  items: NotificationItem[],
  lastSeenMs: number,
  verificationSeenKey?: string | null,
  verificationSeenLoaded?: boolean,
): boolean =>
  items.some((item) =>
    isNotificationUnread(item, lastSeenMs, verificationSeenKey, verificationSeenLoaded),
  );

export type NotificationBucket = "today" | "yesterday" | "earlier";

export const getNotificationBucket = (createdAtMs: number): NotificationBucket => {
  if (!createdAtMs || createdAtMs <= 0) {
    return "earlier";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (createdAtMs >= startOfToday) {
    return "today";
  }

  if (createdAtMs >= startOfYesterday) {
    return "yesterday";
  }

  return "earlier";
};

export const BUCKET_LABELS: Record<NotificationBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

export const groupNotificationsByTime = (
  items: NotificationItem[],
): { bucket: NotificationBucket; items: NotificationItem[] }[] => {
  const groups = new Map<NotificationBucket, NotificationItem[]>();

  items.forEach((item) => {
    const bucket = getNotificationBucket(item.createdAtMs);
    const existing = groups.get(bucket);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(bucket, [item]);
    }
  });

  const order: NotificationBucket[] = ["today", "yesterday", "earlier"];
  return order
    .filter((bucket) => groups.has(bucket))
    .map((bucket) => ({ bucket, items: groups.get(bucket) ?? [] }));
};

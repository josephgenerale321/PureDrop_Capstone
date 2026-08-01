import type { NotificationItem } from "./notif_func";

export const isNotificationUnread = (
  item: NotificationItem,
  lastSeenMs: number,
): boolean => {
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
): boolean => items.some((item) => isNotificationUnread(item, lastSeenMs));

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

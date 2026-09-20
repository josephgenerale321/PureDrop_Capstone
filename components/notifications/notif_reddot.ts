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

export type NotificationBucket =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "earlier";

/**
 * Calendar-based buckets (not rolling windows) so the section headers stay
 * stable for the whole day / month: nothing hops from "This Month" to
 * "Last Month" mid-scroll just because "x days ago" crossed a threshold.
 */
export const getNotificationBucket = (createdAtMs: number): NotificationBucket => {
  if (!createdAtMs || createdAtMs <= 0) {
    return "earlier";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Date arithmetic (never `- 24h`) so a DST shift can't move the boundary.
  const startOfYesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  ).getTime();

  if (createdAtMs >= startOfToday) {
    return "today";
  }

  if (createdAtMs >= startOfYesterday) {
    return "yesterday";
  }

  // Week starts on Sunday, matching the PH calendar convention.
  const startOfThisWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay(),
  ).getTime();

  if (createdAtMs >= startOfThisWeek) {
    return "thisWeek";
  }

  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  if (createdAtMs >= startOfThisMonth) {
    return "thisMonth";
  }

  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  if (createdAtMs >= startOfLastMonth) {
    return "lastMonth";
  }

  return "earlier";
};

export const BUCKET_LABELS: Record<NotificationBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  thisMonth: "This Month",
  lastMonth: "Last Month",
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

  const order: NotificationBucket[] = [
    "today",
    "yesterday",
    "thisWeek",
    "thisMonth",
    "lastMonth",
    "earlier",
  ];
  return order
    .filter((bucket) => groups.has(bucket))
    .map((bucket) => ({ bucket, items: groups.get(bucket) ?? [] }));
};

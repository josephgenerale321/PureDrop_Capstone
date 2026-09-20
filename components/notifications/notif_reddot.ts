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
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "earlier";

/**
 * Calendar anchors shared by the section buckets (below) AND the relative
 * card labels (`formatRelativeTime` in notif_func.tsx), so a card can never
 * contradict the header it is rendered under. The old rolling label ("Xd ago"
 * for anything younger than 7 days) disagreed with these calendar buckets at
 * month boundaries — on the 1st–3rd of a month a 2-day-old item from the
 * previous month rendered "Last Month" + "2d ago" — and its `diffDays === 1`
 * branch was a rolling 24–48h window, not "yesterday", which put "Yesterday"
 * under "This Week".
 *
 * All arithmetic is date-based on the LOCAL calendar (never `- 24h`) so a DST
 * shift can never move a boundary.
 */
export interface NotificationCalendarAnchors {
  startOfToday: number;
  startOfYesterday: number;
  /** Week starts on Sunday, matching the PH calendar convention. */
  startOfThisWeek: number;
  /** Start of the previous Sunday–Saturday calendar week. */
  startOfLastWeek: number;
  startOfThisMonth: number;
  startOfLastMonth: number;
}

export const getNotificationCalendarAnchors = (
  nowMs: number = Date.now(),
): NotificationCalendarAnchors => {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  return {
    startOfToday: new Date(year, month, day).getTime(),
    startOfYesterday: new Date(year, month, day - 1).getTime(),
    startOfThisWeek: new Date(year, month, day - now.getDay()).getTime(),
    startOfLastWeek: new Date(year, month, day - now.getDay() - 7).getTime(),
    startOfThisMonth: new Date(year, month, 1).getTime(),
    startOfLastMonth: new Date(year, month - 1, 1).getTime(),
  };
};

/**
 * Calendar-based buckets (not rolling windows) so the section headers stay
 * stable for the whole day / month: nothing hops from "This Month" to
 * "Last Month" mid-scroll just because "x days ago" crossed a threshold.
 */
export const getNotificationBucket = (
  createdAtMs: number,
  anchors: NotificationCalendarAnchors = getNotificationCalendarAnchors(),
): NotificationBucket => {
  if (!createdAtMs || createdAtMs <= 0) {
    return "earlier";
  }

  if (createdAtMs >= anchors.startOfToday) {
    return "today";
  }

  if (createdAtMs >= anchors.startOfYesterday) {
    return "yesterday";
  }

  if (createdAtMs >= anchors.startOfThisWeek) {
    return "thisWeek";
  }

  if (createdAtMs >= anchors.startOfLastWeek) {
    return "lastWeek";
  }

  if (createdAtMs >= anchors.startOfThisMonth) {
    return "thisMonth";
  }

  if (createdAtMs >= anchors.startOfLastMonth) {
    return "lastMonth";
  }

  return "earlier";
};

export const BUCKET_LABELS: Record<NotificationBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  thisMonth: "This Month",
  lastMonth: "Last Month",
  earlier: "Earlier",
};

export const groupNotificationsByTime = (
  items: NotificationItem[],
): { bucket: NotificationBucket; items: NotificationItem[] }[] => {
  const groups = new Map<NotificationBucket, NotificationItem[]>();
  // Anchor the calendar edges ONCE for the whole list (a single `now`) so
  // every item is bucketed against the same day / week / month boundaries.
  const anchors = getNotificationCalendarAnchors();

  items.forEach((item) => {
    const bucket = getNotificationBucket(item.createdAtMs, anchors);
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
    "lastWeek",
    "thisMonth",
    "lastMonth",
    "earlier",
  ];
  return order
    .filter((bucket) => groups.has(bucket))
    .map((bucket) => ({ bucket, items: groups.get(bucket) ?? [] }));
};

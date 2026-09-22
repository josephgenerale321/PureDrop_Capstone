import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import type * as NotificationsNamespace from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../../firebaseConfig";

const PUSH_CHANNEL_ID = "report-updates";

export const REPORT_CATEGORY_ID = "report-update";
export const VIEW_REPORTS_ACTION_ID = "view-reports";
export const VIEW_REPORTS_ACTION_TITLE = "View Your Reports";
const MY_REPORTS_ROUTE = "/regular_user/my_report" as Href;
const LOGIN_ROUTE = "/login" as Href;
// Route carried by server-sent report pushes (`data.route`). Kept as a named
// constant so the intent key below can recognize a report push that has no
// usable reportId (in that case the button lands on My Reports and the body on
// the notifications route — both the same place to the user).
const REPORT_PUSH_ROUTE = "/regular_user/notifications";
// Detail screen for a single report (view_reportuser.tsx). The outside
// notification button + body tap prefer this when the push carries a
// reportId (e.g. Report #18); otherwise we fall back to the list above.
const REPORT_DETAIL_PATHNAME = "/regular_user/view_reportuser" as const;
// Legacy values stashed by older builds, still sitting in AsyncStorage on
// devices that tapped while logged out. Kept for backward-compatible reads.
const LEGACY_MY_REPORTS_ROUTE = "/regular_user/my_report/index";
const isMyReportsRouteValue = (value: unknown): boolean =>
  value === String(MY_REPORTS_ROUTE) || value === LEGACY_MY_REPORTS_ROUTE;
const pendingReportsRouteStorageKey = (uid: string): string =>
  `@puredrop/pending_reports_route/${uid}`;

// Last-response replay guard — stops the SAME tap from re-navigating on every
// reload/restart. `getLastNotificationResponseAsync()` keeps returning the last
// tapped response on every cold start (the native clear is best-effort and the
// in-memory claim Set resets whenever the JS bundle reloads — which is exactly
// what a dev reload / app kill does). So without persistence, reopening the
// app pushes /regular_user/view_reportuser?reportId=... again and again.
//
// Fix: persist the handled tap descriptor in AsyncStorage (single global slot
// so it converges across logged-out/logged-in states). Once a tap is routed,
// its descriptor is recorded; later launches seeing the same descriptor skip
// navigation entirely until the user taps a NEW notification. Best-effort and
// never throws, so dev + preview builds stay crash-free.
//
// Second trap, fixed here too: Android can hand ONE tap to the app TWICE — the
// emitter delivers the notification (default action) and, when the
// [View Your Reports] button was used, the category action as well. Those two
// deliveries differ in `actionIdentifier`, so the descriptor above sees two
// DIFFERENT taps and both would navigate — that is the duplicated
// my_report / view_reportuser screen sitting on the back stack (the "it opens
// 2 times" report). `describeReportTapIntent()` collapses them: it keys the
// tap by DESTINATION (which screen, for which owner, for which signed-in
// account) and ignores which button delivered it. A short window
// (`TAP_INTENT_WINDOW_MS`) keeps genuinely later taps working.
const HANDLED_PUSH_TAP_KEY = "@puredrop/handled_push_tap";

/**
 * Window for the PERSISTED record (survives reloads / app kills): how long a
 * recorded destination counts as "already routed". Long enough to cover one
 * tap whose two deliveries straddle a JS reload, short enough that a genuine
 * later tap on the same notification still navigates.
 */
const TAP_INTENT_WINDOW_MS = 5000;

/**
 * Window for the IN-MEMORY record (same JS context), longer on purpose: one
 * tap's two deliveries can straddle the multi-second session restore running
 * behind the "Just a moment…" loading screen. During that window the SAME tap
 * resolves to Login for the first delivery and to the report's detail screen for
 * the second — both used to navigate, which is the duplicated reports screen
 * seen right after the loading page.
 */
const TAP_DESTINATION_WINDOW_MS = 10000;

/**
 * Backstop for sibling deliveries that cannot be paired by destination or by
 * identifier (some OEM builds re-post the notification for the action button, so
 * both the identifier AND the content date can differ). Two deliveries of ONE
 * tap land within milliseconds of each other; a human cannot tap two different
 * notifications that fast — by then the app is already in the foreground.
 */
const TAP_NAVIGATION_EPOCH_MS = 1200;

type HandledPushTapRecord = {
  /** Exact tap descriptor (`describeReportPushTap`) — replay of the same tap. */
  descriptor: string | null;
  /** Action-agnostic destination (`describeReportTapIntent`). */
  intent: string | null;
  /** When the tap was routed (ms epoch, 0 = unknown/legacy record). */
  at: number;
};

const emptyHandledPushTapRecord = (): HandledPushTapRecord => ({
  descriptor: null,
  intent: null,
  at: 0,
});

const readHandledPushTap = async (): Promise<HandledPushTapRecord> => {
  try {
    const stored = await AsyncStorage.getItem(HANDLED_PUSH_TAP_KEY);
    if (typeof stored !== "string" || stored.length === 0 || stored.length > 1024) {
      return emptyHandledPushTapRecord();
    }
    // Legacy format (older builds): the bare descriptor string.
    if (stored.charCodeAt(0) !== 123 /* '{' */) {
      return { descriptor: stored.slice(0, 400), intent: null, at: 0 };
    }
    const parsed = JSON.parse(stored) as {
      d?: unknown;
      i?: unknown;
      t?: unknown;
    };
    return {
      descriptor:
        typeof parsed?.d === "string" && parsed.d.length > 0
          ? parsed.d.slice(0, 400)
          : null,
      intent:
        typeof parsed?.i === "string" && parsed.i.length > 0
          ? parsed.i.slice(0, 400)
          : null,
      at: typeof parsed?.t === "number" && Number.isFinite(parsed.t) ? parsed.t : 0,
    };
  } catch {
    return emptyHandledPushTapRecord();
  }
};

const writeHandledPushTap = async (
  descriptor: string,
  intent: string,
): Promise<void> => {
  try {
    if (!descriptor && !intent) {
      return;
    }
    const record: HandledPushTapRecord = {
      descriptor: descriptor ? descriptor.slice(0, 400) : null,
      intent: intent ? intent.slice(0, 400) : null,
      at: Date.now(),
    };
    // Publish synchronously first so a sibling delivery arriving before the
    // AsyncStorage write settles still sees the claim.
    loadedHandledPushTap = record;
    await AsyncStorage.setItem(HANDLED_PUSH_TAP_KEY, JSON.stringify({
      d: record.descriptor,
      i: record.intent,
      t: record.at,
    }));
  } catch {
    // Non-fatal.
  }
};

type TapIntentParts = {
  /** Which screen the tap resolves to (detail / hub / login / notice). */
  target: string;
  /** Identifier of the notification itself ("" when the runtime omits it). */
  notificationId: string;
  /** uid the push belongs to ("" when the payload had none). */
  owner: string;
};

/**
 * Split an intent key (`${target}|n:${id}|owner:${owner}|me:${me}`).
 *
 * The signed-in-account segment is deliberately NOT part of the parsed result:
 * ONE tap can be delivered twice, once before Firebase finishes restoring the
 * session and once after (`auth.currentUser` null on the first, live on the
 * second) — boot ordering, not a different tap. Destination + push owner stay
 * in, so different reports/accounts still navigate independently.
 */
const parseTapIntent = (intent: string): TapIntentParts | null => {
  if (typeof intent !== "string" || intent.length === 0) {
    return null;
  }
  const nAt = intent.indexOf("|n:");
  const ownerAt = intent.indexOf("|owner:");
  const meAt = intent.indexOf("|me:");
  const target = nAt === -1 ? intent : intent.slice(0, nAt);
  const notificationId =
    nAt === -1
      ? ""
      : intent.slice(
          nAt + 3,
          ownerAt !== -1 ? ownerAt : meAt !== -1 ? meAt : undefined,
        );
  const owner =
    ownerAt === -1
      ? ""
      : intent.slice(ownerAt + 7, meAt !== -1 ? meAt : undefined);
  return { target, notificationId, owner };
};

/**
 * True when two intents describe the same destination for the same push owner.
 * A missing notification id on either side (older record shape) counts as a
 * match — the destination + owner comparison already covers the interesting
 * cases — while two DIFFERENT ids stay distinct, so separate pushes about the
 * same report each still get their own navigation.
 */
const tapIntentsMatch = (
  a: TapIntentParts | null,
  b: TapIntentParts | null,
): boolean => {
  if (!a || !b) {
    return false;
  }
  if (a.target !== b.target || a.owner !== b.owner) {
    return false;
  }
  return !a.notificationId || !b.notificationId || a.notificationId === b.notificationId;
};

/**
 * True when `next` is a MORE specific destination than the one already routed
 * for the SAME push.
 *
 * Used by the sibling-delivery backstop below. A tap whose two deliveries
 * straddle the session restore resolves to Login (session not yet live behind
 * the "Just a moment…" page) and then to the report's detail screen — the user
 * never sees the same screen twice, so letting the second delivery through is
 * not a duplicate: suppressing it would silently drop the tap the user just
 * made. The test lives here (not in the shipped comparison) so the equal-screen
 * cases still collapse.
 */
const isDestinationUpgrade = (
  previous: TapIntentParts | null,
  next: TapIntentParts | null,
): boolean => {
  try {
    if (!previous || !next) {
      return false;
    }
    if (previous.target === next.target) {
      return false;
    }
    return (
      next.target.startsWith(REPORT_DETAIL_PATHNAME) &&
      previous.target !== ""
    );
  } catch {
    return false;
  }
};

/**
 * Cold-start-drain guard — the ONLY place the descriptor is compared, because
 * the drain is the only path that can see the native last-response slot
 * replaying a tap that was already routed.
 *
 * - Exact descriptor match → that same tap was routed in an earlier launch (or
 *   earlier in this one): skip, do not navigate again.
 * - Fresh intent match inside `TAP_INTENT_WINDOW_MS` → the sibling delivery of
 *   the tap being processed right now (Android reports one tap as the default
 *   action AND the category action): skip.
 *
 * Anything else navigates, so a genuine later tap on the same notification
 * still works.
 */
const wasHandledPushTapAlready = (
  record: HandledPushTapRecord,
  descriptor: string,
  intent: string,
): boolean => {
  try {
    if (descriptor && record.descriptor === descriptor) {
      return true;
    }
    return wasPersistedIntentRecentlyRouted(record, intent);
  } catch {
    // Fall through — treated as "not handled" (never crash).
  }
  return false;
};

/**
 * Windowed intent guard used by BOTH call sites.
 *
 * The descriptor is intentionally ignored here: it is identical for every tap
 * of the same notification, so honouring it would make a legitimate second tap
 * (open the push, go back, tap it again) do nothing. Only "this destination was
 * routed moments ago" is deduped.
 */
function wasPersistedIntentRecentlyRouted(
  record: HandledPushTapRecord,
  intent: string,
): boolean {
  try {
    if (record.at === 0 || Date.now() - record.at > TAP_INTENT_WINDOW_MS) {
      return false;
    }
    return tapIntentsMatch(parseTapIntent(record.intent ?? ""), parseTapIntent(intent));
  } catch {
    return false;
  }
}

/**
 * In-memory mirror of the persisted record above. Needed because the persisted
 * write is fire-and-forget: the two deliveries of one tap can land inside the
 * same JS context before the AsyncStorage write settles.
 */
const lastTapIntent = { key: null as string | null, at: 0 };

/**
 * Synchronous cache of the persisted record, populated by the cold-start drain
 * (and refreshed on every write) so the tap handler can compare intents without
 * awaiting storage inside a native event callback.
 */
let loadedHandledPushTap: HandledPushTapRecord = emptyHandledPushTapRecord();

/**
 * In-memory "was this destination just routed?" guard — the fast, synchronous
 * check used by BOTH call sites (`tryHandleReportPushTap` for warm taps and the
 * cold-start drain). Two tiers:
 *
 * 1. `TAP_DESTINATION_WINDOW_MS` + `tapIntentsMatch`: the sibling delivery of one
 *    Android tap (default action + [View Your Reports] button). The signed-in
 *    half is ignored on purpose — boot ordering can restore the session between
 *    the two deliveries, and that is still ONE tap.
 * 2. `TAP_NAVIGATION_EPOCH_MS` same-screen backstop: some OEM builds re-post the
 *    notification for the action button, so even the notification id (and the
 *    content date) differ. Two deliveries of one tap land milliseconds apart,
 *    while a human cannot tap another notification before the app is already in
 *    the foreground — so the same SCREEN twice inside this window is a duplicate.
 */
const wasTapIntentJustRouted = (intent: string): boolean => {
  try {
    if (!intent || !lastTapIntent.key || lastTapIntent.at <= 0) {
      return false;
    }
    const age = Date.now() - lastTapIntent.at;
    if (age < 0) {
      return false;
    }
    const previous = parseTapIntent(lastTapIntent.key);
    const next = parseTapIntent(intent);
    if (!next) {
      return false;
    }
    if (age <= TAP_DESTINATION_WINDOW_MS && tapIntentsMatch(previous, next)) {
      return true;
    }
    if (
      age <= TAP_NAVIGATION_EPOCH_MS &&
      previous != null &&
      previous.target !== "" &&
      previous.target === next.target
    ) {
      return true;
    }
    // Sibling delivery that straddled the session restore: the SAME
    // notification, for the SAME push owner, milliseconds apart — but the
    // destination differs because `auth.currentUser` flipped from null (still
    // restoring behind the "Just a moment…" loading page) to the restored uid.
    // That is boot ordering, not a second tap, so it must navigate once. Only
    // the identifier+owner pair is compared here and only inside the epoch
    // window, so separate pushes about the same report (different identifiers)
    // each keep their own navigation.
    //
    // The equal-screen rule is what makes this a DUPLICATE guard, so a
    // destination UPGRADE (the first delivery showed Login / My Reports because
    // the session was not live yet, the sibling resolves to the report's detail
    // screen) is deliberately let through: two different screens are never a
    // duplicate, and swallowing the upgraded one would lose the tap the user
    // just made while sitting on the "Just a moment…" page.
    if (
      age <= TAP_NAVIGATION_EPOCH_MS &&
      previous != null &&
      previous.notificationId !== "" &&
      previous.notificationId === next.notificationId &&
      previous.owner === next.owner &&
      !isDestinationUpgrade(previous, next)
    ) {
      return true;
    }
    return false;
  } catch {
    // Never throw from a native event callback — treat as "not routed".
    return false;
  }
};

const markTapIntentRouted = (intent: string): void => {
  if (!intent) {
    return;
  }
  lastTapIntent.key = intent;
  lastTapIntent.at = Date.now();
};

// --- Deep-link helpers (crash-safe, preview-build safe) --------------------
// NEVER throw: every helper validates its inputs and falls back to My Reports
// so a malformed / missing reportId can never crash a preview build.
const sanitizeReportId = (value: unknown): string | null => {
  try {
    const coerce = (raw: string): string | null => {
      const trimmed = raw.trim();
      // Firestore ids + numeric ids (e.g. "18"). Allow word chars, dash, dot,
      // colon; reject anything with slashes/spaces/control chars so the value
      // can never break out of the params object into a path.
      if (
        trimmed.length > 0 &&
        trimmed.length <= 128 &&
        /^[A-Za-z0-9_:.~-]+$/.test(trimmed) &&
        !trimmed.includes("..")
      ) {
        return trimmed;
      }
      return null;
    };
    if (typeof value === "string") {
      return coerce(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return coerce(String(Math.trunc(value)));
    }
  } catch {
    // Fall through to null.
  }
  return null;
};

const buildReportDetailRoute = (reportId: string | null, userId?: string | null): Href => {
  try {
    if (reportId) {
      const params: Record<string, string> = { reportId };
      const owner = typeof userId === "string" ? userId.trim() : "";
      // view_reportuser reads owner from `userId` param when present; harmless
      // to omit. Only include when it looks like a real uid.
      if (owner.length > 0 && owner.length <= 128) {
        params.userId = owner;
      }
      return { pathname: REPORT_DETAIL_PATHNAME, params } as Href;
    }
  } catch {
    // Fall through to list fallback.
  }
  return MY_REPORTS_ROUTE;
};

// Stored pending value supports TWO shapes (never throws on read):
//  - legacy plain string: "/regular_user/my_report" (old builds)
//  - JSON: { pathname, reportId?, userId? } (new builds, deep link after login)
type PendingReportsRouteValue = {
  pathname?: unknown;
  reportId?: unknown;
  userId?: unknown;
};

const encodePendingReportsValue = (reportId: string | null, userId?: string | null): string => {
  try {
    if (reportId) {
      const payload: Record<string, string> = {
        pathname: REPORT_DETAIL_PATHNAME,
        reportId,
      };
      const owner = typeof userId === "string" ? userId.trim() : "";
      if (owner.length > 0 && owner.length <= 128) {
        payload.userId = owner;
      }
      return JSON.stringify(payload);
    }
  } catch {
    // Fall through to plain list route.
  }
  return String(MY_REPORTS_ROUTE);
};

const decodePendingReportsValue = (stored: string | null): Href | null => {
  try {
    if (!stored || stored.length === 0 || stored.length > 1024) {
      return null;
    }
    // Legacy plain-string values from older builds.
    if (isMyReportsRouteValue(stored)) {
      return MY_REPORTS_ROUTE;
    }
    // New JSON shape.
    if (stored.charCodeAt(0) !== 123) {
      return null; // not '{' — unknown format, ignore (never crash).
    }
    const parsed = JSON.parse(stored) as PendingReportsRouteValue;
    const pathname = typeof parsed?.pathname === "string" ? parsed.pathname : "";
    if (pathname === REPORT_DETAIL_PATHNAME) {
      const reportId = sanitizeReportId(parsed?.reportId);
      if (reportId) {
        const owner = typeof parsed?.userId === "string" ? parsed.userId : null;
        return buildReportDetailRoute(reportId, owner);
      }
      // Detail pathname without a usable id -> list fallback (never crash).
      return MY_REPORTS_ROUTE;
    }
    if (isMyReportsRouteValue(pathname)) {
      return MY_REPORTS_ROUTE;
    }
  } catch {
    // Corrupt JSON must never crash — treated as "no pending route".
  }
  return null;
};

const stashPendingReportsRouteForPushOwner = async (
  pushOwnerUid: string,
  reportId?: string | null,
  pushUserId?: string | null,
): Promise<void> => {
  try {
    const key = typeof pushOwnerUid === "string" ? pushOwnerUid.trim() : "";
    if (!key) {
      return;
    }
    await AsyncStorage.setItem(
      pendingReportsRouteStorageKey(key),
      encodePendingReportsValue(reportId ?? null, pushUserId ?? null),
    );
  } catch {
    // Non-fatal.
  }
};

export const clearPendingReportsRoute = async (uid: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(pendingReportsRouteStorageKey(uid));
  } catch {
    // Non-fatal.
  }
};

export const consumePendingReportsRoute = async (
  signedInUid: string,
  router: { push: (route: Href) => void },
): Promise<boolean> => {
  if (!signedInUid) {
    return false;
  }
  try {
    const stored = await AsyncStorage.getItem(pendingReportsRouteStorageKey(signedInUid));
    const pendingRoute = decodePendingReportsValue(stored);
    if (!pendingRoute) {
      return false;
    }
    await AsyncStorage.removeItem(pendingReportsRouteStorageKey(signedInUid));
    try {
      router.push(pendingRoute);
    } catch {
      // Navigation must never crash the app (notably preview builds).
    }
    return true;
  } catch {
    return false;
  }
};

type ReportPushTapRouter = {
  push: (route: Href) => void;
  replace: (route: Href) => void;
};

type ReportPushTapResponse = {
  actionIdentifier?: unknown;
  notification?: {
    request?: {
      identifier?: unknown;
      content?: {
        data?: {
          route?: unknown;
          userId?: unknown;
          reportId?: unknown;
        } | null;
      } | null;
    } | null;
  } | null;
};

/**
 * Shared tap router for the `report-update` category (action button + body).
 *
 * Killed-app cold start is the case that used to break: the tap reopens the
 * app on `/` (or `/login` when logged out) while `PushNotificationSync` — the
 * only response listener — lives under `regular_user/_layout`, so the tap was
 * never consumed. `ReportActionCategorySync` (root layout, every route) now
 * drains the same tap via `getLastNotificationResponseAsync()`; both call
 * sites share this function, and a module-level claim key makes the loser's
 * duplicate delivery a no-op.
 *
 * Reload/restart replay is the second trap: the native last-response slot
 * keeps returning the SAME tap on every launch (and the in-memory claim Set
 * resets on every JS reload), so without the persisted handled-tap guard the
 * app would re-push `/regular_user/view_reportuser?reportId=...` on every
 * reopen. The AsyncStorage check in the cold-start drain + the write in
 * `tryHandleReportPushTap` close that loop.
 */
const handledReportPushTapKeys = new Set<string>();

const describeReportPushTap = (response: ReportPushTapResponse): string => {
  try {
    const notificationId =
      typeof response?.notification?.request?.identifier === "string"
        ? (response.notification.request.identifier as string)
        : "";
    const actionId =
      typeof response?.actionIdentifier === "string"
        ? (response.actionIdentifier as string)
        : "default";
    const data = response?.notification?.request?.content?.data ?? {};
    const route = typeof data.route === "string" ? data.route : "";
    const userId = typeof data.userId === "string" ? data.userId : "";
    const reportId =
      typeof data.reportId === "string"
        ? data.reportId
        : typeof data.reportId === "number"
          ? String(data.reportId)
          : "";
    // Include the visible content + trigger so two DIFFERENT pushes about the
    // same report (e.g. #18 approved, later #18 resolving) produce different
    // descriptors and each still navigates once. The replay case (same tap
    // re-read after reload) keeps an identical descriptor and is skipped.
    const content = response?.notification?.request?.content as
      | { title?: unknown; body?: unknown; date?: unknown }
      | null
      | undefined;
    const title = typeof content?.title === "string" ? content.title : "";
    const body = typeof content?.body === "string" ? content.body : "";
    const date =
      typeof content?.date === "number" && Number.isFinite(content.date)
        ? String(content.date)
        : "";
    return `${notificationId}|${actionId}|${route}|${userId}|${reportId}|${title}|${body}|${date}`.slice(
      0,
      512,
    );
  } catch {
    return "unknown-tap";
  }
};

// Best-effort native clear that never throws — older native runtimes (stale
// preview builds) may lack `clearLastNotificationResponseAsync`; the persisted
// AsyncStorage guard above already covers replay, so this is just hygiene.
const clearNativeLastResponse = async (Notifications: any): Promise<void> => {
  try {
    if (Notifications && typeof Notifications.clearLastNotificationResponseAsync === "function") {
      await Notifications.clearLastNotificationResponseAsync();
    }
  } catch {
    // Non-fatal.
  }
};

const VERIFICATION_ROUTES = new Set([
  "/login/validation/fullyverif",
  "/login/validation/rejectedverif",
]);

/**
 * Action-agnostic identity of WHERE a tapped report push goes.
 *
 * Android can deliver ONE tap twice (the notification/default action AND the
 * category action). Those deliveries differ in `actionIdentifier` — so
 * `describeReportPushTap()` cannot pair them — but they resolve to the SAME
 * screen, which is what produced the duplicated reports screen ("it opens 1
 * time on launch, 2 times when tapping View My Reports in the notification").
 * This key is deliberately action-free: destination + push owner + signed-in
 * account. The destination mirrors `routeReportPushTap()`'s choice (usable
 * reportId wins → detail screen; gated notice routes; else My Reports).
 *
 * Different reports, different owners, or a signed-in/out transition all still
 * produce different keys, so nothing that deserves its own navigation is lost.
 */
const describeReportTapIntent = (response: ReportPushTapResponse): string => {
  try {
    const data = response?.notification?.request?.content?.data ?? {};
    // Same notification → same identifier for BOTH of its deliveries, so
    // including it lets one tap's sibling delivery collapse while two DIFFERENT
    // pushes about the same report still navigate independently.
    const notificationId =
      typeof response?.notification?.request?.identifier === "string"
        ? (response.notification.request.identifier as string)
        : "";
    const pushOwnerUid = typeof data.userId === "string" ? data.userId.trim() : "";
    const reportId = sanitizeReportId(data.reportId) ?? "";
    const rawRoute = typeof data.route === "string" ? data.route : "";
    const signedInUid = auth.currentUser?.uid ?? "";
    // Mirror the REAL destination of `routeReportPushTap()` (not just the ideal
    // one): a report push tapped while signed out lands on Login, and a push
    // owned by another account lands on the current account's My Reports. If
    // this said "detail screen" for those cases, a single tap whose two
    // deliveries straddle the session restore would be suppressed even though
    // only the LESS specific screen had been shown.
    let target: string;
    if (reportId) {
      if (!signedInUid) {
        target = String(LOGIN_ROUTE);
      } else if (pushOwnerUid && signedInUid !== pushOwnerUid) {
        target = String(MY_REPORTS_ROUTE);
      } else {
        target = `${REPORT_DETAIL_PATHNAME}?reportId=${reportId}`;
      }
    } else if (VERIFICATION_ROUTES.has(rawRoute)) {
      target = signedInUid ? rawRoute : String(LOGIN_ROUTE);
    } else if (rawRoute === REPORT_PUSH_ROUTE || rawRoute === String(MY_REPORTS_ROUTE)) {
      // Report push WITHOUT a usable reportId: the button lands on My Reports
      // while the body lands on the reports route — same place as far as the
      // user is concerned, so collapse both onto one hub key.
      target = "reports-hub";
    } else {
      target = String(MY_REPORTS_ROUTE);
    }
    return `${target}|n:${notificationId}|owner:${pushOwnerUid}|me:${signedInUid || "signed-out"}`.slice(
      0,
      400,
    );
  } catch {
    return "";
  }
};

// Shown (at most once per mismatched tap) when a push for ANOTHER account is
// tapped while someone else is signed in. Best-effort and never throws —
// Alert is a no-op-safe native module on dev/preview builds.
let lastMismatchAlertKey: string | null = null;
const notifyPushAccountMismatch = (descriptor: string): void => {
  try {
    if (lastMismatchAlertKey === descriptor) {
      return;
    }
    lastMismatchAlertKey = descriptor;
    Alert.alert(
      "Notification is for a different account",
      "That update belongs to another account on this phone. You are staying signed in — switch accounts to view it.",
      [{ text: "OK", style: "default" }],
    );
  } catch {
    // Non-fatal.
  }
};

const routeReportPushTap = (
  response: ReportPushTapResponse,
  router: ReportPushTapRouter,
  navigate: (route: Href) => void = (route) => router.replace(route),
): boolean => {
  let contentData: { route?: unknown; userId?: unknown; reportId?: unknown } = {};
  try {
    contentData = response?.notification?.request?.content?.data ?? {};
  } catch {
    contentData = {};
  }
  const actionId =
    typeof response?.actionIdentifier === "string"
      ? (response.actionIdentifier as string)
      : undefined;
  const signedInUid = auth.currentUser?.uid ?? null;
  const pushOwnerUid =
    typeof contentData.userId === "string" && contentData.userId.length > 0
      ? (contentData.userId as string)
      : null;
  // The report this push is ABOUT (e.g. Report #18). When present and valid,
  // both the [View Your Reports] button AND the body tap land directly on
  // view_reportuser.tsx for that report; otherwise fall back to My Reports.
  const pushReportId = sanitizeReportId(contentData.reportId);
  const detailRoute = pushReportId
    ? buildReportDetailRoute(pushReportId, pushOwnerUid)
    : null;

  if (actionId === VIEW_REPORTS_ACTION_ID) {
    // Logged-out tap: park the deep link under the push owner's key when
    // known so the login handoff can continue there, then land on Login
    // instead of the unmatched-route error.
    if (!signedInUid) {
      const ownerKey = pushOwnerUid ?? signedInUid;
      if (ownerKey) {
        void stashPendingReportsRouteForPushOwner(ownerKey, pushReportId, pushOwnerUid);
      }
      try {
        navigate(LOGIN_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
      return true;
    }
    // Signed in as a DIFFERENT account than the push owner (e.g. the push is
    // for Joseph's report #18 but kurdapyakurdapyu is logged in): do NOT kick
    // the user to Login — that reads as "my session broke". Stay signed in on
    // the CURRENT account's My Reports and explain why the other report can't
    // open (Firestore rules would deny reading another user's report anyway).
    // The deep link is stashed under the push owner's key so that if the user
    // later switches back to that account, the post-login handoff opens it.
    if (pushOwnerUid && signedInUid !== pushOwnerUid) {
      void stashPendingReportsRouteForPushOwner(pushOwnerUid, pushReportId, pushOwnerUid);
      try {
        navigate(MY_REPORTS_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
      try {
        notifyPushAccountMismatch(describeReportPushTap(response));
      } catch {
        // Non-fatal.
      }
      return true;
    }
    try {
      // replace (not push): a cold start lands on `/` (or `/login`), and
      // pushing the detail on top of that leaves a dead back-stack entry.
      // Falls back to My Reports when the push carried no usable reportId.
      navigate(detailRoute ?? MY_REPORTS_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
    return true;
  }

  const rawRoute = contentData.route;
  if (typeof rawRoute === "string" && rawRoute.startsWith("/")) {
    // Gated routes (verification notices) must never be reachable while logged
    // out: they need the live uid / the celebration watcher fails closed, so a
    // cold-start body tap lands on Login and the saved-login auto-restore
    // drives the notice screen (STALE route values still start with "/" — hence
    // the allowlist rather than a prefix check).
    if (VERIFICATION_ROUTES.has(rawRoute)) {
      if (signedInUid) {
        try {
          navigate(rawRoute as Href);
        } catch {
          // Navigation must never crash the app.
        }
        return true;
      }
      try {
        navigate(LOGIN_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
      return true;
    }
    // Report pushes (server sends route "/regular_user/notifications"): a body
    // tap should land on the SAME detail screen as the [View Your Reports]
    // button (view_reportuser.tsx) when the push carries a usable reportId.
    // Logged-out body taps park the deep link and land on Login so the
    // post-login handoff can continue into the detail screen. A different
    // signed-in account stays signed in (see mismatch handling above).
    const isReportPushRoute =
      rawRoute === "/regular_user/notifications" || rawRoute === String(MY_REPORTS_ROUTE);
    if (isReportPushRoute && detailRoute) {
      if (!signedInUid) {
        const ownerKey = pushOwnerUid ?? signedInUid;
        if (ownerKey) {
          void stashPendingReportsRouteForPushOwner(ownerKey, pushReportId, pushOwnerUid);
        }
        try {
          navigate(LOGIN_ROUTE);
        } catch {
          // Navigation must never crash the app.
        }
        return true;
      }
      if (pushOwnerUid && signedInUid !== pushOwnerUid) {
        void stashPendingReportsRouteForPushOwner(pushOwnerUid, pushReportId, pushOwnerUid);
        try {
          navigate(MY_REPORTS_ROUTE);
        } catch {
          // Navigation must never crash the app.
        }
        try {
          notifyPushAccountMismatch(describeReportPushTap(response));
        } catch {
          // Non-fatal.
        }
        return true;
      }
      try {
        navigate(detailRoute);
      } catch {
        // Navigation must never crash the app.
      }
      return true;
    }
    try {
      navigate(rawRoute as Href);
    } catch {
      // Navigation must never crash the app.
    }
    return true;
  }
  // No route in payload (older local notifications): if we still know the
  // report, deep-link the body tap to its detail screen (same as the button).
  // Logged-out taps park + go to Login; a different signed-in account stays
  // signed in on its own My Reports (mismatch alert explains why).
  if (!signedInUid) {
    if (detailRoute) {
      const ownerKey = pushOwnerUid ?? signedInUid;
      if (ownerKey) {
        void stashPendingReportsRouteForPushOwner(ownerKey, pushReportId, pushOwnerUid);
      }
      try {
        navigate(LOGIN_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
      return true;
    }
    return false;
  }
  if (pushOwnerUid && signedInUid !== pushOwnerUid) {
    if (detailRoute) {
      void stashPendingReportsRouteForPushOwner(pushOwnerUid, pushReportId, pushOwnerUid);
      try {
        navigate(MY_REPORTS_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
      try {
        notifyPushAccountMismatch(describeReportPushTap(response));
      } catch {
        // Non-fatal.
      }
      return true;
    }
    return false;
  }
  if (detailRoute && signedInUid) {
    try {
      navigate(detailRoute);
    } catch {
      // Navigation must never crash the app.
    }
    return true;
  }
  return false;
};

const tryHandleReportPushTap = (
  response: ReportPushTapResponse | null | undefined,
  router: ReportPushTapRouter,
  navigate?: (route: Href) => void,
): boolean => {
  if (!response?.notification) {
    return false;
  }
  const tapKey = describeReportPushTap(response);
  const tapIntent = describeReportTapIntent(response);
  if (handledReportPushTapKeys.has(tapKey)) {
    return true;
  }
  // One Android category tap can arrive as TWO responses (default action +
  // action button). Their descriptors differ, so compare destinations too:
  // the in-memory mirror first (the persisted write is fire-and-forget and may
  // still be in flight for the sibling delivery), then the persisted record
  // loaded by the cold-start drain. Deliberately synchronous — this runs inside
  // a native event callback where an await would let the sibling slip in first.
  if (
    wasTapIntentJustRouted(tapIntent) ||
    wasHandledPushTapAlready(loadedHandledPushTap, tapKey, tapIntent)
  ) {
    handledReportPushTapKeys.add(tapKey);
    return true;
  }
  handledReportPushTapKeys.add(tapKey);
  markTapIntentRouted(tapIntent);
  // Cap the claim set — a long-lived session can otherwise grow it
  // unboundedly (one entry per tapped report push).
  if (handledReportPushTapKeys.size > 50) {
    const oldest = handledReportPushTapKeys.values().next();
    if (!oldest.done) {
      handledReportPushTapKeys.delete(oldest.value);
    }
  }
  // Persist the claim so a JS reload / app kill + reopen (which wipes the
  // in-memory Set above) does NOT re-navigate to the same detail screen.
  // Fire-and-forget: the cold-start drain re-checks AsyncStorage before
  // routing, and warm taps are unaffected.
  void writeHandledPushTap(tapKey, tapIntent);
  try {
    return routeReportPushTap(response, router, navigate);
  } catch {
    return false;
  }
};

const ensureReportCategoryAsync = async (Notifications: any): Promise<void> => {
  try {
    await Notifications.setNotificationCategoryAsync(REPORT_CATEGORY_ID, [
      {
        identifier: VIEW_REPORTS_ACTION_ID,
        buttonTitle: VIEW_REPORTS_ACTION_TITLE,
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
    // Non-fatal.
  }
};

/**
 * Registers the `report-update` notification category (with the
 * `view-reports` action button) without requiring an authenticated session.
 *
 * Must run at app start on EVERY route (mounted in `app/_layout.tsx`) rather
 * than only inside `PushNotificationSync` (which mounts solely under
 * `app/regular_user/_layout.jsx`). On Android the action buttons only render
 * when the category was registered before the push arrives while the app
 * process is alive (expo/expo#31503) — a backgrounded/killed app that never
 * ran the registration shows a buttonless banner even though `categoryId`
 * arrives intact. Idempotent; safe to call alongside `PushNotificationSync`.
 */
export const ensureReportActionCategoryAsync = async (): Promise<void> => {
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    return;
  }
  await ensureReportCategoryAsync(Notifications);
};

/**
 * Root-level sync — mount once in `app/_layout.tsx` (every route, no auth
 * required) so the category exists before any report push can arrive.
 * `PushNotificationSync` keeps its own call for foreground sessions; both are
 * idempotent.
 */
export function ReportActionCategorySync() {
  const router = useRouter();
  const coldStartTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      return;
    }
    let isMounted = true;
    void ensureReportCategoryAsync(Notifications);
    const drainColdStartTap = async (): Promise<boolean> => {
      try {
        const lastResponse = (await Notifications.getLastNotificationResponseAsync()) as ReportPushTapResponse | null;
        if (!lastResponse?.notification) {
          return false;
        }
        if (!isMounted) {
          return true;
        }
        // Replay guard: this tap (or its sibling delivery — Android emits one
        // tap as the default action AND the category action) was already routed
        // in a previous launch or earlier in this one. The persisted claim
        // survives JS reloads / app kills, unlike the in-memory Set. Skip
        // navigation, but still clear the native slot so the stale response
        // stops being returned.
        try {
          const tapKey = describeReportPushTap(lastResponse);
          const tapIntent = describeReportTapIntent(lastResponse);
          const alreadyHandled = await readHandledPushTap();
          loadedHandledPushTap = alreadyHandled;
          if (wasHandledPushTapAlready(alreadyHandled, tapKey, tapIntent)) {
            handledReportPushTapKeys.add(tapKey);
            await clearNativeLastResponse(Notifications);
            return true;
          }
          if (wasTapIntentJustRouted(tapIntent)) {
            handledReportPushTapKeys.add(tapKey);
            await clearNativeLastResponse(Notifications);
            return true;
          }
        } catch {
          // Non-fatal: fall through and handle normally.
        }
        const claimed = tryHandleReportPushTap(lastResponse, router);
        if (claimed) {
          await clearNativeLastResponse(Notifications);
        }
        return true;
      } catch {
        return false;
      }
    };
    let attempts = 0;
    const pollColdStartTap = () => {
      if (!isMounted) {
        return;
      }
      void drainColdStartTap().then((done) => {
        if (!isMounted || done) {
          return;
        }
        attempts += 1;
        if (attempts >= 6) {
          return;
        }
        coldStartTapTimerRef.current = setTimeout(pollColdStartTap, 2000);
      });
    };
    coldStartTapTimerRef.current = setTimeout(pollColdStartTap, 1500);
    let responseSubscription: { remove: () => void } | null = null;
    try {
      responseSubscription =
        Notifications.addNotificationResponseReceivedListener(
          (response: NotificationsNamespace.NotificationResponse) => {
            if (!isMounted) {
              return;
            }
            // Warm taps while the app process is alive (any route, including
            // pre-login where PushNotificationSync is not mounted). push()
            // preserves the back stack; the module-level claim key dedupes
            // against PushNotificationSync when both are mounted. The
            // cold-start drain above uses replace() instead.
            tryHandleReportPushTap(response as ReportPushTapResponse, router, (
              route,
            ) => router.push(route));
          },
        );
    } catch {
      responseSubscription = null;
    }
    return () => {
      isMounted = false;
      if (coldStartTapTimerRef.current) {
        clearTimeout(coldStartTapTimerRef.current);
        coldStartTapTimerRef.current = null;
      }
      try {
        responseSubscription?.remove();
      } catch {
        // Non-fatal.
      }
      responseSubscription = null;
    };
  }, [router]);
  return null;
}

type PushRegistrationResult = {
  token: string | null;
  /** Native device push token (FCM registration token on Android), if any. */
  deviceToken?: string | null;
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
const getNotificationsModule = (): typeof NotificationsNamespace | null => {
  if (!isPushNotificationsAvailable()) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications") as typeof NotificationsNamespace;

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

/**
 * Reason why remote push could not be registered, when it is an EXPECTED and
 * non-fatal condition (vs. a genuinely unexpected error).
 *
 * - "credentials": the BUILD does not have FCM/APNs credentials wired up
 *   (e.g. `Default FirebaseApp is not initialized ... fcm-credentials`).
 *   Common in dev/preview builds without a Google-APIs emulator.
 * - "google-play-services": the RUNTIME cannot talk to Google Play Services /
 *   Firebase InstanceID. This is a DEVICE-level condition, NOT a build
 *   problem. Most commonly seen on an Android emulator image created WITHOUT
 *   "Google APIs" (plain AOSP image), in Expo Go, or on a GMS-less physical
 *   device. `MISSING_INSTANCEID_SERVICE` is the canonical Firebase InstanceID
 *   error code for this case. Physical devices WITH Google Play Services
 *   register FCM tokens fine.
 */
type PushRegistrationErrorKind = "credentials" | "google-play-services";

const classifyPushRegistrationError = (
  error: unknown,
): PushRegistrationErrorKind | null => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = message.toLowerCase();

  // Dev/preview builds without FCM/APNs credentials baked in.
  const isCredentialsIssue =
    normalized.includes("fcm-credentials") ||
    normalized.includes("firebaseapp is not initialized") ||
    normalized.includes("apns") ||
    normalized.includes("fcm");

  if (isCredentialsIssue) {
    return "credentials";
  }

  // Runtimes without Google Play Services / Firebase InstanceID.
  // `MISSING_INSTANCEID_SERVICE` is the canonical InstanceID code for
  // non-Google emulator images, Expo Go, and GMS-less devices. These are
  // device-level conditions, not build/credential problems.
  const isGooglePlayServicesIssue =
    normalized.includes("missing_instanceid_service") ||
    normalized.includes("instanceid") ||
    normalized.includes("google play services") ||
    normalized.includes("service_not_available") ||
    normalized.includes("missing_google_app_id") ||
    normalized.includes("google_api_unavailable");

  if (isGooglePlayServicesIssue) {
    return "google-play-services";
  }

  return null;
};

/**
 * Reads the native device push token — an FCM registration token on Android.
 *
 * The server prefers this token: a DATA-ONLY message sent straight through the
 * FCM v1 API is the only Android delivery path where expo-notifications builds
 * the notification itself (ExpoNotificationBuilder), which is what makes the
 * `report-update` category's [View Your Reports] action button render. A push
 * rendered by Google Play Services (any message with a `notification` block,
 * including every Expo push service ticket) can never show action buttons.
 *
 * Best-effort: when it cannot be read the server keeps using the Expo push
 * service, which still shows a banner (just without the button).
 */
const getDevicePushTokenSafe = async (Notifications: any): Promise<string | null> => {
  if (!Notifications || Platform.OS !== "android") {
    return null;
  }

  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const token =
      typeof devicePushToken?.data === "string" ? devicePushToken.data.trim() : "";
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
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
      return {
        token: token.data,
        deviceToken: await getDevicePushTokenSafe(Notifications),
        enabled: true,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Push notification registration failed.";
      const kind = classifyPushRegistrationError(error);

      switch (kind) {
        case "credentials": {
          // In dev/preview builds that do not have FCM/APNs credentials
          // configured, `getExpoPushTokenAsync` throws (e.g. "Default
          // FirebaseApp is not initialized ... fcm-credentials"). This is
          // EXPECTED and non-fatal, and the local system notification path
          // (system_notif.tsx) covers delivery in those builds. Downgrade
          // this expected case to a quiet debug log so it does not surface
          // as a scary console warning. Remote push still works normally in
          // production builds where FCM/APNs ARE configured.
          console.debug(
            "Remote push skipped (credentials not configured for this build):",
            message,
          );
          // Even when the Expo push credentials are missing, the native FCM
          // registration token may still be readable, and that is the token
          // the server needs for the button-bearing direct FCM path.
          const deviceToken = await getDevicePushTokenSafe(
            getNotificationsModule(),
          );
          return {
            token: null,
            deviceToken,
            enabled: Boolean(deviceToken),
            error: message,
          };
        }

        case "google-play-services": {
          // The runtime lacks Google Play Services / Firebase InstanceID
          // (e.g. `MISSING_INSTANCEID_SERVICE` on a non-Google emulator image,
          // Expo Go, or a GMS-less device). This is a DEVICE-level condition,
          // NOT a build/credential problem. It is expected and non-fatal:
          // local system notifications (system_notif.tsx) still deliver report
          // updates, and remote push works on real devices with Google Play
          // Services. Log at debug so it does not surface as a scary warning.
          console.debug(
            "Remote push skipped (device lacks Google Play Services / FCM support):",
            message,
          );
          return {
            token: null,
            enabled: false,
            error: `${message} (device lacks Google Play Services / FCM support)`,
          };
        }

        default:
          // Genuinely unexpected registration failure — surface it so it can
          // be investigated. Existing push-onboarding logic treats this as a
          // non-fatal skip (returns null token), so it never crashes.
          console.warn("Push notification setup skipped:", message);
          const deviceToken = await getDevicePushTokenSafe(
            getNotificationsModule(),
          );
          return {
            token: null,
            deviceToken,
            enabled: Boolean(deviceToken),
            error: message,
          };
      }
    }
  };

/**
 * Clears the push token for a user so the server stops delivering remote
 * pushes (e.g. after an explicit logout).
 *
 * Best-effort and crash-safe: if the user doc does not exist or the Firestore
 * write fails, this resolves without throwing so the logout flow is never
 * blocked. The token is re-registered automatically on the next sign-in via
 * PushNotificationSync (which listens to onAuthStateChanged), so clearing it
 * here is safe.
 *
 * @param uid The Firebase Auth uid whose profile should lose its push token.
 */
export const unregisterPushNotificationsAsync = async (
  uid: string,
): Promise<void> => {
  if (!uid) {
    return;
  }

  try {
    await updateDoc(doc(db, "regular_user", uid), {
      expoPushToken: "",
      fcmToken: "",
      pushNotificationEnabled: false,
      pushTokenUpdatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal: sign-out must never be blocked by a Firestore write error.
  }
};

export default function PushNotificationSync() {
  const router = useRouter();
  const responseSubscriptionRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Register (or re-register) the Expo push token for the signed-in user
    // and persist it to their profile so the server can deliver remote pushes
    // even when the app is fully closed. This is called on auth AND when the
    // app returns to the foreground, so the token stays fresh and reliable.
    const registerToken = async (uid: string) => {
      try {
        const result = await registerForPushNotificationsAsync();
        if (!isMounted || (!result.token && !result.deviceToken)) {
          return;
        }

        try {
          await updateDoc(doc(db, "regular_user", uid), {
            expoPushToken: result.token ?? "",
            // FCM registration token: the server sends report pushes straight
            // through FCM v1 with this token, because only a data-only FCM
            // message lets expo-notifications build the notification (and
            // therefore attach the [View Your Reports] action button).
            fcmToken: result.deviceToken ?? "",
            pushNotificationEnabled: result.enabled,
            pushTokenUpdatedAt: serverTimestamp(),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to save push token.";
          console.warn("Push token save skipped:", message);
        }
      } catch {
        // Registration must never crash the app. Expected failures (e.g. no
        // FCM credentials in dev/preview builds) are already handled inside
        // registerForPushNotificationsAsync.
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        return;
      }
      // Re-register on every auth state change (login, session restore).
      void registerToken(currentUser.uid);
    });

    // Re-register when the app returns to the foreground so the token is
    // refreshed (e.g. after a build update, permission change, or reboot).
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }
      const currentUser = auth.currentUser;
      if (currentUser) {
        void registerToken(currentUser.uid);
      }
    });

    const Notifications = getNotificationsModule();
    if (Notifications) {
      void ensureReportCategoryAsync(Notifications);
      responseSubscriptionRef.current =
        Notifications.addNotificationResponseReceivedListener(
          (response: NotificationsNamespace.NotificationResponse) => {
            if (!isMounted) {
              return;
            }
            // Same shared tap router as the root-level cold-start handler;
            // the module-level claim key dedupes whichever listener fires
            // second. push() here preserves the in-tabs back stack for the
            // warm case; the cold-start path uses replace().
            tryHandleReportPushTap(response as ReportPushTapResponse, router, (
              route,
            ) => router.push(route));
          },
        );
    }

    return () => {
      isMounted = false;
      unsubscribeAuth();
      appStateSubscription.remove();
      responseSubscriptionRef.current?.remove();
      responseSubscriptionRef.current = null;
    };
  }, [router]);

  return null;
}


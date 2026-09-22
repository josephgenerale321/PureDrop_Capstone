import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import type * as NotificationsNamespace from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../../firebaseConfig";

const PUSH_CHANNEL_ID = "report-updates";

export const REPORT_CATEGORY_ID = "report-update";
export const VIEW_REPORTS_ACTION_ID = "view-reports";
export const VIEW_REPORTS_ACTION_TITLE = "View Your Reports";
const MY_REPORTS_ROUTE = "/regular_user/my_report" as Href;
const LOGIN_ROUTE = "/login" as Href;
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
const HANDLED_PUSH_TAP_KEY = "@puredrop/handled_push_tap";

const readHandledPushTap = async (): Promise<string | null> => {
  try {
    const stored = await AsyncStorage.getItem(HANDLED_PUSH_TAP_KEY);
    return typeof stored === "string" && stored.length > 0 && stored.length <= 512
      ? stored
      : null;
  } catch {
    return null;
  }
};

const writeHandledPushTap = async (descriptor: string): Promise<void> => {
  try {
    if (!descriptor) {
      return;
    }
    await AsyncStorage.setItem(HANDLED_PUSH_TAP_KEY, descriptor.slice(0, 512));
  } catch {
    // Non-fatal.
  }
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
    // Logged-out tap (or a tap for another account): park the deep link under
    // the push owner's key when known so the login handoff can continue
    // there, then land on Login instead of the unmatched-route error.
    if (!signedInUid || (pushOwnerUid && signedInUid !== pushOwnerUid)) {
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
    // post-login handoff can continue into the detail screen.
    const isReportPushRoute =
      rawRoute === "/regular_user/notifications" || rawRoute === String(MY_REPORTS_ROUTE);
    if (isReportPushRoute && detailRoute) {
      if (!signedInUid || (pushOwnerUid && signedInUid !== pushOwnerUid)) {
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
  if (detailRoute && (!signedInUid || (pushOwnerUid && signedInUid !== pushOwnerUid))) {
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
  if (handledReportPushTapKeys.has(tapKey)) {
    return true;
  }
  handledReportPushTapKeys.add(tapKey);
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
  void writeHandledPushTap(tapKey);
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
        // Replay guard: this tap was already routed in a previous launch
        // (persisted claim survives JS reloads / app kills, unlike the
        // in-memory Set). Skip navigation, but still clear the native slot so
        // the stale response stops being returned.
        try {
          const tapKey = describeReportPushTap(lastResponse);
          const alreadyHandled = await readHandledPushTap();
          if (alreadyHandled === tapKey) {
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


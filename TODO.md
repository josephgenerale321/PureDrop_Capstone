# TODO — Notifications: Tappable cards (safe on preview/dev builds)

## Goal
Make notification cards tappable so users can open the actual report, with
behavior that never crashes on preview or development builds.

## Steps
- [x] 1. Extend `NotificationItem` with optional `category`/`issue` context in
      `components/notifications/notif_func.tsx` (type + mapping + equality check).
- [x] 2. Make each notification card a `TouchableOpacity` in
      `app/regular_user/notifications/notification_main.tsx` with a safe
      `handleOpenReport` navigation handler (guarded try/catch + fallback).
- [x] 3. Add tap affordance (chevron icon), category display, and a subtle
      unread accent bar to the card UI.
- [x] 4. Run TypeScript / lint checks and verify no runtime crash paths on
      preview & development builds.
- [x] 5. Refactor: move `StyleSheet.create(...)` styles out of
      `notification_main.tsx` into `components/notifications/notif_styles.ts`
      and import them (matches existing `createReportStyles.ts` pattern).
- [x] 6. Scanability: status chips (icon + tinted pill), blue unread accent
      instead of red "error" border, relative timestamps, time-bucketed
      section headers (Today / Yesterday / Earlier).
- [x] 7. Behavior: eliminate redundant `markAllAsRead` Firestore writes.
      Removed the pathname effect + `tabPress` listener (was 3× per visit);
      kept a single `focus` listener. Made `markAllAsRead` idempotent in
      `useReportNotifications()` — it skips the `serverTimestamp()` write
      when there are no unread items, so repeated focus events cost nothing.
- [x] 8. Eliminate duplicate Firestore listeners: `useReportNotifications()`
      was instantiated in both `_layout.jsx` and `notification_main.tsx`,
      creating 2× `onSnapshot` listeners on the reports collection and user
      doc. Converted the hook to a React Context provider
      (`ReportNotificationsProvider` + `useReportNotifications()` consumer
      in `notif_func.tsx`). `_layout.jsx` now wraps the tab navigator in a
      single provider; both the tab-badge consumer and the notifications
      screen read the same shared state, so there is exactly one set of
      snapshot listeners for the whole `regular_user` session.
- [x] 9. Real push notifications: the old `scheduleReportUpdateNotificationAsync`
      was dead code (never called anywhere). Removed it from
      `push_notificationfunc.tsx` and added `sendReportStatusPush` — a
      Firestore-triggered Cloud Function in `functions/index.js` that POSTs
      to Expo's free push service whenever a report's `status` changes. It
      reads the user's saved `expoPushToken`/`pushNotificationEnabled` from
      `regular_user/{userId}` and sends a notification that deep-links to
      `/regular_user/notifications`. Pushes are best-effort and never block
      the report update.

- [x] 10. Supabase-based push (alternative to Firebase Cloud Function, which is
      blocked by the project's Spark billing plan):
      - Create `supabase/functions/send-report-push/index.ts` — a Supabase
        Edge Function that uses the existing `FIREBASE_SERVICE_ACCOUNT_KEY`
        secret (same OAuth2 pattern as `direct-password-reset`) with the
        Firestore datastore scope, reads the report owner's
        `expoPushToken`/`pushNotificationEnabled` from Firestore via the
        REST API, and POSTs a deep-linked notification to Expo's free push
        service.
      - Add `[functions.send-report-push] verify_jwt = false` to
        `supabase/config.toml`.
      - Admin dashboard: after a successful status change, fire-and-forget
        `supabase.functions.invoke('send-report-push', ...)` from
        `reportsService.js` (push failures never block the status save).
      - Deployed: `supabase functions deploy send-report-push` succeeded against
        project `kfanwlpemesqvquypqvh` (v1 ACTIVE). Verified live via a POST
        smoke test — the endpoint returns `{"error":"userId is required."}`
        (HTTP 400) for an empty payload, confirming it is reachable and
        validating input. The `FIREBASE_SERVICE_ACCOUNT_KEY` secret is present
        in the project's Edge Function secrets.




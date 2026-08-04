# TODO: Fix "no notification when app is closed" (remote push for closed app)

## Root Cause
- `SystemNotificationSync` uses LOCAL notifications (scheduleNotificationAsync
  trigger:null) which only fire while the app's JS runtime is alive. When the
  app is fully closed/killed, only REMOTE push (FCM) can deliver a notification.
- The `expo-notifications` plugin was not configured with an Android
  notification icon/color, and the push token was only registered once on auth.

## Changes Applied
- [x] Configured `expo-notifications` plugin in `app.json` with:
      - `icon`: `./assets/images/icon.png` (Android notification icon)
      - `color`: `#0EA5E9` (brand color)
      - `defaultChannel`: `report-updates`
      - `sounds`: `["default"]`
- [x] Hardened `PushNotificationSync` in `push_notificationfunc.tsx`:
      - Added a `registerToken` helper that is called on every auth state
        change AND when the app returns to the foreground (AppState), so the
        Expo push token is reliably saved to the user's Firestore profile.
      - The token is what enables the server (`send-report-push` Edge Function
        / `sendReportStatusPush` Firebase Function) to deliver a remote push
        even when the app is fully closed.
      - All registration is wrapped in try/catch; expected failures (no FCM
        credentials in dev/preview builds) are handled inside
        `registerForPushNotificationsAsync` and never crash.

## Important
- For closed-app push to work, the app must be REBUILT with `google-services.json`
  (FCM) bundled in so a real push token can be registered. Run:
  `eas build --profile preview --platform android` (or `development`).
- After reinstalling, next app launch/foreground registers the token. The
  server-side push triggers then deliver notifications even when the app is
  fully closed.
- Crash safety preserved: dev/preview builds without FCM simply skip remote
  push (no crash); the local in-app system notification still works when the
  app is open.
</content>

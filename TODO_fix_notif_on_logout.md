# TODO: Fix notifications appearing after logout

Issue: When the user logs out but the admin later sets a report status,
a remote push notification still arrives because the expired user's
`expoPushToken` remains stored in Firestore, and the server-side
`sendReportStatusPush` Cloud Function keeps delivering to it.

## Steps
- [x] Add `unregisterPushNotificationsAsync(uid)` helper in
      `components/notifications/push_notificationfunc.tsx` that clears the
      push token in Firestore (crash-safe: Firestore errors are non-fatal).
- [x] Add `resetSystemNotificationState()` in
      `components/notifications/system_notif.tsx` (clears module-scoped
      seeded/presented sets).
- [x] Add `resetFloatingNotificationState()` in
      `components/notifications/floating_notif.tsx` (clears module-scoped
      seeded/presented sets).
- [x] Call the unregister + reset helpers in
      `app/regular_user/signout/signout_modal.tsx` before calling
      `signOut(auth)`, wrapped in try/catch so it never crashes the logout
      flow on preview/dev builds.
- [x] Type-check: `npx tsc --noEmit` (no type errors from the new helpers)

# Fix: Duplicate Floating Banner on Status Change

## Problem
When the admin sets a report status while the app is open in the foreground,
the user sees TWO notifications for the same change:
1. The in-app floating toast (`floating_notif.tsx`) near the bottom tab bar.
2. A native Android heads-up notification (`system_notif.tsx`) at the top.

The native heads-up is scheduled by `SystemNotificationSync` via
`presentLocalNotification()` on a HIGH-importance channel, so Android shows it
as a banner even while the app is in the foreground.

## Plan
Edit `components/notifications/system_notif.tsx`:
- [x] Import `AppState` from `react-native`.
- [x] Track foreground/background state in a ref via an `AppState` listener.
- [x] In the subsequent-snapshot branch (new update during the session), only
      present the native local notification when the app is NOT active
      (backgrounded / lock screen). Still `markPresented(key)` when active so
      no duplicate appears when the app later backgrounds.
- [x] Keep the cold-start / app-open branch unchanged (floating banner does NOT
      show on app open, so no duplicate there).
- [x] Clean up the `AppState` subscription on unmount.
- [x] Ensure no new native modules / no crash on dev/preview builds.

## Files to edit
- `components/notifications/system_notif.tsx` (only)

## Dependent files
- None (no other files import the changed internals)

## Follow-up
- [x] Type-check: `npx tsc --noEmit` (running)
- [ ] Test in dev/preview: admin sets status -> only one banner while app is
      foreground; lock screen/background still sends native notification.

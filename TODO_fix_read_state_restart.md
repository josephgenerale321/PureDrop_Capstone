# TODO: Fix notification read-state after app/phone restart

## Problem
After restarting the phone/emulator, notifications the user already read in a
previous session become "unread" again (bell shows 2-3, floating banner and
push/system notification reappear) even though the read state IS persisted in
Firestore (`notificationsLastSeenAt`).

## Root Cause
On a fresh app start, `lastSeenMs` is initialized to `0` in memory. The
reports snapshot can arrive BEFORE the user-doc snapshot that carries the
`notificationsLastSeenAt` value. While that window is open, `lastSeenMs = 0`,
so `isNotificationUnread()` returns `true` for every notification (the code
treats `lastSeenMs <= 0` as "not loaded" AND "everything unread"). This causes:
- phantom unread count on the bell,
- the floating banner re-presenting the "newest unread",
- the system/push notification re-presenting too (module-scoped dedup sets
  reset on a fresh JS context after restart).

## Fix
- [x] `components/notifications/notif_func.tsx`:
  - Add a `lastSeenLoaded` flag to the context.
  - Persist `lastSeenMs` to AsyncStorage whenever it updates.
  - Restore `lastSeenMs` from AsyncStorage immediately on app start so it is
    never briefly `0` during the snapshot load race.
  - `unreadCount` returns `0` until `lastSeenLoaded` is true.
  - Reconcile server value with the local value (take the max).
- [x] `components/notifications/floating_notif.tsx`: gate the banner effect on
  `lastSeenLoaded` so it never presents a false "new unread".
- [x] `components/notifications/system_notif.tsx`: gate the system-notification
  effect on `lastSeenLoaded` the same way.
- [x] Follow-up (no duplicate presentation on reopen):
  - `components/notifications/system_notif.tsx`: the lock-screen/system
    notification now presents pending unread ONLY on a cold start (new JS
    context = phone/emulator restart). A plain reopen (background→foreground,
    same JS context) keeps the module-scoped dedup sets populated, so the same
    notification is NOT re-presented. (Removed the fresh-session reset here.)
  - `components/notifications/floating_notif.tsx`: the in-app floating banner
    now reacts ONLY to genuinely NEW unread updates that arrive while the app
    is running. It no longer shows an app-open banner for pending unread, so
    the same notification never re-appears every time the app is opened.
    Pending unread is surfaced by the OS lock-screen/system notification
    instead.

## Crash-safety
Only uses `@react-native-async-storage/async-storage` (already a dependency)
and existing APIs. All AsyncStorage reads/writes wrapped in try/catch. Safe in
dev/preview/Expo Go/web builds.

## Verify
- [x] `npx tsc --noEmit` clean (output empty = 0 errors)

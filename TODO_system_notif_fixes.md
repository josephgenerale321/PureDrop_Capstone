# TODO — Local system notification (floating notification outside the app)

Status legend: `[ ]` = pending, `[x]` = done

## Goal
Make the "outside the app" system notification appear in **development** and
**preview** builds whenever the admin sets/updates a report's status, without
crashing and without needing FCM/APNs credentials.

## Why local notifications instead of remote push
- Remote push (Expo + FCM/APNs) requires push credentials configured in the
  build. In dev/preview builds those aren't configured, so
  `getExpoPushTokenAsync()` throws and the push is silently skipped.
- Local notifications (`scheduleNotificationAsync` with `trigger: null`) are
  presented by the OS directly from the running app. They need **no** FCM/APNs
  credentials and **no** Firebase App initialization, so they work in dev,
  preview, and Expo Go (when the native module exists).
- This covers the app-open / backgrounded / reopened cases, which is where the
  admin normally updates a report while the user is using the app.

## Steps
- [x] 1. Create `components/notifications/system_notif.tsx`:
       - Reuse the safe native-module availability pre-check (never throws on
         runtimes that lack the `expo-notifications` native module).
       - Create the `report-updates` Android channel (importance HIGH).
       - Request notification permission only if not already granted.
       - Present the notification immediately via
         `scheduleNotificationAsync({ content, trigger: null })` — no FCM, no
         Firebase App, no push token.
       - `SystemNotificationSync` uses `useReportNotifications()`:
         - On app open, present ONE local system notification for the newest
           unread report update.
         - While running/backgrounded, present a local system notification for
           each genuinely NEW unread report update.
         - Track known IDs to avoid re-notifying the same update.
       - Fully crash-safe: all native calls wrapped in try/catch, `isMounted`
         guards, cleanup on unmount, renders `null`.
- [x] 2. Wire `<SystemNotificationSync />` into `app/regular_user/_layout.jsx`
       alongside `<PushNotificationSync />` and `<FloatingNotification />`.
- [x] 3. Verify typecheck with `npx tsc --noEmit` — clean.
- [x] 4. Verify preview build with `npx expo export --platform web` — exit 0
       (`Exported: dist`).
- [x] 5. Confirm the FCM-related WARN (`Default FirebaseApp is not initialized`)
       is no longer triggered by this new code path:
       - The local system path (`system_notif.tsx`) never calls
         `getExpoPushTokenAsync()`, so it never triggers the warning.
       - The existing remote-push path (`push_notificationfunc.tsx`) still
         calls `getExpoPushTokenAsync()`, but the "FCM/APNs not configured for
         this build" error is now downgraded to a quiet `console.debug` instead
         of a scary `console.warn`, so the warning is no longer surfaced in
         dev/preview. Remote push still works normally in production builds
         where FCM/APNs credentials ARE configured.
       - Re-verified with `npx tsc --noEmit` — exit 0 (`TSC_EXIT=0`).

## Remote push setup (for app-fully-closed delivery)
- [x] 6. User downloaded `google-services.json` into project root
       (`PureDrop_Capstone-main/google-services.json`). Verified correct:
       - `project_id`: `puredrop-capstone-project`
       - `project_number`: `781886256531`
       - `package_name`: `com.mermaid146.PureDrop_App` (matches `app.json`)
       - `mobilesdk_app_id`: `1:781886256531:android:6fdb333d8bf5660995a466`
       This is the file that lets `expo-notifications` initialize FCM on
       Android so `getExpoPushTokenAsync()` can produce a real push token.
- [x] 7. `.gitignore` now excludes the sensitive credential files so they are
       never committed:
       - `google-services.json`
       - `puredrop-capstone-project-firebase-adminsdk-*.json`
- [x] 8. Uploaded the FCM V1 push credential to Expo via `eas credentials`:
       - The local `expo push:android:upload` command is NOT supported in this
         Expo SDK version, so EAS CLI was used instead.
       - In the `eas credentials` menu the correct option was labeled
         **"Google Service Account"** (FCM V1) → **"Set up a Google Service
         Account Key for Push Notifications (FCM V1)"** → choose the
         `puredrop-capstone-project-firebase-adminsdk-*.json` service account
         key.
       - ⚠️ NAVIGATION NOTE: The user's `eas-cli@21.4.0` labels the FCM V1
         option "Google Service Account", NOT "FCM V1" (the FCM V1 entry shows
         as a separate line "None assigned yet"). The "Push Notifications
         (FCM Legacy)" entry is a DIFFERENT, wrong option. Upload to the FCM
         V1 / Google Service Account slot.
       - ✅ Confirmed: FCM V1 key uploaded successfully.
- [ ] 9. Remaining manual steps (require the user's Expo account):
       a. Rebuild the dev/preview Android app so FCM is bundled:
          `eas build --profile preview --platform android` (or
          `eas build --profile development --platform android`).
       b. Reinstall the new build. On next login/auth restore,
          `PushNotificationSync` will register a real `expoPushToken` in
          `regular_user/{uid}`. The server-side `send-report-push` Edge
          Function (which uses the service-account key via the
          `FIREBASE_SERVICE_ACCOUNT_KEY` Supabase secret) then delivers
          remote pushes even when the app is fully closed.

# TODO: Fix MISSING_INSTANCEID_SERVICE warning

## Goal
`MISSING_INSTANCEID_SERVICE` currently surfaces as a scary `console.warn`
("Push notification setup skipped"). It is a DEVICE-LEVEL FCM/GMS failure
(non-Google emulator image, Expo Go runtime, or a GMS-less physical device),
NOT a build/credential problem — and it is already fully caught so it never
crashes. We just need to classify it as expected/benign.

## Steps
- [x] Refactor `classifyPushRegistrationError` helper (or equivalent) in
      `components/notifications/push_notificationfunc.tsx`.
- [x] Recognize device-level FCM/GMS-missing errors as benign:
      `MISSING_INSTANCEID_SERVICE` / `SERVICE_NOT_AVAILABLE` /
      `Google Play Services` / etc.
- [x] Keep build-level credential errors (`fcm-credentials`,
      `FirebaseApp is not initialized`, `apns`) classified as before.
- [x] Log `console.debug` for BOTH benign categories; keep `console.warn`
      only for genuinely unexpected errors.
- [x] Confirm no crash path on dev/preview builds (already guarded by
      native-module pre-check + try/catch — verify untouched).
- [ ] Typecheck passes: `npx tsc --noEmit` (exit 0).


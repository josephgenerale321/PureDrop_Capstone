# TODO: EAS FCM google-services.json upload fix

## Goal
Make `google-services.json` (gitignored, never committed) available to BOTH
`development` and `preview` EAS cloud builds so remote push works, while local
`npx expo run:android` keeps working too — without crashing in any case.

## Steps
- [x] Update `eas.json` — add `GOOGLE_SERVICES_JSON=@./google-services.json`
      file env var to `development` and `preview` build profiles.
- [x] Update `app.config.js` — resolve `android.googleServicesFile` from
      `process.env.GOOGLE_SERVICES_JSON` (stripping the `@` prefix when needed),
      falling back to `app.json`'s `./google-services.json` for local dev.
- [x] Verify config parses cleanly (`npx expo config --type public`).
- [ ] Run `eas build --profile development --platform android` (or local
      `npx expo run:android`) and confirm google-services.json is uploaded
      (no more "not checked in" warning).
- [ ] Run `eas build --profile preview --platform android` for testers and
      confirm remote push works in the installed preview build.

## Notes
- The `@` prefix in the env value tells EAS CLI it is a *file* reference.
  EAS uploads the file content as a secret and on the build machine sets the
  env var to the materialized temp file path.
- No secret is committed to git: `eas.json` only holds the path reference,
  and `google-services.json` stays gitignored.
- If the env var is absent (plain local build), `app.config.js` falls back to
  `./google-services.json`, so local dev continues to work.

## MISSING_INSTANCEID_SERVICE (device-level, non-fatal)
- `WARN Push notification setup skipped: ... java.io.IOException:
  MISSING_INSTANCEID_SERVICE` is a Firebase InstanceID error meaning the
  RUNTIME has no Google Play Services / FCM support (NOT a build/credential
  problem).
- Where it happens: an Android emulator image WITHOUT "Google APIs" (plain
  AOSP image), Expo Go, or a physical device without GMS.
- Physical devices WITH Google Play Services (the normal case) register FCM
  tokens fine and remote push works.
- It is fully caught in `push_notificationfunc.tsx` and never crashes
  dev/preview/production builds; the local system notification path
  (`system_notif.tsx`) still delivers report updates on such devices.
- To see remote push work in dev/preview, run the build on a "Google APIs" /
  Google Play emulator image or a real GMS device.


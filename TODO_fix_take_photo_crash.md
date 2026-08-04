# TODO: Fix "Take Photo" crash in Edit Profile (dev/preview builds)

## Root Cause
- `expo-image-picker` config plugin was missing from `app.json`, so dev/preview
  (custom native) builds did not include the Android `CAMERA` permission in the
  manifest, causing `launchCameraAsync()` to crash the app.

## Changes Applied
- [x] Added `expo-image-picker` plugin to `app.json` with:
  - `photosPermission` string
  - `cameraPermission` string
  - `microphonePermission: false`
- [x] Hardened `camera_editprof.tsx`:
  - Permission denial now shows a friendly alert with a fallback suggestion.
  - Any camera launch error is caught and surfaced as an alert (no crash).
- [x] Verified with `npx expo config --type public` that the plugin resolves.
- [x] Verified no TypeScript errors in the changed files.

## Note
The `expo-image-picker` plugin propagates to native builds via `app.config.js`
(which spreads `appJson.expo`), so the Android `CAMERA` permission will now be
present in development and preview builds.

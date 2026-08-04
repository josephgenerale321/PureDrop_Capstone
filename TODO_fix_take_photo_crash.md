# TODO: Fix "Take Photo" crash in Edit Profile (dev/preview builds)

## Root Cause
- `expo-image-picker` config plugin is missing from `app.json`, so dev/preview
  (custom native) builds do not include the Android `CAMERA` permission in the
  manifest, causing `launchCameraAsync()` to crash the app.

## Steps
- [x] Add `expo-image-picker` plugin to `app.json` with Android/iOS permissions.
- [x] Harden `camera_editprof.tsx` to gracefully handle launch failures/permission denials.
- [x] Verify with `npx expo config --type public` that the plugin is resolved.

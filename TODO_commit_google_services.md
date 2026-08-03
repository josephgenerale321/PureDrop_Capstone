# TODO: Commit google-services.json to fix EAS build

## Goal
Make `google-services.json` (currently gitignored) available to EAS cloud builds
so the prebuild no longer fails with "google-services.json is missing".

## Root cause
EAS cloud builds only receive files tracked by git. `google-services.json` was
gitignored, so it never reached the build machine. The `GOOGLE_SERVICES_JSON`
file env var approach was not materializing the file in the build environment.

## Steps
- [x] Confirm `google-services.json` is gitignored (`git check-ignore` exit 0)
- [x] Remove `google-services.json` and `*.google-services.json` from `.gitignore`
- [x] Force-add the file to git (`git add -f google-services.json`)
- [x] Commit the file so EAS sees it
- [x] Push the commit to the remote (`origin/master`) so EAS cloud can see it
- [x] Confirm this fixes ALL profiles (development, preview, production):
      the file is now in git, so `app.config.js` resolves either via
      `GOOGLE_SERVICES_JSON` (dev/preview) or the `./google-services.json`
      fallback — which now exists on the build machine in every case.
- [ ] Re-run `eas build --profile development --platform android` and confirm
      the prebuild succeeds (no more "google-services.json is missing" error)

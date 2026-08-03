const appJson = require("./app.json");

const googleMapsAndroidApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
  "";

const rawGoogleServicesFile = process.env.GOOGLE_SERVICES_JSON;

// google-services.json is gitignored (never committed), so EAS cloud builds
// cannot read it from the repository. We pass it to the builder as an EAS
// *file* environment variable ("@./google-services.json"). When EAS resolves
// that variable on the build machine it materializes the file and sets the
// env var to the temporary file path (no "@" prefix). Locally the raw
// "@./..." value may be present (e.g. from .env), so strip the "@" to keep
// the relative path valid. If the env var is absent — a plain local build via
// `npx expo run:android` — fall back to app.json's "./google-services.json",
// which exists on the developer's machine.
const googleServicesFile = rawGoogleServicesFile
  ? rawGoogleServicesFile.replace(/^@/, "")
  : appJson.expo.android?.googleServicesFile;

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  android: {
    ...appJson.expo.android,
    googleServicesFile,
    config: {
      ...appJson.expo.android?.config,
      googleMaps: googleMapsAndroidApiKey
        ? {
            apiKey: googleMapsAndroidApiKey,
          }
        : undefined,
    },
  },
});

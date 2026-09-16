const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Widens MainActivity's `android:configChanges` so Android never re-creates the
 * Activity while the app is running.
 *
 * WHY THIS EXISTS
 * Any configuration change that is NOT declared in `android:configChanges`
 * makes Android destroy and re-create MainActivity. React Native then boots a
 * second React root inside the same JS engine while the previous one is still
 * registered, which:
 *   - makes expo-router's dev-only fork of `useLinking` log
 *     "Looks like you have configured linking in multiple places ..." (the
 *     module keeps a `linkingHandlers` array and sees two live handlers, even
 *     though the app only has a single linking config), and
 *   - throws away in-memory state and re-registers native modules (e.g.
 *     "Attempting to launch an unregistered ActivityResultLauncher").
 *
 * Real-device triggers are folding/unfolding (smallestScreenSize - fixed
 * upstream in expo/expo#42150), changing the system or per-app language
 * (locale, layoutDirection), changing display size or font size (density,
 * fontScale) and changing the system navigation mode (navigation) - the last
 * one matters here because this app hides the Android navigation bar at
 * runtime (see components/system/immersiveNavBar.tsx).
 *
 * `expo prebuild` - and therefore every EAS build, since android/ is gitignored
 * - regenerates AndroidManifest.xml from scratch. Keeping the tokens in a
 * config plugin is what makes the fix survive that regeneration.
 */
const EXTRA_CONFIG_CHANGES = [
  // Expo's template value stops at `uiMode`; everything below is added here.
  "smallestScreenSize",
  "density",
  "fontScale",
  "locale",
  "layoutDirection",
  "navigation",
];

const MAIN_ACTIVITY_NAME = ".MainActivity";
const CONFIG_CHANGES_ATTR = "android:configChanges";

/**
 * Merges the extra tokens into the main <activity> element's existing
 * configChanges list, preserving whatever the template already declared.
 * Pure + idempotent, so it can be reused by tests and run repeatedly.
 */
function withMergedConfigChanges(manifest) {
  const application = manifest?.manifest?.application?.[0];
  const activities = application?.activity ?? [];
  const mainActivity =
    activities.find((activity) => activity?.$?.["android:name"] === MAIN_ACTIVITY_NAME) ??
    activities[0];

  if (!mainActivity?.$) {
    return manifest;
  }

  const tokens = (mainActivity.$[CONFIG_CHANGES_ATTR] ?? "")
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of EXTRA_CONFIG_CHANGES) {
    if (!tokens.includes(token)) {
      tokens.push(token);
    }
  }

  mainActivity.$[CONFIG_CHANGES_ATTR] = tokens.join("|");
  return manifest;
}

const withAndroidConfigChanges = (config) =>
  withAndroidManifest(config, (config) => {
    config.modResults = withMergedConfigChanges(config.modResults);
    return config;
  });

module.exports = withAndroidConfigChanges;
module.exports.withMergedConfigChanges = withMergedConfigChanges;
module.exports.EXTRA_CONFIG_CHANGES = EXTRA_CONFIG_CHANGES;
// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// ---------------------------------------------------------------------------
// Metro resolution fix for @supabase/realtime-js.
//
// @supabase/supabase-js ships an ESM build (`dist/index.mjs`) that does
// `import { RealtimeClient } from "@supabase/realtime-js"`. Metro resolves
// that import through @supabase/realtime-js's `main: dist/main/index.js`,
// which is CommonJS and does a relative `require("./RealtimePresence")`.
// Metro's resolver fails to locate RealtimePresence from there, producing
// "Unable to resolve ./RealtimePresence" on Android bundling.
//
// Forcing @supabase/realtime-js to its ESM build (`dist/module/index.js`)
// resolves the imports correctly and is the safest fix that travels with the
// repo to EAS/CI builds (which install fresh node_modules).
// ---------------------------------------------------------------------------
const REALTIME_ESM_ENTRY = "@supabase/realtime-js/dist/module/index.js";

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@supabase/realtime-js") {
    return context.resolveRequest(context, REALTIME_ESM_ENTRY, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

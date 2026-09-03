// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

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

// ---------------------------------------------------------------------------
// Metro resolution fix for Nitro spec files (*.nitro -> *.nitro.ts).
//
// Packages built on Nitro Modules (e.g. react-native-vision-camera v5) import
// their specs with a double extension: `./specs/CameraFactory.nitro`, which
// resolves to `CameraFactory.nitro.ts`. Metro's incremental file map can miss
// those files when node_modules changes while the bundler (or its persistent
// cache) is live, producing "Unable to resolve ./specs/CameraFactory.nitro".
// Resolving them explicitly from disk makes bundling deterministic.
// ---------------------------------------------------------------------------
const SOURCE_EXTS = ["ts", "tsx", "js", "jsx"];

function resolveNitroSpec(context, moduleName, platform) {
  const isRelative = moduleName.startsWith("./") || moduleName.startsWith("../");
  if (!isRelative || !moduleName.endsWith(".nitro")) {
    return undefined;
  }

  const originDir = path.dirname(context.originModulePath);
  for (const ext of SOURCE_EXTS) {
    const candidate = path.resolve(originDir, `${moduleName}.${ext}`);
    if (fs.existsSync(candidate)) {
      return { type: "sourceFile", filePath: candidate };
    }
  }
  // Fall through to Metro's default resolution (it will raise the usual
  // "Unable to resolve" error if the file genuinely does not exist).
  return undefined;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@supabase/realtime-js") {
    return context.resolveRequest(context, REALTIME_ESM_ENTRY, platform);
  }

  const nitroResolution = resolveNitroSpec(context, moduleName, platform);
  if (nitroResolution) {
    return nitroResolution;
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

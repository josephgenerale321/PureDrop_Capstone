# No Internet Startup Screen — Implementation TODO

## Task
Implement a realtime "No Internet" full-screen screen matching the PureDrop Figma design (node 403:2). It should appear whenever wifi/network is off, work app-wide, never crash, and support Preview + Development builds.

## Steps
- [x] 1. Analyze Figma design (white bg, 232x232 illustration, "No Internet..." text, Inter Regular 20px centered)
- [x] 2. Download illustration from Figma -> `assets/images/no_internet.png`
- [x] 3. ~~Install `@react-native-community/netinfo`~~ **REVERTED** — native module caused `NativeModule.RNCNetInfo is null` crash in Preview/Development builds. Fully uninstalled from package.json + node_modules.
- [x] 4. Create `components/internet_error/startup/no_internetstart.tsx` — **pure-JS `fetch` reachability probe** (no native modules, no rebuild needed)
- [x] 5. Integrate `NoInternetStart` into root layout `app/_layout.tsx` app-wide (wraps the whole Stack)
- [x] 6. Verify netinfo dependency fully removed + image asset exists
- [x] 7. Type-check (`npx tsc --noEmit`) — passes
- [ ] 8. Manual test: toggle wifi off -> overlay appears; toggle on -> overlay disappears

## Final Approach (crash-proof)
- **NO native modules.** Uses only `fetch("https://clients3.google.com/generate_204")` probed every 3s with a 5s timeout.
- Works identically in Preview, Expo Go, Development, web, and production — **no rebuild required**.
- `AbortController` (when available) ensures a hung/offline request can never hang the app.
- All timers cleaned up on unmount; no state set after unmount.
- Only React Native core primitives rendered (`Image`, `Text`, `View`, `StyleSheet`).

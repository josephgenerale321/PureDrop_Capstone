# GPS Map Gesture Improvements

## Goal
Improve the GPS map gesture UX (zoom, conflicting buttons, swipe/momentum) while keeping everything crash-safe on preview/dev builds.

## Approved plan
1. Move "Follow Me" button to the left side so it no longer overlaps the zoom controls.
2. Fix gesture conflict so zoom buttons work (only capture pan on actual movement, not touch-start).
3. Add pinch-to-zoom using multi-touch.
4. Add pan momentum (fling) using gestureState.vx/vy.
5. Add double-tap to zoom in.

## Crash-safety requirements
- All new logic guarded so preview/dev builds never crash.
- No invalid/NaN values fed into map state.
- Gesture handlers must not throw.

## Progress
- [x] 1. Move "Follow Me" button to left side (GpsMapModal.tsx, createReportStyles.ts)
- [x] 2. Fix gesture conflict so zoom buttons work (OsmTileMap.native.tsx)
- [x] 3. Add pinch-to-zoom (OsmTileMap.native.tsx)
- [x] 4. Add pan momentum/fling (OsmTileMap.native.tsx)
- [x] 5. Add double-tap to zoom in (OsmTileMap.native.tsx)
- [x] 6. Verified with `npx tsc --noEmit --skipLibCheck` — no type errors.

## Notes
- Gesture conflict fix: `onStartShouldSetPanResponder` now returns `false` so the map no longer captures every touch. The child zoom `Pressable` buttons now receive `onPress`. Pan only takes over once movement exceeds a small threshold.
- `changeZoom` moved before `panResponder` and made ref-based to avoid TDZ and stale closures.
- Momentum animation frame is cancelled on unmount for crash-safety.
- All new gesture logic is guarded (try/catch, finite-number checks) so preview/dev builds never crash.

# GPS Map Pan Fix

## Problem
Pinching/dragging on the GPS map does not move the map. The two-finger (pinch)
branch in `onPanResponderMove` only handled zoom and returned early, so a pinch
drag never panned. Single-finger pan also needs to work reliably.

## Goal
Make the map pan with both single-finger drag and two-finger (pinch) drag,
while keeping zoom buttons, pinch-to-zoom, double-tap, and momentum working.

## Crash-safety
- All new logic guarded (ref-based, finite-number checks) so preview/dev builds never crash.

## Changes (OsmTileMap.native.tsx)
- Added `pinchCentroidRef` to track the midpoint of two touches.
- Added `dragOffsetRef` to mirror `dragOffset` so gesture callbacks read the latest value.
- Two-finger move: accumulate centroid delta into `dragOffset` so the map pans while pinching (zoom still works via distance ratio).
- Two-finger release: fold accumulated `dragOffset` into `centerPixel` and reset.
- Single-finger move/release: keep `dragOffsetRef` in sync.
- Reset `pinchCentroidRef` / `dragOffsetRef` on grant and terminate.

## Progress
- [x] Implement pan fixes
- [x] Verify with `npx tsc --noEmit --skipLibCheck` — no type errors reported.
- [x] Fix tap-and-hold-then-slide: `onStartShouldSetPanResponder` now returns
      `interactive` so the map claims the responder on touch-start. Capture phase
      stays `false` so the child zoom `Pressable` buttons still receive taps.
- [x] Refine to only affect 2-finger: `onStartShouldSetPanResponder` now claims
      the responder only when 2+ fingers are down (`event.nativeEvent.touches.length >= 2`).
      Single-finger behavior is unchanged — it still pans on movement via
`onMoveShouldSetPanResponder`, and zoom button taps still register.
      (Reverted — user wants single-finger hold-then-slide to work.)
- [x] Extract two-finger pinch (zoom + pan) into reusable `twofingerpinch.tsx`
      module (`useTwoFingerPinch` hook). `OsmTileMap.native.tsx` now imports and
      uses it. Handlers are memoized (stable identity) so the PanResponder
      useMemo stays stable. Fully guarded/try-catch for crash-safety on
      preview/dev builds.
- [x] Added Google-Maps style zoom gestures to `twofingerpinch.tsx`:
      1. Two-finger pinch (pull apart = zoom in, together = zoom out) + pan.
      2. Double-tap (zoom in a little).
      3. Double-tap & slide (up = zoom out, down = zoom in).
      Zoom buttons (+/-) remain handled by the UI.

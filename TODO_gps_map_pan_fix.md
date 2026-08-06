# GPS Map Pan Fix

## Problem
Pinching/dragging on the GPS map did not move the map, and the three zoom
gestures (pinch, double-tap, two-finger tap) were behaving inconsistently.

## Goal
Make the map pan with single-finger drag and two-finger (pinch) drag, and make
all three zoom gestures reliable:
- Pinch: spread two fingers apart = zoom in, push together = zoom out.
- Double-tap with one finger = zoom in.
- Single tap with two fingers = zoom out.

## Fixes
CONSOLIDATED all gesture logic into a single self-contained implementation in
`OsmTileMap.native.tsx` using raw touch handlers (`onTouchStart/Move/End/Cancel`)
that reliably report ALL active touches. This fixed the pinch detection that was
unreliable when split across multiple modules (`twofingerpinchZoom`,
`tapfingerZoom`, `slidercontrolViewMap` — no longer imported).

- Pinch-to-zoom with accumulated-scale detection for responsiveness; pans along
  with the pinch centroid.
- Double-tap (one finger) → zoom in. Detected on release and requires no
  movement, so a "tap then slide" is never mistaken for a double-tap.
- CLEANED UP gesture state to eliminate conflicts: the active-touch map is
  rebuilt from scratch on every touch event (no stale entries), and ALL gesture
  state is reset on grant/release/terminate so each gesture starts fresh. A
  `wasPinchRef` flag ensures a single-finger slide can never be treated as a
  pinch.
- Two-finger tap → zoom out.
- Single-finger drag / hold-then-slide → pan.
- Double-tap-and-hold-slide removed (conflicted with panning).
- Fixed `onTouchCancel` signature and `t.identifier` typing (string keys).

## Crash-safety
- All logic guarded (try/catch, finite-number checks) so preview/dev builds never crash.

## Progress
- [x] Fix pinch-to-zoom (spread = in, pinch = out) + pan
- [x] Fix double-tap (1 finger) → zoom in
- [x] Fix two-finger tap → zoom out
- [x] Fix single-finger drag / hold-then-slide → pan
- [x] Verify with `npx tsc --noEmit --skipLibCheck` — no type errors

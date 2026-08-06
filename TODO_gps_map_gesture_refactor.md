# GPS Map Gesture Refactor (fix 1-finger fast slide triggering zoom)

## Problem
A fast single-finger slide on the GPS map intermittently zooms in/out. Root cause:
pinch and two-finger-tap detection relied on the raw `activeTouchesRef` map, which can
back stale entries and misread a single finger as two fingers.

## Fix
Make `gesture.numberActiveTouches` (PanResponder's reliable source) the *authoritative*
signal for "how many fingers" during move and release. The raw touch map is used ONLY
to extract pinch coordinates, never to decide pinch vs single-finger. Also track
`maxTouchesRef` so a two-finger tap is detected reliably even if `numberActiveTouches`
shrinks at release.

## Refactor into separate files
Extract the gesture logic out of `OsmTileMap.native.tsx` into dedicated hook modules.

## Steps
- [ ] Create `useMapTouchTracker.ts` (raw touch tracking + activeTouchesRef)
- [ ] Create `useMapGestures.ts` (master PanResponder: pinch + tap + double-tap + pan + momentum)
- [ ] Refactor `OsmTileMap.native.tsx` to consume `useMapGestures`
- [ ] Verify with `npx tsc --noEmit --skipLibCheck` — no type errors

import { useCallback, useMemo, useRef } from "react";
import type { GestureResponderEvent, PanResponderGestureState } from "react-native";

type PixelPoint = { x: number; y: number };

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLIDE_THRESHOLD = 40;

/**
 * Options wired into OsmTileMap so the gesture handlers can update the map's
 * internal center/zoom state safely. All refs let the handlers read the latest
 * values without stale closures, and all setters mirror them into React state.
 */
type TwoFingerPinchOptions = {
  interactive: boolean;
  zoomRef: React.MutableRefObject<number>;
  centerPixelRef: React.MutableRefObject<PixelPoint>;
  dragOffsetRef: React.MutableRefObject<PixelPoint>;
  changeZoom: (direction: 1 | -1) => void;
  setDragOffset: (offset: PixelPoint) => void;
  setCenterPixel: (pixel: PixelPoint) => void;
  notifyRegionChange: (center: PixelPoint, zoom: number) => void;
};

/**
 * Encapsulates the map zoom gestures (Google-Maps style):
 *
 *  1. Two-finger pinch  : pull apart to zoom in, move together to zoom out.
 *  2. Double-tap        : tap twice fast with one finger to zoom in a little.
 *  3. Double-tap & slide: tap twice, keep the finger down on the second tap,
 *                         then slide UP to zoom out or slide DOWN to zoom in.
 *  4. (Zoom buttons are handled by the UI, not this hook.)
 *
 * Returns stable guard functions to be invoked from a PanResponder:
 *  - onGrant(e)      : call on onPanResponderGrant
 *  - onMove(e,g)     : call on onPanResponderMove; returns true if the gesture
 *                      was handled (pinch or double-tap-slide) so the caller
 *                      should NOT fall through to single-finger pan.
 *  - onRelease(e,g)  : call on onPanResponderRelease; returns true if the release
 *                      was handled (pinch release, double-tap, or double-tap-slide
 *                      end) so the caller should NOT fall through to single-finger
 *                      tap/pan handling.
 *  - onTerminate()   : call on onPanResponderTerminate
 *  - isPinchActive() : true while a pinch baseline is set (2+ fingers were down).
 *
 * The returned handlers are memoized (stable identity) so the parent's
 * PanResponder useMemo does not re-create on every render. Options are read from
 * a ref so the latest map state is always used without stale closures.
 *
 * Crash-safety: every handler is guarded against invalid/NaN values and can
 * never throw, so preview/dev builds never crash.
 */
export function useTwoFingerPinch(options: TwoFingerPinchOptions) {
  const pinRef = useRef(options);
  pinRef.current = options;

  // ---- Pinch state ---------------------------------------------------------
  // Keeps the last pinch distance so we can compute relative zoom steps.
  const pinchDistanceRef = useRef<number | null>(null);
  // Tracks the midpoint (centroid) of two touches so we can pan while pinching.
  const pinchCentroidRef = useRef<PixelPoint | null>(null);

  // ---- Double-tap / double-tap-and-slide state -----------------------------
  // Timestamp of the last single tap, for double-tap detection.
  const lastTapAtRef = useRef(0);
  // True while the user is holding the second tap of a double-tap (slide mode).
  const doubleTapSlideRef = useRef(false);
  // Y anchor where the second tap landed, to compute slide direction.
  const slideAnchorYRef = useRef(0);
  // True once a zoom was triggered by the slide (so release doesn't double-zoom).
  const slideZoomedRef = useRef(false);

  const onGrant = useCallback((event: GestureResponderEvent) => {
    pinchDistanceRef.current = null;
    pinchCentroidRef.current = null;

    // Detect whether this touch is the second tap of a double-tap.
    const now = Date.now();
    if (now - lastTapAtRef.current < DOUBLE_TAP_MS) {
      // It's a double-tap: keep the finger down and enter slide mode.
      doubleTapSlideRef.current = true;
      slideZoomedRef.current = false;
      slideAnchorYRef.current = event.nativeEvent.pageY;
    } else {
      doubleTapSlideRef.current = false;
      slideZoomedRef.current = false;
    }
  }, []);

  const onMove = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState): boolean => {
      try {
        // --- Two-finger pinch (zoom + pan). Takes priority over slide mode.
        if (gesture.numberActiveTouches >= 2) {
          doubleTapSlideRef.current = false;
          const touches = event.nativeEvent.touches;
          if (!touches || touches.length < 2) {
            return true;
          }
          const t0 = touches[0];
          const t1 = touches[1];

          // Zoom from the relative change in distance between the two touches.
          const dx = t1.pageX - t0.pageX;
          const dy = t1.pageY - t0.pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const prev = pinchDistanceRef.current;
          if (prev != null && Number.isFinite(distance) && distance > 0) {
            const ratio = distance / prev;
            if (ratio > 1.015) {
              pinRef.current.changeZoom(1); // pull apart → zoom in
            } else if (ratio < 0.985) {
              pinRef.current.changeZoom(-1); // together → zoom out
            }
          }
          pinchDistanceRef.current = Number.isFinite(distance) ? distance : null;

          // Pan from the movement of the centroid (midpoint) of the two touches.
          const cx = (t0.pageX + t1.pageX) / 2;
          const cy = (t0.pageY + t1.pageY) / 2;
          const prevCentroid = pinchCentroidRef.current;
          if (prevCentroid) {
            const panX = pinRef.current.dragOffsetRef.current.x + (cx - prevCentroid.x);
            const panY = pinRef.current.dragOffsetRef.current.y + (cy - prevCentroid.y);
            pinRef.current.dragOffsetRef.current = { x: panX, y: panY };
            pinRef.current.setDragOffset({ x: panX, y: panY });
          }
          pinchCentroidRef.current = { x: cx, y: cy };

          return true; // pinch handled; don't fall through to single-finger pan
        }

        // --- Double-tap-and-slide (single finger held after the 2nd tap).
        if (doubleTapSlideRef.current) {
          const y = event.nativeEvent.pageY;
          if (Number.isFinite(y)) {
            const dy = y - slideAnchorYRef.current;
            if (dy <= -DOUBLE_TAP_SLIDE_THRESHOLD) {
              pinRef.current.changeZoom(-1); // slide up → zoom out
              slideAnchorYRef.current = y;
              slideZoomedRef.current = true;
            } else if (dy >= DOUBLE_TAP_SLIDE_THRESHOLD) {
              pinRef.current.changeZoom(1); // slide down → zoom in
              slideAnchorYRef.current = y;
              slideZoomedRef.current = true;
            }
          }
          return true; // handled; don't pan the map
        }

        return false; // normal single-finger move → let the caller pan
      } catch {
        pinchDistanceRef.current = null;
        pinchCentroidRef.current = null;
        return true;
      }
    },
    [],
  );

  const onRelease = useCallback(
    (event: GestureResponderEvent, gesture: PanResponderGestureState): boolean => {
      try {
        // --- Pinch release: commit any accumulated two-finger pan.
        if (gesture.numberActiveTouches >= 2 || pinchDistanceRef.current != null) {
          const off = pinRef.current.dragOffsetRef.current;
          if (off.x !== 0 || off.y !== 0) {
            const nextCenter = {
              x: pinRef.current.centerPixelRef.current.x - off.x,
              y: pinRef.current.centerPixelRef.current.y - off.y,
            };
            pinRef.current.centerPixelRef.current = nextCenter;
            pinRef.current.setCenterPixel(nextCenter);
            pinRef.current.setDragOffset({ x: 0, y: 0 });
            pinRef.current.dragOffsetRef.current = { x: 0, y: 0 };
            pinRef.current.notifyRegionChange(nextCenter, pinRef.current.zoomRef.current);
          }
          pinchDistanceRef.current = null;
          pinchCentroidRef.current = null;
          doubleTapSlideRef.current = false;
          return true; // pinch release handled
        }

        // --- Double-tap-and-slide end: if no slide-zoom happened, treat it as a
        //     normal double-tap (zoom in once).
        if (doubleTapSlideRef.current) {
          doubleTapSlideRef.current = false;
          if (!slideZoomedRef.current) {
            pinRef.current.changeZoom(1); // double-tap → zoom in
          }
          slideZoomedRef.current = false;
          return true; // handled
        }

        // --- Single tap (no meaningful movement).
        const totalMove = Math.abs(gesture.dx) + Math.abs(gesture.dy);
        if (totalMove < 6) {
          lastTapAtRef.current = Date.now();
          return true; // handled (recorded for double-tap detection)
        }

        return false; // it's a single-finger pan → let the caller commit it
      } catch {
        pinchDistanceRef.current = null;
        pinchCentroidRef.current = null;
        doubleTapSlideRef.current = false;
        return false;
      }
    },
    [],
  );

  const onTerminate = useCallback(() => {
    pinchDistanceRef.current = null;
    pinchCentroidRef.current = null;
    doubleTapSlideRef.current = false;
    slideZoomedRef.current = false;
  }, []);

  const isPinchActive = useCallback(() => pinchDistanceRef.current != null, []);

  return useMemo(
    () => ({ onGrant, onMove, onRelease, onTerminate, isPinchActive }),
    [onGrant, onMove, onRelease, onTerminate, isPinchActive],
  );
}

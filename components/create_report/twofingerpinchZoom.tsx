import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type {
  GestureResponderEvent,
  NativeTouchEvent,
  PanResponderGestureState,
} from "react-native";

type PixelPoint = { x: number; y: number };

const PINCH_ZOOM_IN_SCALE = 1.06;
const PINCH_ZOOM_OUT_SCALE = 0.94;

/**
 * Options wired into OsmTileMap so the pinch handlers can update the map's
 * internal center/zoom state safely. All refs let the handlers read the latest
 * values without stale closures, and all setters mirror them into React state.
 */
type TwoFingerPinchOptions = {
  interactive: boolean;
  zoomRef: MutableRefObject<number>;
  centerPixelRef: MutableRefObject<PixelPoint>;
  dragOffsetRef: MutableRefObject<PixelPoint>;
  changeZoom: (direction: 1 | -1) => void;
  setDragOffset: (offset: PixelPoint) => void;
  setCenterPixel: (pixel: PixelPoint) => void;
  notifyRegionChange: (center: PixelPoint, zoom: number) => void;
};

/**
 * Encapsulates the two-finger pinch gesture (Google-Maps style):
 * spread two fingers apart to zoom in, push them together to zoom out, and the
 * map pans along with the pinch centroid.
 *
 * IMPORTANT: In a React Native PanResponder, `event.nativeEvent.touches` inside
 * the move callback often only contains the single responder touch, NOT all
 * active touches. To reliably detect a two-finger pinch, the caller must spread
 * the returned `touchHandlers` onto the map View. Those raw touch handlers
 * (`onTouchStart/Move/End/Cancel`) always report every active touch, which we
 * maintain in an internal map and use to compute pinch distance/centroid.
 *
 * Returns:
 *  - touchHandlers   : spread onto the map View to track all active touches.
 *  - onGrant(e)      : call on onPanResponderGrant
 *  - onMove(e,g)     : call on onPanResponderMove; returns true if the gesture
 *                      was handled (pinch) so the caller should NOT fall through
 *                      to single-finger pan.
 *  - onRelease(e,g)  : call on onPanResponderRelease; returns true if the release
 *                      was handled (pinch release) so the caller should NOT fall
 *                      through to single-finger tap/pan handling.
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

  // ---- Active-touch tracking (updated by raw touch handlers) --------------
  // Map of touch identifier -> position, so we can compute pinch distance and
  // centroid even though PanResponder's nativeEvent.touches is unreliable.
  const activeTouchesRef = useRef<Record<number, { x: number; y: number }>>({});

  // ---- Pinch state ---------------------------------------------------------
  // Keeps the last pinch distance so we can compute relative zoom steps.
  const pinchDistanceRef = useRef<number | null>(null);
  // Accumulated pinch scale across frames. We multiply each frame's
  // distance ratio into this and only trigger a zoom step once enough total
  // movement has built up. This makes pinch-to-zoom reliable and responsive
  // even though a single frame's finger movement is tiny.
  const pinchAccumScaleRef = useRef(1);
  // Tracks the midpoint (centroid) of two touches so we can pan while pinching.
  const pinchCentroidRef = useRef<PixelPoint | null>(null);

  const syncTouches = (touches: NativeTouchEvent[]) => {
    if (!touches) return;
    for (const t of touches) {
      if (t && typeof t.identifier === "number") {
        activeTouchesRef.current[t.identifier] = { x: t.pageX, y: t.pageY };
      }
    }
  };

  const removeTouches = (touches: NativeTouchEvent[]) => {
    if (!touches) return;
    for (const t of touches) {
      if (t && typeof t.identifier === "number") {
        delete activeTouchesRef.current[t.identifier];
      }
    }
  };

  // Raw touch handlers the caller spreads onto the map View. These reliably
  // report ALL active touches (unlike PanResponder's nativeEvent.touches).
  const touchHandlers = useMemo(
    () => ({
      onTouchStart: (e: GestureResponderEvent) => {
        try {
          syncTouches(e.nativeEvent.touches);
        } catch {
          /* non-fatal */
        }
      },
      onTouchMove: (e: GestureResponderEvent) => {
        try {
          syncTouches(e.nativeEvent.touches);
        } catch {
          /* non-fatal */
        }
      },
      onTouchEnd: (e: GestureResponderEvent) => {
        try {
          removeTouches(e.nativeEvent.changedTouches);
        } catch {
          /* non-fatal */
        }
      },
      onTouchCancel: (e: GestureResponderEvent) => {
        try {
          removeTouches(e.nativeEvent.changedTouches);
        } catch {
          /* non-fatal */
        }
      },
    }),
    [],
  );

  const onGrant = useCallback((_event: GestureResponderEvent) => {
    pinchDistanceRef.current = null;
    pinchCentroidRef.current = null;
    pinchAccumScaleRef.current = 1;

    // Sync any touches reported on grant.
    try {
      syncTouches(_event.nativeEvent.touches);
    } catch {
      /* non-fatal */
    }
  }, []);

  const onMove = useCallback(
    (_event: GestureResponderEvent, _gesture: PanResponderGestureState): boolean => {
      try {
        // --- Two-finger pinch (zoom + pan).
        const active = Object.values(activeTouchesRef.current);
        if (active.length >= 2) {
          const t0 = active[0];
          const t1 = active[1];

          // Zoom from the accumulated relative change in distance between the
          // two touches. We multiply each frame's distance ratio into an
          // accumulator and only trigger a zoom step once enough total movement
          // has built up. This makes pinch-to-zoom responsive and reliable.
          const dx = t1.x - t0.x;
          const dy = t1.y - t0.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const prev = pinchDistanceRef.current;
          if (prev != null && Number.isFinite(distance) && distance > 0) {
            const ratio = distance / prev;
            pinchAccumScaleRef.current *= Number.isFinite(ratio) ? ratio : 1;
            if (pinchAccumScaleRef.current >= PINCH_ZOOM_IN_SCALE) {
              pinRef.current.changeZoom(1); // spread apart → zoom in
              pinchAccumScaleRef.current = 1;
            } else if (pinchAccumScaleRef.current <= PINCH_ZOOM_OUT_SCALE) {
              pinRef.current.changeZoom(-1); // push together → zoom out
              pinchAccumScaleRef.current = 1;
            }
          } else if (prev == null) {
            // First frame with two touches: just establish the baseline.
            pinchAccumScaleRef.current = 1;
          }
          pinchDistanceRef.current = Number.isFinite(distance) ? distance : null;

          // Pan from the movement of the centroid (midpoint) of the two touches.
          const cx = (t0.x + t1.x) / 2;
          const cy = (t0.y + t1.y) / 2;
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
    (_event: GestureResponderEvent, gesture: PanResponderGestureState): boolean => {
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
          pinchAccumScaleRef.current = 1;
          return true; // pinch release handled
        }

        return false; // it's a single-finger tap/pan → let the caller handle it
      } catch {
        pinchDistanceRef.current = null;
        pinchCentroidRef.current = null;
        return false;
      }
    },
    [],
  );

  const onTerminate = useCallback(() => {
    activeTouchesRef.current = {};
    pinchDistanceRef.current = null;
    pinchCentroidRef.current = null;
    pinchAccumScaleRef.current = 1;
  }, []);

  const isPinchActive = useCallback(() => pinchDistanceRef.current != null, []);

  return useMemo(
    () => ({ touchHandlers, onGrant, onMove, onRelease, onTerminate, isPinchActive }),
    [touchHandlers, onGrant, onMove, onRelease, onTerminate, isPinchActive],
  );
}

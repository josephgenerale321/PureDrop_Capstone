import { useMemo, useRef } from "react";
import type { GestureResponderEvent, NativeTouchEvent } from "react-native";

export type PixelPoint = { x: number; y: number };

/**
 * Tracks ALL active touches on the map via raw touch handlers.
 *
 * IMPORTANT: In React Native a PanResponder's `event.nativeEvent.touches` inside
 * the move callback often only contains the single responder touch, NOT all
 * active touches. To reliably know how many fingers are down we spread these raw
 * `touchHandlers` onto the map View. This gives us a live map of every touch
 * identifier -> position, plus the maximum number of simultaneous touches seen
 * during the current gesture.
 *
 * The MAXIMUM touch count (`maxTouchesRef`) is the authoritative signal for
 * "was this a two-finger gesture", because `gesture.numberActiveTouches` can
 * shrink right at release (one finger lifts a frame before the other). Using the
 * max guarantees a two-finger tap / pinch is never missed, and crucially a
 * single-finger slide can never be promoted to a pinch just because the raw map
 * briefly held a stale entry.
 *
 * Consumers:
 *  - `useMapGestures` reads `maxTouchesRef` and `activeTouchesRef` to compute
 *    pinch distance / centroid and to decide two-finger tap vs single-finger pan.
 */
export function useMapTouchTracker() {
  // Authoritative map of currently-active touches (identifier -> position).
  const activeTouchesRef = useRef<Record<number, PixelPoint>>({});
  // Max number of simultaneous touches observed during the current gesture.
  const maxTouchesRef = useRef(0);

  const syncTouches = (touches: NativeTouchEvent[] | undefined | null) => {
    const next: Record<number, PixelPoint> = {};
    if (touches) {
      for (const t of touches) {
        if (t && typeof t.identifier === "number") {
          next[t.identifier] = { x: t.pageX, y: t.pageY };
        }
      }
    }
    activeTouchesRef.current = next;
    const count = Object.keys(next).length;
    if (count > maxTouchesRef.current) {
      maxTouchesRef.current = count;
    }
  };

  const resetGesture = () => {
    activeTouchesRef.current = {};
    maxTouchesRef.current = 0;
  };

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
          syncTouches(e.nativeEvent.touches);
        } catch {
          /* non-fatal */
        }
      },
      onTouchCancel: () => {
        try {
          resetGesture();
        } catch {
          /* non-fatal */
        }
      },
    }),
    [],
  );

  return { touchHandlers, activeTouchesRef, maxTouchesRef, resetGesture };
}

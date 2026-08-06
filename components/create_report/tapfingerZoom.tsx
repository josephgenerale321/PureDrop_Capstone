import { useMemo, useRef } from "react";
import type { GestureResponderEvent } from "react-native";

const TAP_MAX_MS = 300; // max duration for a "tap" (no long-press)
const TAP_MAX_MOVE = 14; // max finger movement (px) that still counts as a tap

/**
 * Options wired into OsmTileMap so the tap gestures can trigger zoom.
 */
type TapFingerZoomOptions = {
  interactive: boolean;
  changeZoom: (direction: 1 | -1) => void;
};

/**
 * Handles a Google-Maps style tap zoom gesture, crash-safe for preview/dev:
 *
 *  Single tap with two fingers: tap briefly with two fingers at once → zoom out.
 *
 * (The one-finger double-tap → zoom in, and double-tap-and-slide, are handled by
 * the `slidercontrolViewMap` module so both gestures don't conflict.)
 *
 * The caller must spread the returned `touchHandlers` onto the map View (merged
 * with any other module's touch handlers) so we can track the number of active
 * touches and the tap timing.
 *
 * Every handler is wrapped in try/catch and guarded against invalid values so it
 * can never throw on preview or development builds.
 */
export function useTapFingerZoom(options: TapFingerZoomOptions) {
  const optRef = useRef(options);
  optRef.current = options;

  // Map of touch identifier -> start position for the current gesture.
  // React Native types `identifier` as string, so keys are strings.
  const startPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  // Max number of simultaneous touches during the current gesture.
  const maxTouchesRef = useRef(0);
  // Timestamp when the current gesture started.
  const gestureStartRef = useRef(0);
// Whether any finger moved beyond the tap threshold (cancels the tap).
  const movedRef = useRef(false);

  const resetGesture = () => {
    startPositionsRef.current = {};
    maxTouchesRef.current = 0;
    gestureStartRef.current = 0;
    movedRef.current = false;
  };

  const touchHandlers = useMemo(
    () => ({
      // Record where each finger first touched down, and how many fingers are
      // down. This is the correct way to detect a two-finger tap.
      onTouchStart: (e: GestureResponderEvent) => {
        try {
          const touches = e.nativeEvent.touches || [];
          for (const t of touches) {
            if (t && typeof t.identifier === "string") {
              startPositionsRef.current[t.identifier] = { x: t.pageX, y: t.pageY };
            }
          }
          const count = touches.length;
          if (count > maxTouchesRef.current) {
            maxTouchesRef.current = count;
          }
          if (gestureStartRef.current === 0) {
            gestureStartRef.current = Date.now();
            movedRef.current = false;
          }
        } catch {
          /* non-fatal */
        }
      },
      // Detect actual finger movement from its start position (pageX/pageY),
      // NOT the element-relative locationX/pageX difference (which is a constant
      // and would always mark a tap as "moved").
      onTouchMove: (e: GestureResponderEvent) => {
        try {
          const touches = e.nativeEvent.touches || [];
          for (const t of touches) {
            const start = startPositionsRef.current[t.identifier];
            if (start) {
              if (
                Math.abs(t.pageX - start.x) > TAP_MAX_MOVE ||
                Math.abs(t.pageY - start.y) > TAP_MAX_MOVE
              ) {
                movedRef.current = true;
              }
            }
          }
        } catch {
          /* non-fatal */
        }
      },
      // Evaluate the gesture ONLY when all fingers are up (touches is empty).
      // onTouchEnd fires per-finger, so we must wait for the last finger to lift
      // to know the final touch count/duration.
      onTouchEnd: (e: GestureResponderEvent) => {
        try {
          const remaining = e.nativeEvent.touches ? e.nativeEvent.touches.length : 0;
          if (remaining > 0) {
            // Still fingers down — not the end of the gesture yet.
            return;
          }

          const now = Date.now();
          const duration = now - gestureStartRef.current;
          const touchCount = maxTouchesRef.current;
          const isTap =
            !movedRef.current &&
            duration >= 0 &&
            duration <= TAP_MAX_MS;

if (isTap && optRef.current.interactive) {
            if (touchCount >= 2) {
              // Single tap with two fingers → zoom out.
              optRef.current.changeZoom(-1);
            }
          }

          resetGesture();
        } catch {
          /* non-fatal */
        }
      },
onTouchCancel: (_e: GestureResponderEvent) => {
        try {
          resetGesture();
        } catch {
          /* non-fatal */
        }
      },
    }),
    [],
  );

  return { touchHandlers };
}

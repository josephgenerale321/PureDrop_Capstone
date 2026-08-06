import { useMemo, useRef } from "react";
import type { GestureResponderEvent } from "react-native";

const DOUBLE_TAP_MS = 300; // max gap between two taps to count as a double-tap

/**
 * Options wired into OsmTileMap so the double-tap can trigger zoom.
 */
type SliderControlViewMapOptions = {
  interactive: boolean;
  changeZoom: (direction: 1 | -1) => void;
};

/**
 * Google-Maps style double-tap zoom gesture:
 *
 *  Double-tap the map with one finger (tap twice in quick succession).
 *  A quick double-tap-and-release → zoom in.
 *
 * There is intentionally NO double-tap-and-hold-slide here. That gesture
 * conflicts with single-finger dragging (both the PanResponder pan and the
 * slide would try to move/zoom the map at once, which makes it feel buggy).
 * Keeping this module to just double-tap → zoom in is simpler and reliable.
 *
 * The caller must spread the returned `touchHandlers` onto the map View (merged
 * with any other module's touch handlers) so we can track tap timing.
 *
 * Every handler is wrapped in try/catch and guarded against invalid values so it
 * can never throw on preview or development builds.
 */
export function useSliderControlViewMap(options: SliderControlViewMapOptions) {
  const optRef = useRef(options);
  optRef.current = options;

  // Timestamp of the first tap of a potential double-tap.
  const firstTapAtRef = useRef(0);
  // Identifier of the finger used for the first tap.
  const firstTapIdRef = useRef<string | number | null>(null);

  const touchHandlers = useMemo(
    () => ({
      onTouchStart: (e: GestureResponderEvent) => {
        try {
          if (!optRef.current.interactive) return;
          const touches = e.nativeEvent.touches || [];
          // Only support a single-finger double-tap.
          if (touches.length !== 1) return;

          const t = touches[0];
          const now = Date.now();

          // If this is the second tap of a double-tap (came quickly after the
          // first), zoom in once.
          if (
            firstTapAtRef.current !== 0 &&
            now - firstTapAtRef.current < DOUBLE_TAP_MS
          ) {
            optRef.current.changeZoom(1); // double-tap → zoom in
            firstTapAtRef.current = 0;
            firstTapIdRef.current = null;
          } else {
            // Otherwise this is the first tap in a potential double-tap.
            firstTapAtRef.current = now;
            firstTapIdRef.current = t.identifier;
          }
        } catch {
          /* non-fatal */
        }
      },
      onTouchMove: (_e: GestureResponderEvent) => {
        // Intentionally empty: no slide behavior. Detection happens on
        // touch-start so a quick double-tap works even if the finger moves a
        // little between taps.
      },
      onTouchEnd: (_e: GestureResponderEvent) => {
        try {
          // If all fingers are up, clear the pending first-tap timer if it's the
          // end of a single tap (so a later tap starts fresh). We keep
          // firstTapAtRef for the double-tap window between taps.
        } catch {
          /* non-fatal */
        }
      },
      onTouchCancel: (_e: GestureResponderEvent) => {
        try {
          firstTapAtRef.current = 0;
          firstTapIdRef.current = null;
        } catch {
          /* non-fatal */
        }
      },
    }),
    [],
  );

  return { touchHandlers };
}

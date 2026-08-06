import { useMemo, useRef, type MutableRefObject } from "react";
import type {
  GestureResponderEvent,
  PanResponderGestureState,
  PanResponderInstance,
} from "react-native";
import { PanResponder } from "react-native";
import type { PixelPoint } from "./useMapTouchTracker";

export type MapGestureOptions = {
  interactive: boolean;
  zoomRef: MutableRefObject<number>;
  centerPixelRef: MutableRefObject<PixelPoint>;
  dragOffsetRef: MutableRefObject<PixelPoint>;
  changeZoom: (direction: 1 | -1) => void;
  setDragOffset: (offset: PixelPoint) => void;
  setCenterPixel: (pixel: PixelPoint) => void;
  notifyRegionChange: (center: PixelPoint, zoom: number) => void;
  startMomentum: (velocityX: number, velocityY: number) => void;
  /** Called when a new gesture begins so any in-flight fling is cancelled. */
  cancelMomentum: () => void;
};

/**
 * PanResponder for the OSM map. Handles single-finger pan + fling momentum.
 *
 * Pinch-to-zoom, double-tap zoom-in, and two-finger tap zoom-out were removed
 * because they were unreliable on device. Zoom is controlled via the +/- zoom
 * buttons rendered outside the map View.
 *
 * Crash-safety: every handler is wrapped in try/catch and guarded against
 * invalid/NaN values so preview/dev builds never crash.
 */
export function useMapGestures(options: MapGestureOptions) {
  const optRef = useRef(options);
  optRef.current = options;

  const panResponder: PanResponderInstance = useMemo(
    () =>
      PanResponder.create({
        // Claim the responder on touch start so single-finger panning is
        // reliable. The zoom buttons are rendered OUTSIDE the map View (in
        // OsmTileMap.native.tsx) so they are never blocked.
        onStartShouldSetPanResponder: () => optRef.current.interactive,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          if (!optRef.current.interactive) return false;
          return Math.abs(gestureState.dx) + Math.abs(gestureState.dy) > 3;
        },
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
          if (!optRef.current.interactive) return false;
          return Math.abs(gestureState.dx) + Math.abs(gestureState.dy) > 5;
        },

        onPanResponderGrant: (_event: GestureResponderEvent) => {
          try {
            // Fresh gesture: cancel any in-flight fling and reset drag offset.
            optRef.current.cancelMomentum();
            optRef.current.setDragOffset({ x: 0, y: 0 });
            optRef.current.dragOffsetRef.current = { x: 0, y: 0 };
          } catch {
            /* non-fatal: never crash preview/dev builds */
          }
        },

        onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
          try {
            // Single-finger pan: mirror the gesture delta into the drag offset.
            const dx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
            const dy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
            optRef.current.dragOffsetRef.current = { x: dx, y: dy };
            optRef.current.setDragOffset({ x: dx, y: dy });
          } catch {
            /* non-fatal: never crash preview/dev builds */
          }
        },

        onPanResponderRelease: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
          try {
            const dx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
            const dy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
            const nextCenter = {
              x: optRef.current.centerPixelRef.current.x - dx,
              y: optRef.current.centerPixelRef.current.y - dy,
            };
            optRef.current.centerPixelRef.current = nextCenter;
            optRef.current.setCenterPixel(nextCenter);
            optRef.current.setDragOffset({ x: 0, y: 0 });
            optRef.current.dragOffsetRef.current = { x: 0, y: 0 };
            optRef.current.notifyRegionChange(nextCenter, optRef.current.zoomRef.current);
            optRef.current.startMomentum(gesture.vx, gesture.vy);
          } catch {
            /* non-fatal: never crash preview/dev builds */
          }
        },

        onPanResponderTerminate: () => {
          try {
            optRef.current.setDragOffset({ x: 0, y: 0 });
            optRef.current.dragOffsetRef.current = { x: 0, y: 0 };
          } catch {
            /* non-fatal: never crash preview/dev builds */
          }
        },

        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  return panResponder;
}

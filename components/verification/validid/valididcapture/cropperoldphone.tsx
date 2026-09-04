import { PanResponder, type GestureResponderEvent } from "react-native";

import ValidIdCropper, {
  clamp,
  CROP_ASPECT,
  MIN_CROP_WIDTH,
  MOVE_THRESHOLD,
  type CropperGestureBuilders,
  type CropRect,
  type DisplayedRect,
  type ValidIdCropperProps,
} from "./valididcropper";

/**
 * Cropper variant for older OEM Android builds — Android 12 and below on
 * Vivo/Oppo/realme skins (Funtouch OS, ColorOS...). Those touch pipelines can
 * deliver PanResponder grant events with moveX/moveY of 0 (or NaN) and
 * coalesce a huge jump into the first move event, so the standard builders
 * teleport (or NaN out) the crop frame the moment the resize handle is
 * touched. This variant:
 *
 *  - never trusts the grant coordinates — it re-baselines from the first
 *    verified raw pageX/pageY instead of gestureState.moveX/moveY;
 *  - drops synthetic spike events larger than any real 16 ms finger travel;
 *  - accumulates pointer travel itself for the tap threshold (gestureState
 *    dx/dy inherit the same OEM coordinate quirks);
 *  - relies on the shared applyFrame guard so a non-finite frame can never
 *    reach layout, whichever path a buggy ROM takes.
 *
 * All other behavior (photo normalization, crop math, UI) is identical to the
 * standard ValidIdCropper — only the gesture tracking differs.
 */

// Largest per-event pointer delta (points) accepted as a real gesture. OEM
// ROMs synthesize spikes far larger than any physical 16 ms finger movement
// (typically a jump from a 0/NaN baseline to the true touch position).
const MAX_EVENT_DELTA = 240;

/** Sentinel meaning "no trustworthy touch position yet". */
const UNSET = { x: Number.NaN, y: Number.NaN };

/**
 * Raw page coordinates of a touch, or null when the ROM reported garbage
 * (undefined/NaN) — never trust gestureState.moveX/moveY on these builds.
 */
function pagePointOf(
  event: GestureResponderEvent,
): { x: number; y: number } | null {
  const { pageX, pageY } = event.nativeEvent;
  if (
    typeof pageX !== "number" ||
    typeof pageY !== "number" ||
    !Number.isFinite(pageX) ||
    !Number.isFinite(pageY)
  ) {
    return null;
  }
  return { x: pageX, y: pageY };
}

export function createLegacyAndroidGestures(
  deps: Parameters<CropperGestureBuilders>[0],
): ReturnType<CropperGestureBuilders> {
  const {
    displayedRef,
    frameRef,
    isSavingRef,
    lastTouchRef,
    isDraggingRef,
    applyFrame,
  } = deps;
  // Pointer travel since grant, accumulated from verified deltas — replaces
  // gestureState.dx/dy, which inherit the OEM coordinate quirks.
  let travelSinceGrant = 0;

  // Drags the whole crop frame around the visible photo.
  const movePan = PanResponder.create({
    onStartShouldSetPanResponder: () => !isSavingRef.current,
    onPanResponderGrant: () => {
      // Never trust the grant coordinates on these ROMs — the first verified
      // move event re-baselines instead (UNSET sentinel).
      lastTouchRef.current = { ...UNSET };
      travelSinceGrant = 0;
      isDraggingRef.current = false;
    },
    onPanResponderMove: (event) => {
      const current = displayedRef.current;
      const currentFrame = frameRef.current;
      if (isSavingRef.current || !current || !currentFrame) {
        return;
      }
      const point = pagePointOf(event);
      if (!point) {
        return;
      }
      const last = lastTouchRef.current;
      if (!Number.isFinite(last.x) || !Number.isFinite(last.y)) {
        // First trustworthy sample of this gesture — baseline only, no move.
        lastTouchRef.current = point;
        return;
      }
      const deltaX = point.x - last.x;
      const deltaY = point.y - last.y;
      lastTouchRef.current = point;
      if (
        Math.abs(deltaX) > MAX_EVENT_DELTA ||
        Math.abs(deltaY) > MAX_EVENT_DELTA
      ) {
        // Synthetic OEM spike (e.g. a jump from a 0 baseline) — drop it.
        return;
      }

      travelSinceGrant += Math.abs(deltaX) + Math.abs(deltaY);
      // Ignore micro-jitter so a tap never nudges the frame.
      if (!isDraggingRef.current) {
        if (travelSinceGrant < MOVE_THRESHOLD) {
          return;
        }
        isDraggingRef.current = true;
      }

      applyFrame({
        ...currentFrame,
        x: clamp(
          currentFrame.x + deltaX,
          current.offsetX,
          current.offsetX + current.width - currentFrame.width,
        ),
        y: clamp(
          currentFrame.y + deltaY,
          current.offsetY,
          current.offsetY + current.height - currentFrame.height,
        ),
      });
    },
    onPanResponderRelease: () => {
      isDraggingRef.current = false;
    },
    onPanResponderTerminate: () => {
      isDraggingRef.current = false;
    },
  });



  // Bottom-right corner handle — aspect-locked resize driven by the edge.
  const resizePan = PanResponder.create({
    // Capture so the corner handle wins over the frame's move gesture.
    onStartShouldSetPanResponderCapture: () => !isSavingRef.current,
    onPanResponderGrant: () => {
      lastTouchRef.current = { ...UNSET };
    },
    onPanResponderMove: (event) => {
      const current = displayedRef.current;
      const currentFrame = frameRef.current;
      if (isSavingRef.current || !current || !currentFrame) {
        return;
      }
      const point = pagePointOf(event);
      if (!point) {
        return;
      }
      const last = lastTouchRef.current;
      if (!Number.isFinite(last.x)) {
        // First trustworthy sample — baseline only, no resize.
        lastTouchRef.current = point;
        return;
      }
      const deltaX = point.x - last.x;
      lastTouchRef.current = point;
      if (Math.abs(deltaX) > MAX_EVENT_DELTA) {
        // Synthetic OEM spike — drop it.
        return;
      }

      // The top-left corner stays fixed and the frame never leaves the
      // visible photo.
      const maxWidth = Math.min(
        current.offsetX + current.width - currentFrame.x,
        (current.offsetY + current.height - currentFrame.y) * CROP_ASPECT,
      );
      if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        return;
      }
      const width = clamp(
        currentFrame.width + deltaX,
        MIN_CROP_WIDTH,
        maxWidth,
      );
      if (!Number.isFinite(width) || !Number.isFinite(width / CROP_ASPECT)) {
        return;
      }
      applyFrame({ ...currentFrame, width, height: width / CROP_ASPECT });
    },
    onPanResponderRelease: () => {
      lastTouchRef.current = { ...UNSET };
    },
    onPanResponderTerminate: () => {
      lastTouchRef.current = { ...UNSET };
    },
  });

  return { movePan, resizePan };
}

/**
 * Drop-in replacement for ValidIdCropper on legacy Android devices. Same
 * props, same crop behavior — only the gesture tracking is hardened.
 */
export default function CropperOldPhone(props: ValidIdCropperProps) {
  return <ValidIdCropper {...props} gestures={createLegacyAndroidGestures} />;
}

// Re-exported for callers that want the explicit types alongside the variant.
export type { CropRect, DisplayedRect, ValidIdCropperProps };

/**
 * Pinch/pan/double-tap zoom for the Valid ID cropper.
 *
 * Split out of valididcropper.tsx deliberately: that file is already large and
 * this is a self-contained concern (image transform + its gestures) that has no
 * business being interleaved with the crop-frame gesture builders.
 *
 * WHY NOT REUSE components/verification/photozoom
 * `ZoomablePhoto` is a well-hardened pinch/pan viewer, but it cannot be dropped
 * into the cropper: it accepts no children (the crop frame must render as an
 * overlay in the same coordinate space as the image) and it does not expose its
 * live transform (the cropper must map frame points back to IMAGE PIXELS, which
 * is only possible if it knows the current scale/translate). The proven ideas
 * from it are reused here - a 1..4 range, a 2.5x double-tap step and
 * focal-point-preserving pinch math - but the plumbing is cropper-specific.
 *
 * COORDINATE MODEL
 * The photo is drawn by an `absoluteFill` <Image resizeMode="contain">, so at
 * zoom 1 the bitmap is letterboxed and centered in the canvas. React Native
 * applies `transform` about the element's center, so a zoom `scale` grows the
 * bitmap about the canvas center and `tx`/`ty` then shift it. That makes the
 * whole transform describable by a single `DisplayedRect` - see
 * `effectiveRect` - which is the trick that lets the existing crop math, frame
 * clamping and resize limits keep working unchanged once zoom is on.
 */
import { PanResponder, type PanResponderInstance } from "react-native";
import type { DisplayedRect } from "./valididcropper";

/** No zooming out past the natural (letterboxed) size. */
export const MIN_ZOOM = 1;
/** 4x reads ID print comfortably; past that the 2560px copy starts to soften. */
export const MAX_ZOOM = 4;
/** Double-tap toggles between fit and this magnification. */
export const DOUBLE_TAP_ZOOM = 2.5;

/** Finger travel (points) that turns a tap into a drag. */
const TAP_SLOP = 8;
/** Maximum ms between taps to count as a double-tap. */
const DOUBLE_TAP_MS = 300;
/** Maximum distance (points) between taps to count as a double-tap. */
const DOUBLE_TAP_SLOP = 40;

/** Image transform. `scale` is a multiplier on the zoom-1 layout. */
export type ZoomState = {
  scale: number;
  tx: number;
  ty: number;
};

export const IDENTITY_ZOOM: ZoomState = { scale: 1, tx: 0, ty: 0 };

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

type TouchPoint = { x: number; y: number };

/**
 * Active touch positions in CANVAS points.
 *
 * `pageX/pageY` is preferred for the same reason the crop-frame gestures
 * prefer it: on some OEM skins `gestureState` coordinates are unreliable at
 * grant time. Falls back to locationX/locationY - a 0/0 grant on Vivo would
 * otherwise seed a wrong pinch baseline.
 */
function touchPoints(event: { nativeEvent?: unknown }): TouchPoint[] {
  const native = event.nativeEvent as
    | {
        touches?: {
          pageX?: unknown;
          pageY?: unknown;
          locationX?: unknown;
          locationY?: unknown;
        }[];
      }
    | undefined;
  const touches = native?.touches;
  if (!Array.isArray(touches)) {
    return [];
  }
  const points: TouchPoint[] = [];
  for (const touch of touches) {
    const x = isFiniteNumber(touch.pageX)
      ? touch.pageX
      : isFiniteNumber(touch.locationX)
        ? touch.locationX
        : Number.NaN;
    const y = isFiniteNumber(touch.pageY)
      ? touch.pageY
      : isFiniteNumber(touch.locationY)
        ? touch.locationY
        : Number.NaN;
    if (isFiniteNumber(x) && isFiniteNumber(y)) {
      points.push({ x, y });
    }
  }
  return points;
}

/** Number of fingers currently down, as the responder sees it. */
export function activeTouchCount(event: { nativeEvent?: unknown }): number {
  const native = event.nativeEvent as { touches?: unknown } | undefined;
  const touches = native?.touches;
  return Array.isArray(touches) ? touches.length : 0;
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export type ZoomGestureDeps = {
  /** The zoom-1 letterboxed rect for the current photo. */
  baseRef: { current: DisplayedRect | null };
  /** Canvas size, needed to clamp panning. */
  canvasRef: { current: { width: number; height: number } | null };
  /** Live transform - read on every gesture frame. */
  zoomRef: { current: ZoomState };
  /** True while a crop is being written; zoom is inert then. */
  isBusyRef: { current: boolean };
  /** Mirrors the transform into React state (gesture end / double-tap). */
  onCommit: (zoom: ZoomState) => void;
  /** Applies the transform every frame, for a smooth image. */
  onLive: (zoom: ZoomState) => void;
};

type ZoomGestureInternals = {
  startZoom: ZoomState;
  startMid: TouchPoint | null;
  startDist: number;
  startFinger: TouchPoint | null;
  travel: number;
  lastTapAt: number;
  lastTapPoint: TouchPoint | null;
  isPinching: boolean;
};

/**
 * One responder drives every image gesture: two fingers pinch, one finger pans
 * (only while zoomed, so it never fights the crop frame), and a still tap
 * toggles the double-tap zoom.
 *
 * Deliberately a canvas-level responder rather than another one on the frame -
 * the frame keeps its own move/resize responders, and because it is a CHILD of
 * this view, RN hands touches that land on the frame to the frame first.
 */
export function createZoomGestures(deps: ZoomGestureDeps): {
  zoomPan: PanResponderInstance;
} {
  const s: ZoomGestureInternals = {
    startZoom: { ...IDENTITY_ZOOM },
    startMid: null,
    startDist: 0,
    startFinger: null,
    travel: 0,
    lastTapAt: 0,
    lastTapPoint: null,
    isPinching: false,
  };

  const apply = (commit: boolean) => {
    const base = deps.baseRef.current;
    const canvas = deps.canvasRef.current;
    const next =
      base && canvas
        ? clampZoomPan(base, canvas, deps.zoomRef.current)
        : deps.zoomRef.current;
    deps.zoomRef.current = next;
    if (commit) {
      deps.onCommit(next);
    } else {
      deps.onLive(next);
    }
  };

  const reseed = (points: TouchPoint[]) => {
    s.isPinching = points.length >= 2;
    s.startZoom = { ...deps.zoomRef.current };
    s.startMid = s.isPinching ? midpoint(points[0], points[1]) : null;
    s.startDist = s.isPinching ? distance(points[0], points[1]) : 0;
    s.startFinger = points[0] ?? null;
    s.travel = 0;
  };

  const clearGesture = () => {
    s.isPinching = false;
    s.travel = 0;
    s.startFinger = null;
    s.startMid = null;
    s.startDist = 0;
  };

  const wantsGesture = (event: { nativeEvent?: unknown }): boolean => {
    if (deps.isBusyRef.current) {
      return false;
    }
    const count = activeTouchCount(event);
    // Two fingers = pinch. One finger only claims the canvas while zoomed, so
    // an unzoomed tap on the photo never shadows the crop frame.
    return count >= 2 || (count === 1 && isZoomedIn(deps.zoomRef.current));
  };

  const zoomPan = PanResponder.create({
    onStartShouldSetPanResponder: wantsGesture,
    onMoveShouldSetPanResponder: wantsGesture,
    // A pinch that begins on the crop frame must not be stolen back by the
    // frame's own move responder once we are already panning.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      reseed(touchPoints(event));
    },
    onPanResponderMove: (event, gestureState) => {
      if (deps.isBusyRef.current || !deps.baseRef.current) {
        return;
      }
      const points = touchPoints(event);

      if (points.length >= 2) {
        if (!s.isPinching) {
          // Second finger landed mid-drag: re-seed instead of jumping.
          reseed(points);
          return;
        }
        const dist = distance(points[0], points[1]);
        if (!isFiniteNumber(s.startDist) || s.startDist <= 1 || !isFiniteNumber(dist)) {
          return;
        }
        const scale = clampNumber(
          s.startZoom.scale * (dist / s.startDist),
          MIN_ZOOM,
          MAX_ZOOM,
        );

        // Pin the bitmap point under the finger midpoint to the new midpoint.
        // Coordinates are relative to the transform origin (the canvas center),
        // which is the point RN scales about.
        const canvas = deps.canvasRef.current;
        const originX = canvas ? canvas.width / 2 : 0;
        const originY = canvas ? canvas.height / 2 : 0;
        const applied = scale / Math.max(s.startZoom.scale, 0.01);
        const startMidX = (s.startMid?.x ?? originX) - originX;
        const startMidY = (s.startMid?.y ?? originY) - originY;
        const mid = midpoint(points[0], points[1]);

        deps.zoomRef.current = {
          scale,
          tx: mid.x - originX - (startMidX - s.startZoom.tx) * applied,
          ty: mid.y - originY - (startMidY - s.startZoom.ty) * applied,
        };
        apply(false);
        s.travel += Math.abs(gestureState.dx) + Math.abs(gestureState.dy);
        return;
      }

      // Back to one finger: keep panning from wherever the pinch left off.
      s.isPinching = false;
      const finger = points[0];
      if (!finger || !s.startFinger) {
        return;
      }
      s.travel += Math.abs(gestureState.dx) + Math.abs(gestureState.dy);
      deps.zoomRef.current = {
        ...deps.zoomRef.current,
        tx: s.startZoom.tx + (finger.x - s.startFinger.x),
        ty: s.startZoom.ty + (finger.y - s.startFinger.y),
      };
      apply(false);
    },
    onPanResponderRelease: (event) => {
      const now = Date.now();
      const end = touchPoints(event)[0] ?? s.startFinger;

      // A short, still gesture is a tap - the second one is a double-tap.
      if (s.travel <= TAP_SLOP && end) {
        const previous = s.lastTapPoint;
        const isDouble =
          previous != null &&
          now - s.lastTapAt <= DOUBLE_TAP_MS &&
          Math.hypot(end.x - previous.x, end.y - previous.y) <= DOUBLE_TAP_SLOP;

        if (isDouble) {
          s.lastTapAt = 0;
          s.lastTapPoint = null;
          deps.zoomRef.current = isZoomedIn(deps.zoomRef.current)
            ? { ...IDENTITY_ZOOM }
            : { scale: DOUBLE_TAP_ZOOM, tx: 0, ty: 0 };
        } else {
          s.lastTapAt = now;
          s.lastTapPoint = { x: end.x, y: end.y };
        }
      }

      clearGesture();
      apply(true);
    },
    onPanResponderTerminate: () => {
      clearGesture();
      apply(true);
    },
  });

  return { zoomPan };
}

/**
 * The zoom-1 letterboxed rect with the zoom/pan transform folded in.
 *
 * This is the whole reason zoom integrates cleanly: `scale` stays "canvas
 * points per image pixel" and `offsetX/offsetY` stay the bitmap's top-left, so
 * every existing consumer (crop origin math, frame drag clamping, resize
 * max-width) keeps working verbatim.
 */
export function effectiveRect(
  base: DisplayedRect,
  zoom: ZoomState,
): DisplayedRect {
  const scale = isFiniteNumber(zoom.scale) ? zoom.scale : 1;
  const tx = isFiniteNumber(zoom.tx) ? zoom.tx : 0;
  const ty = isFiniteNumber(zoom.ty) ? zoom.ty : 0;

  const centerX = base.offsetX + base.width / 2 + tx;
  const centerY = base.offsetY + base.height / 2 + ty;
  const width = base.width * scale;
  const height = base.height * scale;

  return {
    offsetX: centerX - width / 2,
    offsetY: centerY - height / 2,
    width,
    height,
    scale: base.scale * scale,
  };
}

/**
 * Keeps the photo from being dragged away from the canvas: a letterboxed image
 * smaller than the canvas has no freedom on that axis, and a zoomed one may
 * never be pulled in far enough to expose empty space.
 */
export function clampZoomPan(
  base: DisplayedRect,
  canvas: { width: number; height: number },
  zoom: ZoomState,
): ZoomState {
  const scale = clampNumber(
    isFiniteNumber(zoom.scale) ? zoom.scale : 1,
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const rect = effectiveRect(base, { scale, tx: 0, ty: 0 });

  const axis = (size: number, canvasSize: number, value: number): number => {
    // Rounded: sub-pixel drag freedom reads as jitter on the photo's edge.
    const room = Math.round((size - canvasSize) / 2);
    return room <= 0 ? 0 : clampNumber(value, -room, room);
  };

  return {
    scale,
    tx: axis(rect.width, canvas.width, isFiniteNumber(zoom.tx) ? zoom.tx : 0),
    ty: axis(rect.height, canvas.height, isFiniteNumber(zoom.ty) ? zoom.ty : 0),
  };
}

/** True when the transform is meaningfully zoomed in (gates one-finger pan). */
export function isZoomedIn(zoom: ZoomState): boolean {
  return isFiniteNumber(zoom.scale) && zoom.scale > 1.02;
}

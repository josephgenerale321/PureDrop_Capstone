/**
 * useZoomAnimation part 1/3 — types + crash-safe Reanimated probe.
 */
import { useMemo, useRef } from "react";
import { Animated, Easing } from "react-native";
import type { ZoomablePhotoDriver } from "./ZoomablePhotoView";

export type ZoomTarget = { scale: number; tx: number; ty: number };

/** One interface for both backends; ZoomablePhoto never branches on it. */
export type ZoomAnimation =
  | {
      kind: "reanimated";
      setLive: (scale: number, tx: number, ty: number) => void;
      animateTo: (target: ZoomTarget) => void;
      stop: () => void;
      getLive: () => ZoomTarget;
    }
  | {
      kind: "animated";
      scaleAnim: Animated.Value;
      panAnim: Animated.ValueXY;
      setLive: (scale: number, tx: number, ty: number) => void;
      animateTo: (target: ZoomTarget) => void;
      stop: () => void;
      getLive: () => ZoomTarget;
    };

/** Lazy, crash-safe check: can the Reanimated view module load? */
export function canUseReanimatedView(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./ZoomablePhotoView");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-reanimated") as Record<string, unknown>;
    return (
      mod != null &&
      typeof mod.useSharedValue === "function" &&
      typeof mod.useAnimatedStyle === "function" &&
      typeof mod.withTiming === "function" &&
      typeof mod.cancelAnimation === "function"
    );
  } catch {
    return false;
  }
}

export const ANIM_MS = 220;

/** Reanimated backend: drives the image through the driver ref. */
function buildReanimated(
  driverRef: { current: ZoomablePhotoDriver | null },
  liveMirror: { current: ZoomTarget },
): ZoomAnimation {
  const callDriver = (fn: (d: ZoomablePhotoDriver) => void) => {
    try {
      const d = driverRef.current;
      if (d != null) fn(d);
    } catch {
      /* non-fatal — mirror holds last good values */
    }
  };
  return {
    kind: "reanimated" as const,
    setLive: (s, x, y) => {
      if (Number.isFinite(s)) liveMirror.current.scale = s;
      if (Number.isFinite(x)) liveMirror.current.tx = x;
      if (Number.isFinite(y)) liveMirror.current.ty = y;
      callDriver((d) => d.setLive(s, x, y));
    },
    animateTo: (t) => {
      if (Number.isFinite(t.scale)) liveMirror.current.scale = t.scale;
      if (Number.isFinite(t.tx)) liveMirror.current.tx = t.tx;
      if (Number.isFinite(t.ty)) liveMirror.current.ty = t.ty;
      callDriver((d) => d.animateTo(t.scale, t.tx, t.ty));
    },
    stop: () => callDriver((d) => d.stop()),
    getLive: () => {
      try {
        const d = driverRef.current;
        if (d != null) {
          const live = d.getLive();
          if (Number.isFinite(live.scale)) liveMirror.current.scale = live.scale;
          if (Number.isFinite(live.tx)) liveMirror.current.tx = live.tx;
          if (Number.isFinite(live.ty)) liveMirror.current.ty = live.ty;
        }
      } catch {
        /* mirror is best-effort */
      }
      return { ...liveMirror.current };
    },
  };
}

/** Animated fallback backend: classic values, JS-driven timing. */
function buildAnimated(
  scaleAnim: Animated.Value,
  panAnim: Animated.ValueXY,
  liveMirror: { current: ZoomTarget },
): ZoomAnimation {
  return {
    kind: "animated" as const,
    scaleAnim,
    panAnim,
    setLive: (s, x, y) => {
      try {
        if (Number.isFinite(s)) {
          liveMirror.current.scale = s;
          scaleAnim.setValue(s);
        }
        if (Number.isFinite(x) && Number.isFinite(y)) {
          liveMirror.current.tx = x;
          liveMirror.current.ty = y;
          panAnim.setValue({ x, y });
        }
      } catch {
        /* transform stays at its last good value */
      }
    },
    animateTo: (t) => {
      try {
        if (Number.isFinite(t.scale)) liveMirror.current.scale = t.scale;
        if (Number.isFinite(t.tx)) liveMirror.current.tx = t.tx;
        if (Number.isFinite(t.ty)) liveMirror.current.ty = t.ty;
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: t.scale,
            duration: ANIM_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(panAnim, {
            toValue: { x: t.tx, y: t.ty },
            duration: ANIM_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        ]).start();
      } catch {
        try {
          scaleAnim.setValue(t.scale);
          panAnim.setValue({ x: t.tx, y: t.ty });
        } catch {
          /* non-fatal */
        }
      }
    },
    stop: () => {
      try {
        scaleAnim.stopAnimation();
      } catch {
        /* non-fatal */
      }
      try {
        panAnim.stopAnimation();
      } catch {
        /* non-fatal */
      }
    },
    getLive: () => ({ ...liveMirror.current }),
  };
}

export function useZoomAnimation(driverRef: { current: ZoomablePhotoDriver | null }): ZoomAnimation {
  const fallbackScale = useRef<Animated.Value | null>(null);
  const fallbackPan = useRef<Animated.ValueXY | null>(null);
  if (fallbackScale.current == null) {
    fallbackScale.current = new Animated.Value(1);
  }
  if (fallbackPan.current == null) {
    fallbackPan.current = new Animated.ValueXY({ x: 0, y: 0 });
  }
  const reanimated = useMemo(() => canUseReanimatedView(), []);
  const liveMirror = useRef<ZoomTarget>({ scale: 1, tx: 0, ty: 0 });
  return useMemo<ZoomAnimation>(() => {
    if (reanimated) return buildReanimated(driverRef, liveMirror);
    return buildAnimated(
      fallbackScale.current as Animated.Value,
      fallbackPan.current as Animated.ValueXY,
      liveMirror,
    );
  }, [reanimated, driverRef, fallbackScale, fallbackPan]);
}


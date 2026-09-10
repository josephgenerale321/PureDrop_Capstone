/**
 * ZoomablePhotoView — the Reanimated-driven image for ZoomablePhoto.
 *
 * Separated into its own module so the Reanimated hooks (`useSharedValue`,
 * `useAnimatedStyle`) can run UNCONDITIONALLY inside it (hooks rule), while
 * ZoomablePhoto itself — which must survive builds WITHOUT Reanimated's
 * native module — only ever `require`s this module lazily inside try/catch.
 *
 * The parent drives the gesture math and pushes values through the `driver`
 * ref; this view owns the shared values, the UI-thread animated style, and
 * the animation lifecycle. `withTiming` runs on the UI thread: pinch frames
 * are synchronous `.value` writes with no bridge traffic, no re-render, and
 * no JS listener overhead.
 */
import { useEffect, useRef } from "react";
import { Image, StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export type ZoomablePhotoDriver = {
  setLive: (scale: number, tx: number, ty: number) => void;
  animateTo: (scale: number, tx: number, ty: number) => void;
  stop: () => void;
  getLive: () => { scale: number; tx: number; ty: number };
};

type Props = {
  uri: string;
  driverRef: { current: ZoomablePhotoDriver | null };
  accessibilityLabel?: string;
  onLoad?: (event: { nativeEvent?: { source?: { width?: unknown; height?: unknown } } }) => void;
};

const ANIM_MS = 220;

export default function ZoomablePhotoView({ uri, driverRef, accessibilityLabel, onLoad }: Props) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // JS-side mirror of the destination (what animateTo was last asked for).
  // Shared values are also readable from JS, but the mirror survives even if
  // a worklet read throws mid-teardown — never crash the lightbox.
  const target = useRef({ scale: 1, tx: 0, ty: 0 });

  const animatedStyle = useAnimatedStyle(() => ({
    // Translate BEFORE scale so pan stays in screen pixels — matches the
    // focal-point math in ZoomablePhoto.
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  useEffect(() => {
    const driver: ZoomablePhotoDriver = {
      setLive: (s, x, y) => {
        try {
          if (Number.isFinite(s)) {
            target.current.scale = s;
            scale.value = s;
          }
          if (Number.isFinite(x)) {
            target.current.tx = x;
            tx.value = x;
          }
          if (Number.isFinite(y)) {
            target.current.ty = y;
            ty.value = y;
          }
        } catch {
          /* non-fatal — next frame recovers */
        }
      },
      animateTo: (s, x, y) => {
        try {
          if (Number.isFinite(s)) {
            target.current.scale = s;
            scale.value = withTiming(s, { duration: ANIM_MS });
          }
          if (Number.isFinite(x)) {
            target.current.tx = x;
            tx.value = withTiming(x, { duration: ANIM_MS });
          }
          if (Number.isFinite(y)) {
            target.current.ty = y;
            ty.value = withTiming(y, { duration: ANIM_MS });
          }
        } catch {
          /* native side missing — parent falls back to Animated */
        }
      },
      stop: () => {
        try {
          cancelAnimation(scale);
        } catch {
          /* non-fatal */
        }
        try {
          cancelAnimation(tx);
        } catch {
          /* non-fatal */
        }
        try {
          cancelAnimation(ty);
        } catch {
          /* non-fatal */
        }
      },
      getLive: () => {
        try {
          const s = scale.value;
          const x = tx.value;
          const y = ty.value;
          if (Number.isFinite(s)) target.current.scale = s;
          if (Number.isFinite(x)) target.current.tx = x;
          if (Number.isFinite(y)) target.current.ty = y;
        } catch {
          /* mirror is best-effort */
        }
        return { ...target.current };
      },
    };
    driverRef.current = driver;
    return () => {
      if (driverRef.current === driver) driverRef.current = null;
    };
  }, [driverRef, scale, tx, ty]);

  // Reset on photo swap — the parent also resets its math mirror.
  useEffect(() => {
    try {
      cancelAnimation(scale);
      cancelAnimation(tx);
      cancelAnimation(ty);
    } catch {
      /* non-fatal */
    }
    target.current = { scale: 1, tx: 0, ty: 0 };
    try {
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
    } catch {
      /* non-fatal */
    }
  }, [uri, scale, tx, ty]);

  return (
    <Animated.Image
      source={{ uri }}
      style={[localStyles.image, animatedStyle]}
      resizeMode="contain"
      onLoad={onLoad}
      // @ts-expect-error: Android-only GPU layer cache, stripped on iOS/web.
      renderToHardwareTextureAndroid
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? "Zoomable photo preview. Pinch or double-tap to zoom."}
    />
  );
}

const localStyles = StyleSheet.create({
  image: {
    width: "100%",
    height: "100%",
  },
});

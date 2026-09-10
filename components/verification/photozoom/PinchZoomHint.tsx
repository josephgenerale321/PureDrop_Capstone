/**
 * PinchZoomHint part 1/2 — animated "how to pinch" coach mark.
 * Renders the reference gesture with RN primitives (no image assets):
 * two fingertip dots start pinched together and spread apart on a loop.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

type PinchZoomHintProps = {
  visible: boolean;
  onDone?: () => void;
  autoHideMs?: number;
};

const SPREAD = 44;
const LEG_MS = 900;

export default function PinchZoomHint({ visible, onDone, autoHideMs = 6000 }: PinchZoomHintProps) {
  const spread = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const doneFired = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!visible) return;
    doneFired.current = false;
    let stopped = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let anim: Animated.CompositeAnimation | null = null;

    const fireDone = () => {
      if (doneFired.current || stopped) return;
      doneFired.current = true;
      try {
        onDoneRef.current?.();
      } catch {
        /* parent callback must never crash the overlay */
      }
    };

    try {
      spread.setValue(0);
      opacity.setValue(0);
      anim = Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(spread, {
              toValue: 1,
              duration: LEG_MS,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.delay(250),
            Animated.timing(spread, {
              toValue: 0,
              duration: LEG_MS,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.delay(350),
          ]),
          { iterations: 2 },
        ),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      anim.start(({ finished }) => {
        if (finished && !stopped) fireDone();
      });
      const ms = Number.isFinite(autoHideMs) && autoHideMs > 0 ? autoHideMs : 6000;
      hideTimer = setTimeout(fireDone, ms);
    } catch {
      fireDone();
    }

    return () => {
      stopped = true;
      try {
        anim?.stop();
      } catch {
        /* non-fatal */
      }
      if (hideTimer != null) {
        try {
          clearTimeout(hideTimer);
        } catch {
          /* non-fatal */
        }
      }
    };
  }, [visible, autoHideMs, spread, opacity]);

  if (!visible) return null;

  const leftDotX = spread.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, -SPREAD],
  });
  const rightDotX = spread.interpolate({
    inputRange: [0, 1],
    outputRange: [10, SPREAD],
  });
  const arrowOpacity = spread.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0.25, 1, 1],
  });
  const arrowScale = spread.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1.15],
  });

  return (
    <View style={hintStyles.overlay} pointerEvents="none" accessibilityElementsHidden>
      <Animated.View style={[hintStyles.pill, { opacity }]}>
        <View style={hintStyles.fingersRow}>
          <Animated.View style={[hintStyles.arrow, { opacity: arrowOpacity, transform: [{ scale: arrowScale }] }]}>
            <Text style={hintStyles.arrowGlyph}>{"\u2190"}</Text>
          </Animated.View>
          <View style={hintStyles.dotsZone}>
            <Animated.View style={[hintStyles.dot, { transform: [{ translateX: leftDotX }] }]} />
            <Animated.View style={[hintStyles.dot, { transform: [{ translateX: rightDotX }] }]} />
          </View>
          <Animated.View style={[hintStyles.arrow, { opacity: arrowOpacity, transform: [{ scale: arrowScale }] }]}>
            <Text style={hintStyles.arrowGlyph}>{"\u2192"}</Text>
          </Animated.View>
        </View>
        <Text style={hintStyles.caption}>Spread to zoom in {"\u00B7"} pinch to zoom out</Text>
      </Animated.View>
    </View>
  );
}

const hintStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.62)",
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 16,
  },
  fingersRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  dotsZone: {
    width: SPREAD * 2 + 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 2,
    borderColor: "#0EA5E9",
  },
  arrow: {
    width: 28,
    alignItems: "center",
  },
  arrowGlyph: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  caption: {
    marginTop: 10,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
});

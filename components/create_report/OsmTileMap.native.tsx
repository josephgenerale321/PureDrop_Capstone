import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { Region } from "./MapPicker";
import { useTwoFingerPinch } from "./twofingerpinch";

const TILE_SIZE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 19;

type PixelPoint = {
  x: number;
  y: number;
};

type OsmTileMapProps = {
  initialRegion: Region;
  interactive?: boolean;
  selectedPin?: {
    latitude: number;
    longitude: number;
  };
  style?: StyleProp<ViewStyle>;
  onRegionChangeComplete?: (region: Region) => void;
  /** When provided, the map recenters to this coordinate whenever `recenterKey` changes. */
  center?: {
    latitude: number;
    longitude: number;
  } | null;
  /** Bump this value to force the map to recenter to `center`. */
  recenterKey?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const longitudeToTileX = (longitude: number, zoom: number) =>
  ((longitude + 180) / 360) * 2 ** zoom;

const latitudeToTileY = (latitude: number, zoom: number) => {
  const safeLatitude = clamp(latitude, -85.05112878, 85.05112878);
  const radians = (safeLatitude * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
    2 ** zoom
  );
};

const tileXToLongitude = (tileX: number, zoom: number) => (tileX / 2 ** zoom) * 360 - 180;

const tileYToLatitude = (tileY: number, zoom: number) => {
  const radians = Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / 2 ** zoom)));
  return (radians * 180) / Math.PI;
};

const zoomForRegion = (region: Region) => {
  const roughZoom = Math.round(Math.log2(360 / Math.max(region.longitudeDelta, 0.001)));
  return clamp(roughZoom, 14, 17);
};

const regionToPixel = (
  region: { latitude: number; longitude: number },
  zoom: number,
): PixelPoint => ({
  x: longitudeToTileX(region.longitude, zoom) * TILE_SIZE,
  y: latitudeToTileY(region.latitude, zoom) * TILE_SIZE,
});

const pixelToRegion = (point: PixelPoint, zoom: number, width: number, height: number): Region => {
  const centerTileX = point.x / TILE_SIZE;
  const centerTileY = point.y / TILE_SIZE;
  const west = tileXToLongitude((point.x - width / 2) / TILE_SIZE, zoom);
  const east = tileXToLongitude((point.x + width / 2) / TILE_SIZE, zoom);
  const north = tileYToLatitude((point.y - height / 2) / TILE_SIZE, zoom);
  const south = tileYToLatitude((point.y + height / 2) / TILE_SIZE, zoom);

  return {
    latitude: tileYToLatitude(centerTileY, zoom),
    longitude: tileXToLongitude(centerTileX, zoom),
    latitudeDelta: Math.abs(north - south),
    longitudeDelta: Math.abs(east - west),
  };
};

export function OsmTileMap({
  initialRegion,
  interactive = false,
  selectedPin,
  style,
  onRegionChangeComplete,
  center,
  recenterKey = 0,
}: OsmTileMapProps) {
const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(() => zoomForRegion(initialRegion));
  const [centerPixel, setCenterPixel] = useState(() =>
    regionToPixel(initialRegion, zoomForRegion(initialRegion)),
  );
const [dragOffset, setDragOffset] = useState<PixelPoint>({ x: 0, y: 0 });
  const centerPixelRef = useRef(centerPixel);
  const dragOffsetRef = useRef<PixelPoint>({ x: 0, y: 0 });

  centerPixelRef.current = centerPixel;
  dragOffsetRef.current = dragOffset;

  // Refs used by the gesture handlers so the latest values are always read
  // inside PanResponder callbacks without needing to re-create them.
const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Holds the animation frame id for the fling momentum, so it can be cancelled.
  const momentumFrameRef = useRef<number | null>(null);

  // When the parent asks us to recenter (bumped `recenterKey`), snap the
  // internal center to the provided coordinate. Guarded against invalid/NaN
  // inputs so a bad fix can never corrupt the map state on dev/preview builds.
  useEffect(() => {
    if (!center) {
      return;
    }
    const { latitude, longitude } = center;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }

const nextPixel = regionToPixel({ latitude, longitude }, zoom);
    setCenterPixel(nextPixel);
    setDragOffset({ x: 0, y: 0 });
    notifyRegionChange(nextPixel, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // Cancel any in-flight momentum animation when the map unmounts, so a
  // requestAnimationFrame callback never fires after unmount (crash-safe).
  useEffect(() => {
    return () => {
      if (momentumFrameRef.current != null) {
        cancelAnimationFrame(momentumFrameRef.current);
        momentumFrameRef.current = null;
      }
    };
  }, []);

  const notifyRegionChange = useCallback(
    (nextCenter: PixelPoint, nextZoom: number) => {
      if (!layout.width || !layout.height) {
        return;
      }

      onRegionChangeComplete?.(
        pixelToRegion(nextCenter, nextZoom, layout.width, layout.height),
      );
    },
[layout.width, layout.height, onRegionChangeComplete],
  );

  // Change zoom level. Uses refs so it always reads the latest value even
  // when called from within a PanResponder callback (which is memoized).
  const changeZoom = useCallback(
    (direction: 1 | -1) => {
      const currentZoom = zoomRef.current;
      const nextZoom = clamp(currentZoom + direction, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === currentZoom) {
        return;
      }

      const scale = 2 ** (nextZoom - currentZoom);
      const currentCenter = centerPixelRef.current;
      const nextCenter = {
        x: currentCenter.x * scale,
        y: currentCenter.y * scale,
      };
      centerPixelRef.current = nextCenter;
      setZoom(nextZoom);
      setCenterPixel(nextCenter);
      notifyRegionChange(nextCenter, nextZoom);
    },
    [notifyRegionChange],
  );

  // Smooth fling/inertia after a quick pan. Fully guarded so it can never
  // throw on preview/dev builds (velocity or frame id may be stale).
  const startMomentum = useCallback(
    (velocityX: number, velocityY: number) => {
      try {
        if (!interactive) {
          return;
        }
        const vx = Number.isFinite(velocityX) ? velocityX : 0;
        const vy = Number.isFinite(velocityY) ? velocityY : 0;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < 0.15) {
          return;
        }
        // Cancel any in-flight momentum animation.
        if (momentumFrameRef.current != null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }

        let fx = vx;
        let fy = vy;
        const step = () => {
          fx *= 0.92;
          fy *= 0.92;
          const dx = fx;
          const dy = fy;
          if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
            momentumFrameRef.current = null;
            return;
          }
          const nextCenter = {
            x: centerPixelRef.current.x - dx,
            y: centerPixelRef.current.y - dy,
          };
          centerPixelRef.current = nextCenter;
          setCenterPixel(nextCenter);
          setDragOffset({ x: 0, y: 0 });
          notifyRegionChange(nextCenter, zoomRef.current);
          momentumFrameRef.current = requestAnimationFrame(step);
        };
        momentumFrameRef.current = requestAnimationFrame(step);
      } catch {
        // Non-fatal: momentum is a polish feature.
        if (momentumFrameRef.current != null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }
      }
    },
    [interactive, notifyRegionChange],
  );

// Two-finger pinch gesture (zoom + pan) extracted into its own module so it
  // can be reused and kept crash-safe. Refs wire the latest map state in.
  const pinch = useTwoFingerPinch({
    interactive,
    zoomRef,
    centerPixelRef,
    dragOffsetRef,
    changeZoom,
    setDragOffset,
    setCenterPixel,
    notifyRegionChange,
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
// Claim the responder as soon as a finger touches the map so that
        // single-finger tap-and-hold-then-slide panning works. We keep the
        // *capture* phase returning false so the child zoom Pressable buttons
        // still receive their own touches (children win responder negotiation
        // in the bubble phase before this parent's non-capture handler).
        onStartShouldSetPanResponder: () => interactive,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          if (!interactive) return false;
          // A real drag: both fingers down (pinch) or a single-finger move.
          // Return true so the map pans. Small movements (< 2px) are ignored so
          // taps on the zoom buttons still register.
          const isPinch = gestureState.numberActiveTouches >= 2;
          return (
            isPinch ||
            Math.abs(gestureState.dx) + Math.abs(gestureState.dy) > 2
          );
        },
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
          if (!interactive) return false;
          const isPinch = gestureState.numberActiveTouches >= 2;
          return (
            isPinch ||
            Math.abs(gestureState.dx) + Math.abs(gestureState.dy) > 4
          );
        },
onPanResponderGrant: (event) => {
          // A touch started on the map. The pinch module handles pinch, double-tap,
          // and double-tap-and-slide detection.
          if (momentumFrameRef.current != null) {
            cancelAnimationFrame(momentumFrameRef.current);
            momentumFrameRef.current = null;
          }
          pinch.onGrant(event);
          setDragOffset({ x: 0, y: 0 });
          dragOffsetRef.current = { x: 0, y: 0 };
        },
        onPanResponderMove: (_event, gesture) => {
          // Pinch, double-tap-slide, and pan are handled by the pinch module.
          // If it handled the gesture, do NOT fall through to single-finger pan.
          if (pinch.onMove(_event, gesture)) {
            return;
          }
          // Single-finger pan.
          dragOffsetRef.current = { x: gesture.dx, y: gesture.dy };
          setDragOffset({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          // Pinch release, double-tap, and double-tap-slide end are all handled
          // by the pinch module. If it handled the release, do NOT fall through.
          if (pinch.onRelease(_event, gesture)) {
            return;
          }

          // A real single-finger pan → commit the final center and start momentum.
          const nextCenter = {
            x: centerPixelRef.current.x - gesture.dx,
            y: centerPixelRef.current.y - gesture.dy,
          };
centerPixelRef.current = nextCenter;
          setCenterPixel(nextCenter);
          setDragOffset({ x: 0, y: 0 });
          dragOffsetRef.current = { x: 0, y: 0 };
          notifyRegionChange(nextCenter, zoomRef.current);
          startMomentum(gesture.vx, gesture.vy);
        },
        onPanResponderTerminate: () => {
          pinch.onTerminate();
          setDragOffset({ x: 0, y: 0 });
          dragOffsetRef.current = { x: 0, y: 0 };
        },
      }),
    [interactive, zoomRef, changeZoom, notifyRegionChange, startMomentum, pinch],
  );

const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  const apiKey: string | undefined = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

  const tiles = useMemo(() => {
    if (!layout.width || !layout.height) {
      return [];
    }

    const worldTiles = 2 ** zoom;
    const viewportLeft = centerPixel.x - layout.width / 2 - dragOffset.x;
    const viewportTop = centerPixel.y - layout.height / 2 - dragOffset.y;
    const minTileX = Math.floor(viewportLeft / TILE_SIZE) - 1;
    const maxTileX = Math.floor((viewportLeft + layout.width) / TILE_SIZE) + 1;
    const minTileY = Math.floor(viewportTop / TILE_SIZE) - 1;
    const maxTileY = Math.floor((viewportTop + layout.height) / TILE_SIZE) + 1;
    const visibleTiles = [];

    for (let x = minTileX; x <= maxTileX; x += 1) {
      for (let y = minTileY; y <= maxTileY; y += 1) {
        if (y < 0 || y >= worldTiles) {
          continue;
        }

        const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;

          visibleTiles.push({
            key: `${zoom}-${x}-${y}`,
            left: x * TILE_SIZE - viewportLeft,
            top: y * TILE_SIZE - viewportTop,
            uri: apiKey
              ? `https://api.maptiler.com/tiles/satellite-v2/${zoom}/${wrappedX}/${y}.jpg?key=${apiKey}`
              : undefined,
          });
      }
    }

    // Filter out tiles when API key is missing to avoid invalid URIs.
    return visibleTiles.filter((t) => Boolean(t.uri));
  }, [centerPixel.x, centerPixel.y, dragOffset.x, dragOffset.y, layout.height, layout.width, zoom, apiKey]);

  return (
    <View style={[styles.map, style]} onLayout={handleLayout} {...panResponder.panHandlers}>
      <View style={styles.tileCanvas}>
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tile.uri }}
            style={[styles.tile, { left: tile.left, top: tile.top }]}
          />
        ))}
      </View>

      {!layout.width || !layout.height ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      ) : null}

      {!apiKey ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Map tiles unavailable (missing MAPTILER key)</Text>
        </View>
      ) : null}

      {selectedPin && !interactive ? (
        <View style={styles.previewPin} pointerEvents="none">
          <Ionicons name="location" size={30} color="#EF4444" />
        </View>
      ) : null}

      {interactive ? (
        <View style={styles.zoomControls}>
          <Pressable style={styles.zoomButton} onPress={() => changeZoom(1)}>
            <Ionicons name="add" size={22} color="#0F172A" />
          </Pressable>
          <Pressable style={styles.zoomButton} onPress={() => changeZoom(-1)}>
            <Ionicons name="remove" size={22} color="#0F172A" />
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.attribution}>MapTiler</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    backgroundColor: "#DDE8EE",
    overflow: "hidden",
  },
  tileCanvas: {
    ...StyleSheet.absoluteFillObject,
  },
  tile: {
    position: "absolute",
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E0F2FE",
  },
  loadingText: {
    color: "#0369A1",
    fontSize: 12,
    fontWeight: "700",
  },
  previewPin: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -15,
    marginTop: -30,
  },
  zoomControls: {
    position: "absolute",
    right: 16,
    top: 96,
    gap: 8,
  },
  zoomButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 4,
  },
  attribution: {
    position: "absolute",
    right: 8,
    bottom: 8,
    color: "#475569",
    fontSize: 9,
    fontWeight: "700",
    backgroundColor: "rgba(255,255,255,0.78)",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
});

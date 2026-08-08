import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { Region } from "./MapPicker";
import type { PixelPoint } from "./useMapTouchTracker";
import { useMapGestures } from "./useMapGestures";

const TILE_SIZE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 19;

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

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const momentumFrameRef = useRef<number | null>(null);

  // Cancel any in-flight momentum (fling) animation.
  const cancelMomentum = useCallback(() => {
    if (momentumFrameRef.current != null) {
      cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }, []);

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
    dragOffsetRef.current = { x: 0, y: 0 };
    notifyRegionChange(nextPixel, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

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
        if (momentumFrameRef.current != null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }
        // PanResponder `gesture.vx/vy` are in PIXELS PER MILLISECOND. We must
        // scale them by the real elapsed time of each animation frame
        // otherwise a fast swipe is treated as a tiny per-frame step and the
        // fling "creeps then stops". Decay is time-based too so it is smooth
        // and frame-rate independent.
        let fx = vx; // px/ms
        let fy = vy; // px/ms
        let lastTime = Date.now();
        const step = () => {
          const now = Date.now();
          const dt = Math.min((now - lastTime) / 16.667, 3); // frames elapsed (clamped)
          lastTime = now;
          // ~0.9 velocity retention per base frame (60fps) => ~60% per second,
          // a natural, glide-then-settle fling instead of an abrupt stop.
          const decay = Math.pow(0.9, dt);
          fx *= decay;
          fy *= decay;
          // Distance for this frame = velocity (px/ms) * elapsed time (ms),
          // converted so a fast swipe actually glides fast.
          const dx = fx * dt * 16.667;
          const dy = fy * dt * 16.667;
          if (
            Math.abs(dx) < 0.05 &&
            Math.abs(dy) < 0.05 &&
            Math.abs(fx) < 0.05 &&
            Math.abs(fy) < 0.05
          ) {
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
        if (momentumFrameRef.current != null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }
      }
    },
[interactive, notifyRegionChange],
  );

  // ---- Master PanResponder (extracted to a separate module) ----
  // useMapGestures owns single-finger pan + fling momentum. Pinch-to-zoom,
  // double-tap zoom-in, and two-finger tap zoom-out were removed because they
  // were unreliable on device. Zoom is controlled via the +/- zoom buttons.
  const panResponder = useMapGestures({
    interactive,
    zoomRef,
    centerPixelRef,
    dragOffsetRef,
    changeZoom,
    setDragOffset,
    setCenterPixel,
    notifyRegionChange,
    startMomentum,
    cancelMomentum,
  });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  const apiKey: string | undefined = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

// Tile layout is computed from the settled center ONLY (NOT the drag
  // offset). During a finger drag the offset is applied as a transform on the
  // tile canvas container, so React does not have to recompute + reconcile all
  // the tile <Image> components on every move frame — the existing image views
  // simply translate, which is far cheaper on the JS thread and reduces lag on
  // hold+slide (especially on emulator / preview / lower-end devices). New
  // tiles are fetched on release (when centerPixel settles).
  const tiles = useMemo(() => {
    if (!layout.width || !layout.height) {
      return [];
    }
    const worldTiles = 2 ** zoom;
    const viewportLeft = centerPixel.x - layout.width / 2;
    const viewportTop = centerPixel.y - layout.height / 2;
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
    return visibleTiles.filter((t) => Boolean(t.uri));
  }, [centerPixel.x, centerPixel.y, layout.height, layout.width, zoom, apiKey]);

  return (
    <View style={[styles.container, style]}>
      <View
        style={styles.map}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
<View
          style={[
            styles.tileCanvas,
            dragOffset.x !== 0 || dragOffset.y !== 0
              ? ({
                  transform: [
                    { translateX: dragOffset.x },
                    { translateY: dragOffset.y },
                  ],
                } as ViewStyle)
              : null,
          ]}
        >
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

        <Text style={styles.attribution}>MapTiler</Text>
      </View>

      {interactive ? (
        <View style={styles.zoomControls} pointerEvents="box-none">
          <Pressable style={styles.zoomButton} onPress={() => changeZoom(1)}>
            <Ionicons name="add" size={22} color="#0F172A" />
          </Pressable>
          <Pressable style={styles.zoomButton} onPress={() => changeZoom(-1)}>
            <Ionicons name="remove" size={22} color="#0F172A" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#DDE8EE",
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
    // Moved down a bit so the +/- buttons clear the floating top bar and sit
    // lower on the map (previously they were tucked high at top:96).
    top: 120,
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

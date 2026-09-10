import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { canUseReanimatedView, useZoomAnimation, ANIM_MS } from "./useZoomAnimation";
import type { ZoomablePhotoDriver } from "./ZoomablePhotoView";

// Zoom limits / double-tap tuning for the verification photo lightboxes.
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_DELAY_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;
// A tap must be a quick down-up: anything held longer is a hold, not a tap.
const TAP_MAX_DURATION_MS = 400;

type ZoomablePhotoProps = {
  /** Remote or local image URI to display. */
  uri: string;
  accessibilityLabel?: string;
  containerStyle?: ViewStyle;
};

/**
 * ZoomablePhoto — pinch-to-zoom + drag-to-pan + double-tap-to-zoom image
 * viewer used by the verification fullscreen lightboxes
 * (reviewselfiedetails.tsx selfie viewer, valid_id_submittedview.tsx ID viewer).
 *
 * Crash-safety (preview / dev / Expo Go builds):
 * - React Native core only (PanResponder + Animated) — no native gesture or
 *   worklet modules, so nothing can throw from a missing native install.
 * - Two-finger distance is tracked from raw touch events (PanResponder's
 *   gesture state alone is unreliable on OEM Android skins), with every value
 *   guarded by Number.isFinite and every handler wrapped in try/catch.
 * - Zoom is clamped to [1, 4] and pan is clamped to the photo bounds, so the
 *   image can never fly off-screen or produce a NaN transform.
 */
export default function ZoomablePhoto({ uri, accessibilityLabel, containerStyle }: ZoomablePhotoProps) {
  const viewRef = useRef<View | null>(null);
  // Transform backend: Reanimated UI-thread shared values when the native
  // module is present, classic Animated values otherwise. Chosen ONCE per
  // mount (canUseReanimatedView is a memoized probe) so hooks stay stable.
  const useReanimated = useMemo(() => {
    try {
      return canUseReanimatedView();
    } catch {
      return false;
    }
  }, []);
  const driverRef = useRef<ZoomablePhotoDriver | null>(null);
  const zoom = useZoomAnimation(driverRef);
  // Latest on-screen values. On the Reanimated backend these come from the
  // UI-thread shared values (readable from JS at any time — no stale-mirror
  // teleport). On the Animated fallback the hook mirrors setLive/animateTo
  // targets, and apply() re-asserts them — same contract as before.
  const liveScale = useRef(1);
  const liveX = useRef(0);
  const liveY = useRef(0);
  // True while a double-tap/snap animation is in flight. Ownership handoff
  // is handled by syncLive() + the animSeq/gestureSeq id check (stop +
  // capture live + stale-drop).
  const animating = useRef(false);
  // Completion-mirror timer for animateTo (neither backend exposes an
  // animation callback). Cleared + replaced on every new animation.
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reanimated view module, loaded lazily so builds WITHOUT the native
  // module (Expo Go, web preview) never crash on import. Null = Animated
  // fallback path renders instead.
  const ReanimatedView = useMemo(() => {
    if (!useReanimated) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("./ZoomablePhotoView") as {
        default?: React.ComponentType<{
          uri: string;
          driverRef: { current: ZoomablePhotoDriver | null };
          accessibilityLabel?: string;
          onLoad?: (event: {
            nativeEvent?: { source?: { width?: unknown; height?: unknown } };
          }) => void;
        }>;
      };
      return mod?.default ?? null;
    } catch {
      return null;
    }
  }, [useReanimated]);
  // Where the zoom is HEADED (animation target), not where it currently is
  // mid-flight. The double-tap toggle reads THIS so rapid taps alternate
  // cleanly (in -> out -> in) even when a tap lands mid-animation: reading
  // the interrupted live value would park at / flip from a half-zoomed state
  // (the fast-tap "holds the picture" bug).
  const targetScale = useRef(1);
  const state = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    width: 0,
    height: 0,
    baseDist: 0,
    baseScale: 1,
    pinching: false,
    lastDx: 0,
    lastDy: 0,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    // Single-tap candidate tracked from grant to release. A double-tap zoom
    // fires ONLY here, on release — never during a move — and only when the
    // finger went down and up fast, without moving past the slop and without
    // a second finger ever joining. This keeps fast one-finger slides from
    // ever tripping a tap zoom (the slide zoom-out).
    grantAt: 0,
    grantX: 0,
    grantY: 0,
    grantTouchCount: 0,
    grantTapLx: null as number | null,
    grantTapLy: null as number | null,
    movedPastSlop: false,
    prevCentroidX: 0,
    prevCentroidY: 0,
    hasPrevCentroid: false,
    // Intrinsic bitmap size (from the image onLoad event). Combined with the
    // container size it gives the CONTAIN-rendered bitmap size, which is what
    // the pan clamp must be built from — never the raw container size.
    imgW: 0,
    imgH: 0,
    // Previous frame's per-finger positions (identifier -> page coords), used
    // to tell a two-finger SLIDE apart from a real pinch by movement
    // DIRECTION (see the two-finger branch in onPanResponderMove).
    prevPositions: null as Map<number, { x: number; y: number }> | null,
  });
  // Live map of every active touch (identifier -> page coords + optional
  // container-relative location), synced from raw touch handlers because
  // PanResponder's touches list is unreliable. Each entry carries the time it
  // was last seen so stale entries (missed end events — common on Vivo
  // Funtouch OS, which drops touch-end frames under load) can be pruned
  // instead of poisoning the pinch math with a frozen finger position.
  const touches = useRef(
    new Map<number, { x: number; y: number; lx: number | null; ly: number | null; t: number }>(),
  );
  // Container origin in page coords, measured async via refreshPageOrigin.
  // It is ONLY trusted when measured (non-zero) — see toLocalFromResponder —
  // so a stale/unmeasured origin can never fling the photo off-screen.
  const pageOrigin = useRef({ x: 0, y: 0 });
  // Monotonic gesture id: bumped on every grant AND every release/terminate,
  // so any in-flight double-tap animation from a previous gesture can be
  // cancelled instead of fighting the new gesture's live values (a flicker
  // source on Vivo, where release/grant pairs can arrive back-to-back).
  // Also carried by each animation: a stale onComplete (e.g. a snap-back
  // scheduled just before a new pinch started) applies only when its id still
  // matches, otherwise it is dropped instead of yanking the live zoom.
  const gestureSeq = useRef(0);
  const animSeq = useRef(0);

  // Reset zoom whenever a different photo is shown (front/back/passport swap).
  // Also clear the cached bitmap size — the new photo's own onLoad will
  // re-seed it; until then clamp falls back to container size.
  useEffect(() => {
    const s = state.current;
    s.scale = 1;
    s.tx = 0;
    s.ty = 0;
    s.baseDist = 0;
    s.pinching = false;
    s.hasPrevCentroid = false;
    s.prevPositions = null;
    s.grantAt = 0;
    s.grantTouchCount = 0;
    s.movedPastSlop = false;
    s.imgW = 0;
    s.imgH = 0;
    liveScale.current = 1;
    liveX.current = 0;
    liveY.current = 0;
    targetScale.current = 1;
    try {
      zoom.setLive(1, 0, 0);
    } catch {
      /* non-fatal — next gesture re-syncs the animated values */
    }
  }, [uri, zoom]);

  const apply = () => {
    try {
      const s = state.current;
      zoom.setLive(s.scale, s.tx, s.ty);
      liveScale.current = s.scale;
      liveX.current = s.tx;
      liveY.current = s.ty;
    } catch {
      /* non-fatal — transform stays at its last good value */
    }
  };

  // CONTAIN-rendered bitmap size: the actual on-screen photo rect inside the
  // container. For a landscape photo in a tall container this is SHORTER than
  // the container — clamping pan to the container size would let the photo
  // slide far off vertically and leave the huge black gap from the report.
  const renderedSize = () => {
    const s = state.current;
    const cw = Number.isFinite(s.width) && s.width > 0 ? s.width : 0;
    const ch = Number.isFinite(s.height) && s.height > 0 ? s.height : 0;
    const iw = Number.isFinite(s.imgW) && s.imgW > 0 ? s.imgW : 0;
    const ih = Number.isFinite(s.imgH) && s.imgH > 0 ? s.imgH : 0;
    if (cw <= 0 || ch <= 0) return { w: 0, h: 0 };
    if (iw <= 0 || ih <= 0) return { w: cw, h: ch };
    const fit = Math.min(cw / iw, ch / ih);
    if (!Number.isFinite(fit) || fit <= 0) return { w: cw, h: ch };
    return { w: iw * fit, h: ih * fit };
  };

  const clamp = () => {
    const s = state.current;
    if (!Number.isFinite(s.scale)) s.scale = 1;
    s.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.scale));
    if (!Number.isFinite(s.tx)) s.tx = 0;
    if (!Number.isFinite(s.ty)) s.ty = 0;
    const cw = Number.isFinite(s.width) && s.width > 0 ? s.width : 0;
    const ch = Number.isFinite(s.height) && s.height > 0 ? s.height : 0;
    const { w, h } = renderedSize();
    // Scaled photo size vs the container: the photo may pan only while it
    // still covers the container on that axis. If the scaled photo is SMALLER
    // than the container (e.g. a short landscape photo at 1x in a tall
    // lightbox), the offset locks to the centering value so it can NEVER
    // slide into the top/bottom black gap from the report.
    const scaledW = w * s.scale;
    const scaledH = h * s.scale;
    // Photo is centered in the container at rest: rendered rect starts at
    // (cw - w)/2, (ch - h)/2. The pan offset that keeps that centering is
    // zero for translate-before-scale — the image view itself fills the
    // container and CONTAIN centers the bitmap inside it — so the lock value
    // is simply 0 on the undersized axis.
    const maxX = Math.max(0, (scaledW - cw) / 2);
    const maxY = Math.max(0, (scaledH - ch) / 2);
    s.tx = Math.min(maxX, Math.max(-maxX, s.tx));
    s.ty = Math.min(maxY, Math.max(-maxY, s.ty));
  };

  const stopAnimations = () => {
    // Capture the LIVE on-screen value into the JS mirror BEFORE stopping.
    // On the Reanimated backend this reads the UI-thread shared values
    // (always current — no stale-mirror teleport). On the Animated fallback
    // the hook mirrors the last setLive/animateTo targets.
    try {
      const live = zoom.getLive();
      const s = state.current;
      if (Number.isFinite(live.scale)) {
        s.scale = live.scale;
        liveScale.current = live.scale;
      }
      if (Number.isFinite(live.tx)) {
        s.tx = live.tx;
        liveX.current = live.tx;
      }
      if (Number.isFinite(live.ty)) {
        s.ty = live.ty;
        liveY.current = live.ty;
      }
    } catch {
      /* keep the previous mirror */
    }
    try {
      zoom.stop();
    } catch {
      /* non-fatal */
    }
  };

  // JS mirror -> screen values. On the Reanimated backend setLive writes the
  // UI-thread shared values synchronously (no bridge, no re-render); on the
  // Animated fallback it does the classic setValue pair. Either way the
  // hook also mirrors the targets for getLive(), so the next gesture always
  // starts from the true on-screen value (no stale-value teleport).
  const syncLive = () => {
    stopAnimations();
    gestureSeq.current += 1;
    animSeq.current = gestureSeq.current;
    // Re-assert the (now synced) mirror onto the screen values so the next
    // setLive continues from the on-screen position, never from a stale one.
    apply();
    // Keep the motion mirror in lockstep with the re-asserted values.
    try {
      const s = state.current;
      liveScale.current = s.scale;
      liveX.current = s.tx;
      liveY.current = s.ty;
    } catch {
      /* non-fatal */
    }
  };

  const animateTo = (toScale: number, toX: number, toY: number) => {
    try {
      const s = state.current;
      s.scale = toScale;
      s.tx = toX;
      s.ty = toY;
      stopAnimations();
      const id = gestureSeq.current;
      animSeq.current = id;
      animating.current = true;
      // Publish the destination FIRST so a rapid follow-up tap toggles from
      // where we're headed (clean in -> out -> in), never from an
      // interrupted mid-flight value (half-zoom park / direction flip).
      targetScale.current = toScale;
      // UI-thread timing on Reanimated (smooth even with a busy JS thread);
      // JS-driven timing of identical duration/easing on the fallback.
      zoom.animateTo({ scale: toScale, tx: toX, ty: toY });
      // Completion mirror: neither backend exposes an animation callback
      // (Reanimated worklets cannot safely touch this closure), so mirror
      // the animation window (ANIM_MS) plus margin for the animating flag +
      // stale-drop. stop()/getLive() stay authoritative regardless.
      if (animTimer.current != null) {
        try {
          clearTimeout(animTimer.current);
        } catch {
          /* non-fatal */
        }
        animTimer.current = null;
      }
      animTimer.current = setTimeout(() => {
        try {
          animTimer.current = null;
          // Animation is over either way -- release the takeover flag first so
          // a chained handler (e.g. release-then-grant) can proceed normally.
          animating.current = false;
          // Stale completion (a new gesture grabbed ownership mid-flight):
          // never touch the live values -- the new gesture owns them now.
          if (animSeq.current !== gestureSeq.current || id !== gestureSeq.current) return;
          const cur = state.current;
          cur.scale = toScale;
          cur.tx = toX;
          cur.ty = toY;
          clamp();
          apply();
        } catch {
          /* non-fatal */
        }
      }, ANIM_MS + 60);
    } catch {
      try {
        animating.current = false;
        zoom.setLive(toScale, toX, toY);
      } catch {
        /* non-fatal */
      }
    }
  };

  // Container-relative focal point. Primary source: the touches'
  // locationX/locationY (already relative to this container — no page-origin
  // measurement needed). Fallbacks: the PanResponder gesture's x0/y0 mapped
  // with the measured origin, then the container center.
  const toLocalFromResponder = (gestureX: unknown, gestureY: unknown) => {
    const s = state.current;
    const w = Number.isFinite(s.width) && s.width > 0 ? s.width : 0;
    const h = Number.isFinite(s.height) && s.height > 0 ? s.height : 0;
    const cx = w / 2;
    const cy = h / 2;
    const gx = typeof gestureX === "number" && Number.isFinite(gestureX) ? gestureX : NaN;
    const gy = typeof gestureY === "number" && Number.isFinite(gestureY) ? gestureY : NaN;
    if (Number.isFinite(gx) && Number.isFinite(gy)) {
      const ox = pageOrigin.current.x;
      const oy = pageOrigin.current.y;
      // Only trust the origin when it was actually measured (non-zero);
      // an unmeasured origin would offset the focal by the full page pos.
      if (Number.isFinite(ox) && Number.isFinite(oy) && (ox !== 0 || oy !== 0)) {
        return { x: gx - ox - cx, y: gy - oy - cy };
      }
    }
    return { x: 0, y: 0 };
  };

  // Tap point in local coords (center fallback when origin unmeasured).
  const toLocal = (pageX: number, pageY: number) => {
    return toLocalFromResponder(pageX, pageY);
  };

  // Merge-only tracking for start/move frames: on some Android skins a
  // PanResponder move event reports just the single responder touch even while
  // two fingers are down. Replacing the whole map from those frames made the
  // 2-finger count flap 2→1→2, restarting the pinch baseline every other
  // frame — that restart is the flicker. So start/move frames only ADD/UPDATE
  // points; only an end frame may REMOVE them.
  const collectTouches = (raw: unknown) => {
    const out: Array<{ id: number; x: number; y: number; lx: number | null; ly: number | null }> = [];
    try {
      if (Array.isArray(raw)) {
        for (const t of raw as Array<{
          identifier?: unknown;
          pageX?: unknown;
          pageY?: unknown;
          locationX?: unknown;
          locationY?: unknown;
        }>) {
          if (
            t &&
            typeof t.identifier === "number" &&
            Number.isFinite(t.identifier) &&
            typeof t.pageX === "number" &&
            Number.isFinite(t.pageX) &&
            typeof t.pageY === "number" &&
            Number.isFinite(t.pageY)
          ) {
            out.push({
              id: t.identifier,
              x: t.pageX,
              y: t.pageY,
              // Container-relative coords: no page-origin math needed.
              lx: typeof t.locationX === "number" && Number.isFinite(t.locationX) ? t.locationX : null,
              ly: typeof t.locationY === "number" && Number.isFinite(t.locationY) ? t.locationY : null,
            });
          }
        }
      }
    } catch {
      /* ignore malformed touch lists */
    }
    return out;
  };

  // Add/update only — safe for onTouchStart, onTouchMove and every
  // PanResponder event (grant/move), which must never shrink the map.
  const mergeTouches = (event: { nativeEvent?: { touches?: unknown } } | null | undefined) => {
    try {
      const now = Date.now();
      for (const t of collectTouches(event?.nativeEvent?.touches)) {
        touches.current.set(t.id, { x: t.x, y: t.y, lx: t.lx, ly: t.ly, t: now });
      }
    } catch {
      /* keep the previous touch map */
    }
  };

  // Only an end frame removes touches, keyed by changedTouches (the fingers
  // that actually lifted) so a partial touch list can't wipe the pinch.
  const removeEndedTouches = (
    event: { nativeEvent?: { touches?: unknown; changedTouches?: unknown } } | null | undefined,
  ) => {
    try {
      const map = touches.current;
      const changed = collectTouches(event?.nativeEvent?.changedTouches);
      if (changed.length > 0) {
        for (const t of changed) map.delete(t.id);
      } else {
        // No changedTouches info (rare): only trust an "all fingers up" frame.
        const remaining = collectTouches(event?.nativeEvent?.touches);
        if (remaining.length === 0) {
          touches.current = new Map();
          return;
        }
      }
      // Refresh positions of the fingers that are still down.
      const now = Date.now();
      for (const t of collectTouches(event?.nativeEvent?.touches)) {
        map.set(t.id, { x: t.x, y: t.y, lx: t.lx, ly: t.ly, t: now });
      }
    } catch {
      /* keep the previous touch map */
    }
  };

  // Drop entries not refreshed recently. Vivo/Funtouch under load drops
  // touch-end frames, leaving a frozen "ghost finger" that corrupts the next
  // pinch distance (flicker). Only entries seen within the window count.
  const STALE_TOUCH_MS = 120;
  // Reused across move frames — filled by livePointsInto, never allocated
  // per frame (old-phone GC win: a 120Hz touch stream used to allocate 2-3
  // arrays + a Map snapshot on EVERY frame).
  const liveScratch: Array<{ x: number; y: number; lx: number | null; ly: number | null }> = [];
  const livePointsInto = (
    out: Array<{ x: number; y: number; lx: number | null; ly: number | null }>,
  ) => {
    out.length = 0;
    const now = Date.now();
    try {
      for (const [id, p] of touches.current) {
        if (Number.isFinite(p.t) && now - p.t > STALE_TOUCH_MS) {
          touches.current.delete(id);
          continue;
        }
        out.push(p);
      }
    } catch {
      /* use whatever we collected */
    }
    return out;
  };
  const livePoints = () => livePointsInto(liveScratch);

  const pinchDistance = () => {
    try {
      const pts = livePoints();
      if (pts.length < 2) return 0;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const d = Math.hypot(dx, dy);
      return Number.isFinite(d) ? d : 0;
    } catch {
      return 0;
    }
  };

  const pinchCentroid = () => {
    try {
      const pts = livePoints();
      if (pts.length < 2) return null;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
      // Prefer container-relative coords (no origin math). Only fall back to
      // page coords when the event didn't carry locationX/locationY.
      const l0x = pts[0].lx;
      const l0y = pts[0].ly;
      const l1x = pts[1].lx;
      const l1y = pts[1].ly;
      let lx: number | null = null;
      let ly: number | null = null;
      if (l0x != null && l0y != null && l1x != null && l1y != null) {
        lx = (l0x + l1x) / 2;
        ly = (l0y + l1y) / 2;
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
          lx = null;
          ly = null;
        }
      }
      return { x: cx, y: cy, lx, ly };
    } catch {
      return null;
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, gesture) => {
          try {
            return state.current.scale > 1.02 || gesture.numberActiveTouches >= 2;
          } catch {
            return false;
          }
        },
        onPanResponderGrant: (event, gesture) => {
          try {
            const s = state.current;
            s.lastDx = 0;
            s.lastDy = 0;
            s.baseDist = 0;
            s.pinching = false;
            // New gesture takes over: stop the double-tap spring (if any) and
            // invalidate its completion, otherwise the spring keeps writing
            // the old zoom under the new fingers — the Vivo flicker.
            // Also clear the map FIRST so a ghost finger from a dropped
            // touch-end can't corrupt this gesture's pinch distance.
            syncLive();
            animating.current = false;
            touches.current = new Map();
            mergeTouches(event);
            // The page origin can be stale on the very first gesture (measure
            // is async), so re-sync it here — a wrong origin corrupts the
            // focal point and flings the photo off-screen into black.
            refreshPageOrigin();
            // Start a single-tap candidate: confirmed or discarded on release.
            s.grantAt = Date.now();
            s.grantX = Number.isFinite(gesture.x0) ? gesture.x0 : 0;
            s.grantY = Number.isFinite(gesture.y0) ? gesture.y0 : 0;
            s.grantTouchCount = touches.current.size;
            s.movedPastSlop = false;
            s.grantTapLx = null;
            s.grantTapLy = null;
            {
              const entries = Array.from(touches.current.values());
              if (entries.length === 1 && entries[0].lx != null && entries[0].ly != null) {
                s.grantTapLx = entries[0].lx;
                s.grantTapLy = entries[0].ly;
              }
            }
            const dist = pinchDistance();
            if (touches.current.size >= 2 && dist > 0) {
              s.baseDist = dist;
              s.baseScale = s.scale;
              s.pinching = true;
            }
            // NOTE: lastTapX/lastTapY/lastTapAt are intentionally NOT touched
            // here — tap pairing happens on release, using the stored
            // down-stroke (grantX/grantY) vs the previous released tap.
          } catch {
            /* a bad grant must never break the lightbox */
          }
        },

        onPanResponderMove: (event, gesture) => {
          try {
            const s = state.current;
            // Merge-only: a move frame that reports a single touch must NOT
            // shrink the map while the second finger is still down.
            mergeTouches(event);
            // The gesture owns the values now — a stale double-tap spring
            // completion must not overwrite this frame (Vivo flicker).
            gestureSeq.current += 1;
            animSeq.current = gestureSeq.current;
            const count = livePoints().length;
            // Any second finger joining, or movement past the tap slop,
            // kills the single-tap candidate — a slide is never a tap.
            if (count >= 2) s.grantTouchCount = Math.max(s.grantTouchCount, count);
            try {
              const mx = Number.isFinite(gesture.moveX) ? gesture.moveX : NaN;
              const my = Number.isFinite(gesture.moveY) ? gesture.moveY : NaN;
              if (Number.isFinite(mx) && Number.isFinite(my)) {
                const moved = Math.hypot(mx - s.grantX, my - s.grantY);
                if (Number.isFinite(moved) && moved > DOUBLE_TAP_SLOP_PX) {
                  s.movedPastSlop = true;
                }
              } else {
                const gd = Math.hypot(
                  Number.isFinite(gesture.dx) ? gesture.dx : 0,
                  Number.isFinite(gesture.dy) ? gesture.dy : 0,
                );
                if (Number.isFinite(gd) && gd > DOUBLE_TAP_SLOP_PX) {
                  s.movedPastSlop = true;
                }
              }
            } catch {
              /* tap candidacy unchanged */
            }
            if (count >= 2) {
              const dist = pinchDistance();
              if (!(dist > 0)) return;
              if (!s.pinching || !(s.baseDist > 0)) {
                s.baseDist = dist;
                s.baseScale = s.scale;
                s.pinching = true;
                // Seed the two-finger pan tracking so the first slide frame
                // has a valid previous centroid to diff against.
                const seed = pinchCentroid();
                if (seed) {
                  s.prevCentroidX = seed.x;
                  s.prevCentroidY = seed.y;
                  s.hasPrevCentroid = true;
                }
                // Seed per-finger positions for the direction check — reuse
                // the single per-frame pass (no fresh iteration/allocation).
                const seedPositions = new Map<number, { x: number; y: number }>();
                for (const [id, p] of touches.current) {
                  seedPositions.set(id, { x: p.x, y: p.y });
                }
                s.prevPositions = seedPositions;
                // Reset the single-finger pan baseline so that when one finger
                // lifts, pan doesn't jump by the gesture's accumulated delta.
                s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
                s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
                return;
              }
              // Continuous baseline: each frame measures from the previous
              // frame instead of from the gesture start. Combined with the
              // per-frame clamp below, one bad/spiky frame can only nudge the
              // zoom instead of restarting the whole pinch (the flicker).
              const frameRatio = dist / s.baseDist;
              if (!Number.isFinite(frameRatio) || frameRatio <= 0) return;
              // Direction check: per-finger movement vectors this frame.
              // Sliding both fingers left/right moves them the SAME way
              // (vectors agree) while a real pinch moves them OPPOSITE ways
              // (vectors disagree). When the fingers agree, this frame is a
              // two-finger PAN — follow the centroid and NEVER touch the zoom,
              // no matter what the distance number says (distance shrinks
              // spuriously while sliding due to per-finger position noise).
              let isTwoFingerPan = false;
              let slideDx = 0;
              let slideDy = 0;
              try {
                const prev = s.prevPositions;
                const curr = touches.current;
                if (prev && prev.size >= 2 && curr.size >= 2) {
                  const common: number[] = [];
                  for (const id of curr.keys()) {
                    if (prev.has(id)) common.push(id);
                  }
                  if (common.length >= 2) {
                    const v0 = (() => {
                      const c = curr.get(common[0])!;
                      const p = prev.get(common[0])!;
                      return { x: c.x - p.x, y: c.y - p.y };
                    })();
                    const v1 = (() => {
                      const c = curr.get(common[1])!;
                      const p = prev.get(common[1])!;
                      return { x: c.x - p.x, y: c.y - p.y };
                    })();
                    const m0 = Math.hypot(v0.x, v0.y);
                    const m1 = Math.hypot(v1.x, v1.y);
                    if (Number.isFinite(m0) && Number.isFinite(m1)) {
                      const minM = Math.min(m0, m1);
                      const maxM = Math.max(m0, m1);
                      // BOTH fingers must actually be moving: anchoring one
                      // finger while dragging the other IS a real pinch
                      // (distance-driven zoom), not a slide.
                      if (minM >= 1) {
                        // Cosine of the angle between the two movement vectors.
                        // ~+1 = same direction (slide), ~-1 = opposite (pinch).
                        const cos = (v0.x * v1.x + v0.y * v1.y) / Math.max(m0 * m1, 0.01);
                        if (Number.isFinite(cos) && cos > -0.25) {
                          isTwoFingerPan = true;
                          const focalSlide = pinchCentroid();
                          if (focalSlide) {
                            const px = Number.isFinite(s.prevCentroidX) ? s.prevCentroidX : focalSlide.x;
                            const py = Number.isFinite(s.prevCentroidY) ? s.prevCentroidY : focalSlide.y;
                            const ddx = focalSlide.x - px;
                            const ddy = focalSlide.y - py;
                            if (Number.isFinite(ddx)) slideDx = ddx;
                            if (Number.isFinite(ddy)) slideDy = ddy;
                          }
                        }
                      }
                    }
                  }
                }
              } catch {
                isTwoFingerPan = false;
              }
              if (isTwoFingerPan) {
                // Pure pan: move with the centroid, leave the zoom EXACTLY
                // alone, and re-sync the pinch baseline to today's distance
                // so no error can accumulate into a zoom-out.
                s.tx += slideDx;
                s.ty += slideDy;
                s.baseDist = dist;
                s.baseScale = s.scale;
                const focalSlide = pinchCentroid();
                if (focalSlide) {
                  s.prevCentroidX = focalSlide.x;
                  s.prevCentroidY = focalSlide.y;
                  s.hasPrevCentroid = true;
                }
                // Bounded snapshot (max two fingers) for the direction check.
                const snapshot = new Map<number, { x: number; y: number }>();
                let snapCount = 0;
                for (const [id, p] of touches.current) {
                  if (snapCount >= 2) break;
                  snapshot.set(id, { x: p.x, y: p.y });
                  snapCount += 1;
                }
                s.prevPositions = snapshot;
                s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
                s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
                clamp();
                apply();
                return;
              }
              const clampedRatio = Math.min(1.15, Math.max(1 / 1.15, frameRatio));
              const nextScale = s.scale * clampedRatio;
              if (!Number.isFinite(nextScale)) return;
              const focal = pinchCentroid();
              // Prefer the touches' own container-relative centroid (exact, no
              // origin math). Fall back to the gesture point only when the
              // events didn't carry locationX/locationY, else center.
              let local = { x: 0, y: 0 };
              if (focal && focal.lx != null && focal.ly != null) {
                const w = Number.isFinite(s.width) && s.width > 0 ? s.width : 0;
                const h = Number.isFinite(s.height) && s.height > 0 ? s.height : 0;
                local = { x: focal.lx - w / 2, y: focal.ly - h / 2 };
              } else if (focal) {
                local = toLocal(focal.x, focal.y);
              }
              // Clamp the focal offset to the container so a wildly misplaced
              // focal can never shove the photo off-screen into black.
              const halfW = (Number.isFinite(s.width) ? s.width : 0) / 2;
              const halfH = (Number.isFinite(s.height) ? s.height : 0) / 2;
              local.x = Math.min(halfW, Math.max(-halfW, local.x));
              local.y = Math.min(halfH, Math.max(-halfH, local.y));
              // Translate-before-scale order means screen pos = scale * p + t,
              // so to keep the focal point pinned under the fingers the pan
              // shifts by L * (oldScale - nextScale).
              const oldScale = s.scale;
              if (!Number.isFinite(oldScale) || oldScale <= 0) return;
              // Vivo guard: one bad frame (teleported finger from a dropped
              // Funtouch touch batch) must never double/halve the zoom in a
              // single step — that single-frame flash IS the flicker.
              const pinchRatioCheck = nextScale / Math.max(oldScale, 0.01);
              if (!Number.isFinite(pinchRatioCheck) || pinchRatioCheck > 1.5 || pinchRatioCheck < 1 / 1.5) {
                s.baseDist = dist;
                s.baseScale = s.scale;
                return;
              }
              s.scale = nextScale;
              s.tx += local.x * (oldScale - nextScale);
              s.ty += local.y * (oldScale - nextScale);
              // Advance the baseline so the next frame compounds smoothly.
              s.baseDist = dist;
              s.baseScale = s.scale;
              // Sync the two-finger pan tracking so a following slide frame
              // diffs from THIS centroid, not a stale one.
              if (focal) {
                s.prevCentroidX = focal.x;
                s.prevCentroidY = focal.y;
                s.hasPrevCentroid = true;
              }
              // Snapshot per-finger positions for next frame's direction check.
              // Bounded: at most the two tracked fingers, replaced (not
              // grown) every frame — no unbounded allocation.
              const afterZoom = new Map<number, { x: number; y: number }>();
              let snapped = 0;
              for (const [id, p] of touches.current) {
                if (snapped >= 2) break;
                afterZoom.set(id, { x: p.x, y: p.y });
                snapped += 1;
              }
              s.prevPositions = afterZoom;
              // Keep the pan baseline in sync during the pinch as well.
              s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
              s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
              clamp();
              apply();
              return;
            }
            // Pinch just ended (one finger lifted) but the touch map still
            // knows both points — drop to a single finger WITHOUT panning
            // this frame, and re-sync the pan baseline to today's gesture
            // delta so the next move frame doesn't jump.
            if (s.pinching) {
              s.pinching = false;
              s.baseDist = 0;
              s.hasPrevCentroid = false;
              s.prevPositions = null;
              s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
              s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
              clamp();
              apply();
              return;
            }
            // Single-finger drag pans only while zoomed in.
            if (s.scale > 1.02) {
              const dx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
              const dy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
              s.tx += dx - s.lastDx;
              s.ty += dy - s.lastDy;
              s.lastDx = dx;
              s.lastDy = dy;
              clamp();
              apply();
            }
          } catch {
            /* a bad move frame is skipped; the next frame recovers */
          }
        },

        onPanResponderRelease: (event, gesture) => {
          try {
            const s = state.current;
            s.pinching = false;
            s.baseDist = 0;
            s.hasPrevCentroid = false;
            s.prevPositions = null;
            removeEndedTouches(event);
            // Double-tap zoom fires ONLY here, on a clean release: the finger
            // went down and up quickly, never moved past the slop, and no
            // second finger ever joined this gesture. Fast flicks are checked
            // TWICE — the move-frame slop flag AND the final lift position —
            // so a slide that outruns its move events can never count as a tap.
            const heldMs = Date.now() - s.grantAt;
            let liftDist = NaN;
            try {
              const end = event?.nativeEvent as
                | { pageX?: unknown; pageY?: unknown; changedTouches?: unknown; touches?: unknown }
                | undefined;
              const fromChanged = collectTouches(end?.changedTouches)[0];
              const endX =
                fromChanged != null
                  ? fromChanged.x
                  : typeof end?.pageX === "number" && Number.isFinite(end.pageX)
                    ? end.pageX
                    : typeof gesture.moveX === "number" && Number.isFinite(gesture.moveX)
                      ? gesture.moveX
                      : NaN;
              const endY =
                fromChanged != null
                  ? fromChanged.y
                  : typeof end?.pageY === "number" && Number.isFinite(end.pageY)
                    ? end.pageY
                    : typeof gesture.moveY === "number" && Number.isFinite(gesture.moveY)
                      ? gesture.moveY
                      : NaN;
              if (Number.isFinite(endX) && Number.isFinite(endY)) {
                liftDist = Math.hypot(endX - s.grantX, endY - s.grantY);
              } else {
                const gd = Math.hypot(
                  Number.isFinite(gesture.dx) ? gesture.dx : 0,
                  Number.isFinite(gesture.dy) ? gesture.dy : 0,
                );
                if (Number.isFinite(gd)) liftDist = gd;
              }
            } catch {
              liftDist = NaN;
            }
            if (Number.isFinite(liftDist) && liftDist > DOUBLE_TAP_SLOP_PX) {
              s.movedPastSlop = true;
            }
            const isQuickTap =
              s.grantAt > 0 &&
              Number.isFinite(heldMs) &&
              heldMs >= 0 &&
              heldMs <= TAP_MAX_DURATION_MS &&
              !s.movedPastSlop &&
              s.grantTouchCount <= 1 &&
              touches.current.size === 0 &&
              // Final lift-position check: a fast flick's release point is far
              // from its down point even if its move frames were skipped.
              (!Number.isFinite(liftDist) || liftDist <= DOUBLE_TAP_SLOP_PX);
            s.grantAt = 0;
            s.grantTouchCount = 0;
            if (isQuickTap) {
              const now = Date.now();
              const tapDx = s.grantX - s.lastTapX;
              const tapDy = s.grantY - s.lastTapY;
              const tapDist = Math.hypot(tapDx, tapDy);
              if (
                s.lastTapAt > 0 &&
                now - s.lastTapAt < DOUBLE_TAP_DELAY_MS &&
                Number.isFinite(tapDist) &&
                tapDist < DOUBLE_TAP_SLOP_PX
              ) {
                // Second clean tap of the pair — toggle the zoom.
                // Direction comes from the animation TARGET (targetScale),
                // not the interrupted live value: rapid taps alternate
                // cleanly in -> out -> in instead of parking at a
                // half-zoomed state (the fast-tap hold bug).
                s.lastTapAt = 0;
                // Re-sync to the true on-screen value first, so the zoom-out
                // starts from the screen even if the zoom-in is mid-flight.
                syncLive();
                clamp();
                if (targetScale.current > 1.1) {
                  animateTo(1, 0, 0);
                  return;
                }
                // Focal from the down-stroke's own container-relative coords
                // (exact, synchronous — no page-origin race).
                let local = { x: 0, y: 0 };
                if (s.grantTapLx != null && s.grantTapLy != null) {
                  const w = Number.isFinite(s.width) && s.width > 0 ? s.width : 0;
                  const h = Number.isFinite(s.height) && s.height > 0 ? s.height : 0;
                  local = { x: s.grantTapLx - w / 2, y: s.grantTapLy - h / 2 };
                } else {
                  local = toLocalFromResponder(s.grantX, s.grantY);
                }
                const halfW = (Number.isFinite(s.width) ? s.width : 0) / 2;
                const halfH = (Number.isFinite(s.height) ? s.height : 0) / 2;
                local.x = Math.min(halfW, Math.max(-halfW, local.x));
                local.y = Math.min(halfH, Math.max(-halfH, local.y));
                const next = Math.min(MAX_SCALE, DOUBLE_TAP_ZOOM);
                const prevScale = Number.isFinite(s.scale) && s.scale > 0 ? s.scale : 1;
                s.scale = next;
                s.tx += local.x * (prevScale - next);
                s.ty += local.y * (prevScale - next);
                clamp();
                animateTo(s.scale, s.tx, s.ty);
                return;
              }
              // First clean tap of a possible pair — arm the window.
              s.lastTapAt = now;
              s.lastTapX = s.grantX;
              s.lastTapY = s.grantY;
            }
            clamp();
            if (s.scale <= 1.02) animateTo(1, 0, 0);
            else {
              // Live single-finger pan (no animation): keep the target mirror
              // honest so the next double-tap toggles from the true zoom.
              try { targetScale.current = s.scale; } catch {}
              apply();
            }
          } catch {
            /* non-fatal */
          }
        },
        onPanResponderTerminate: () => {
          try {
            const s = state.current;
            s.pinching = false;
            s.baseDist = 0;
            s.hasPrevCentroid = false;
            s.prevPositions = null;
            s.grantAt = 0;
            s.grantTouchCount = 0;
            s.movedPastSlop = false;
            touches.current = new Map();
            try { targetScale.current = s.scale; } catch {}
            clamp();
            apply();
          } catch {
            /* non-fatal */
          }
        },
      }),
    [],
  );

  // Refresh the container's page origin (async, guarded). Touch math uses
  // pageX/pageY, so a stale origin (e.g. after rotation or layout shift)
  // corrupts the focal point and can shove the photo off-screen.
  const refreshPageOrigin = () => {
    try {
      const node = viewRef.current as unknown as {
        measure?: (cb: (...args: number[]) => void) => void;
      } | null;
      node?.measure?.((_x, _y, _w, _h, pageX, pageY) => {
        if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
          pageOrigin.current = { x: pageX, y: pageY };
        }
      });
    } catch {
      /* keep the previous origin */
    }
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    try {
      const { width, height } = event.nativeEvent.layout;
      if (Number.isFinite(width) && Number.isFinite(height)) {
        state.current.width = width;
        state.current.height = height;
        // Async — the callback lands just after layout settles.
        refreshPageOrigin();
      }
    } catch {
      /* keep the previous layout */
    }
  };

  // Intrinsic bitmap size for the CONTAIN math above. Never throws; a missing
  // size just falls back to container-based clamping until it loads.
  const handleImageLoad = (event: { nativeEvent?: { source?: { width?: unknown; height?: unknown } } }) => {
    try {
      const src = event?.nativeEvent?.source;
      const iw = src && typeof src.width === "number" ? src.width : NaN;
      const ih = src && typeof src.height === "number" ? src.height : NaN;
      if (Number.isFinite(iw) && iw > 0 && Number.isFinite(ih) && ih > 0) {
        const s = state.current;
        s.imgW = iw;
        s.imgH = ih;
        clamp();
        apply();
      }
    } catch {
      /* keep the previous size */
    }
  };

  // Render outsourcing: Reanimated UI-thread image when available, classic
  // Animated image otherwise. The gesture math above never branches — both
  // paths are driven by zoom.setLive / zoom.animateTo / apply().
  const renderZoomImage = () => {
    if (ReanimatedView != null) {
      return (
        <ReanimatedView
          uri={uri}
          driverRef={driverRef}
          accessibilityLabel={accessibilityLabel}
          onLoad={handleImageLoad}
        />
      );
    }
    if (zoom.kind !== "animated") return null;
    return (
      <Animated.Image
        source={{ uri }}
        style={[
          localStyles.image,
          // Translate BEFORE scale so pan stays in screen pixels — the
          // focal-point math (pinch + double-tap) assumes this order.
          { transform: [{ translateX: zoom.panAnim.x }, { translateY: zoom.panAnim.y }, { scale: zoom.scaleAnim }] },
        ]}
        resizeMode="contain"
        onLoad={handleImageLoad}
        // Android-only GPU layer cache for the scaled bitmap (old Adreno/Mali
        // win); stripped on iOS/web. TS in this repo lacks the prop on the
        // Animated Image type, hence the expect-error.
        // @ts-expect-error: Android-only prop, stripped on iOS/web.
        renderToHardwareTextureAndroid
        // Decode the 12MP capture downscaled instead of at full size —
        // less texture memory + faster uploads on old GPUs.
        resizeMethod="scale"
        fadeDuration={0}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? "Zoomable photo preview. Pinch or double-tap to zoom."}
      />
    );
  };

  return (
    <View
      ref={viewRef}
      style={[localStyles.container, containerStyle]}
      onLayout={handleLayout}
      onTouchStart={(e) => mergeTouches(e)}
      onTouchMove={(e) => mergeTouches(e)}
      onTouchEnd={(e) => removeEndedTouches(e)}
      onTouchCancel={() => {
        touches.current = new Map();
      }}
      {...panResponder.panHandlers}
    >
      {renderZoomImage()}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});

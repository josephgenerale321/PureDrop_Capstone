import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { canUseReanimatedView, useZoomAnimation, ANIM_MS } from "./useZoomAnimation";
import type { ZoomablePhotoDriver } from "./ZoomablePhotoView";
import PinchZoomHint from "./PinchZoomHint";

// Zoom limits / double-tap tuning for the verification photo lightboxes.
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_ZOOM = 2.5;
// Double-tap pairing window (release-to-release). 450ms, not the textbook
// 300ms: Funtouch touch dispatch on Vivo eats 50-150ms between a finger-UP
// and the next DOWN, so a 300ms UP→UP window drops every other pair on fast
// repeats ("fine twice, stuck on the 4th tap"). 450ms still pairs only
// deliberate quick taps — a slow deliberate tap minutes later never pairs.
const DOUBLE_TAP_DELAY_MS = 450;
const DOUBLE_TAP_SLOP_PX = 24;
// A tap must be a quick down-up: anything held longer is a hold, not a tap.
const TAP_MAX_DURATION_MS = 400;

type ZoomablePhotoProps = {
  /** Remote or local image URI to display. */
  uri: string;
  accessibilityLabel?: string;
  containerStyle?: ViewStyle;
  /** Show the animated pinch-hint coach mark until first real zoom. */
  showPinchHint?: boolean;
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
export default function ZoomablePhoto({ uri, accessibilityLabel, containerStyle, showPinchHint = true }: ZoomablePhotoProps) {
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
  // Coach-mark visibility: shown until the first REAL zoom (pinch past the
  // dead-zone or a double-tap toggle), or until the hint's own timer/l loop
  // cap reports done. Never blocks touches (hint is pointerEvents="none").
  const [hintVisible, setHintVisible] = useState(showPinchHint);
  const hintDone = useRef(false);
  const dismissHint = () => {
    if (hintDone.current) return;
    hintDone.current = true;
    try {
      setHintVisible(false);
    } catch {
      /* non-fatal */
    }
  };
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
  // Tap-vs-double-tap snapshot refs. They exist ONLY as in-gesture guards:
  // - tapPending: snapshot taken at grant (down-stroke pos + PanResponder
  //   delta at that moment + touch count). A MOVE frame that drifts past the
  //   slop, or any touch-count change, clears it — so a slide/pinch can NEVER
  //   later replay as a double-tap toggle ("zoomed out by itself").
  // - tapTimer: reserved timeout handle for the tap-pairing window. Cleared
  //   on every new grant so a slow-to-fire timer from the PREVIOUS gesture
  //   can never arm a phantom double-tap window mid-new-gesture (identical
  //   timing on dev and preview builds since it is shared-JS logic).
  const tapPending = useRef<{
    dx0: number;
    dy0: number;
    count: number;
  } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // CONTAIN letterbox offsets ((container - rendered)/2), refreshed by
    // clamp() every frame: the focal math subtracts these so the pinch
    // point is measured from the BITMAP center, not the view center.
    letterX: 0,
    letterY: 0,
    // Previous frame's per-finger positions (identifier -> page coords), used
    // to tell a two-finger SLIDE apart from a real pinch by movement
    // DIRECTION (see the two-finger branch in onPanResponderMove).
    prevPositions: null as Map<number, { x: number; y: number }> | null,
    // Rolling pinch-distance smoother (exponential moving average) + the raw
    // baseline it is anchored to. Per-finger page coords arrive quantized to
    // whole px and each touch has independent 1-2px jitter: raw dist jumps
    // ±3-5px frame-to-frame, which used to zoom OUT during a pure two-finger
    // slide. The EMA absorbs that noise; only a sustained real spread/pinch
    // moves it enough to pass the zoom dead-zone below.
    smoothDist: 0,
    // Consecutive two-finger frames with a confident, non-degenerate pinch
    // direction pattern (both fingers moving clearly along the pinch axis,
    // in opposite directions). Slow but deliberate pinches build this up and
    // bypass the dead-zone; random slide jitter never sustains it.
    pinchStreak: 0,
    // Set whenever a pinch/multi-touch ends or releases: the NEXT single-finger
    // move frame must re-anchor its pan baseline instead of replaying a stale
    // gesture.dx left over from the ended two-finger gesture (the repeated
    // spread-at-max-zoom sideways slide).
    needsPanReanchor: false,
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
  // Proactively fetch the bitmap size too: on a dev-build reload the image
  // onLoad can arrive AFTER the first pinch frames, and until imgW/imgH are
  // known the clamp falls back to container size (too-loose vertically) —
  // the repeated-spread = slides-to-bottom report.
  useEffect(() => {
    let cancelled = false;
    try {
      Image.getSize(
        uri,
        (w, h) => {
          try {
            if (cancelled) return;
            if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
              const s = state.current;
              // Don't clobber a fresher onLoad size for the SAME uri.
              if (s.imgW <= 0 || s.imgH <= 0) {
                s.imgW = w;
                s.imgH = h;
                clamp();
                apply();
              }
            }
          } catch {
            /* keep the previous size */
          }
        },
        () => {
          /* ignore — onLoad remains the primary source */
        },
      );
    } catch {
      /* non-fatal — onLoad remains the primary source */
    }
    return () => {
      cancelled = true;
    };
  }, [uri]);
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
    // New photo = new intent: kill any tap-pairing window carried over from
    // the previous photo, or its single tap pairs with the new photo's first
    // tap into a phantom double-tap ("stuck" toggle on the first taps).
    try {
      const s = state.current;
      s.lastTapAt = 0;
    } catch {
      /* non-fatal */
    }
    try {
      tapPending.current = null;
    } catch {
      /* non-fatal */
    }
    if (tapTimer.current != null) {
      try {
        clearTimeout(tapTimer.current);
      } catch {
        /* non-fatal */
      }
      tapTimer.current = null;
    }
    // A fresh photo gets a fresh coach mark (if the caller wants hints).
    hintDone.current = false;
    try {
      setHintVisible(showPinchHint);
    } catch {
      /* non-fatal */
    }
    try {
      zoom.setLive(1, 0, 0);
    } catch {
      /* non-fatal — next gesture re-syncs the animated values */
    }
  }, [uri, zoom, showPinchHint]);

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
    // still covers the container on that axis. If the scaled photo is
    // SMALLER than the container (short landscape photo at ~1x in a tall
    // lightbox), travel on that axis locks to 0 — the photo stays centered
    // and can NEVER slide into the top/bottom black gap.
    const scaledW = w * s.scale;
    const scaledH = h * s.scale;
    const maxX = Math.max(0, (scaledW - cw) / 2);
    const maxY = Math.max(0, (scaledH - ch) / 2);
    s.tx = Math.min(maxX, Math.max(-maxX, s.tx));
    s.ty = Math.min(maxY, Math.max(-maxY, s.ty));
    // Letterbox offsets are kept for the double-tap focal path's records
    // but are NOT subtracted from the pinch focal: the transform pivots
    // around the VIEW center and location coords are view-relative, so the
    // focal must stay view-relative too (subtracting the offset is what
    // pushed repeated zoom-ins toward the bottom black).
    const offX = (cw - w) / 2;
    const offY = (ch - h) / 2;
    s.letterX = Number.isFinite(offX) ? offX : 0;
    s.letterY = Number.isFinite(offY) ? offY : 0;
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
      // Take a NEW ownership id FIRST and publish it before stopping: on Vivo
      // a syncLive() from the release/grant interleaved between stop and start
      // used to grab the same id and the stale timer below then dropped the
      // live values mid-flight (the 4th-tap "stuck" state). With a fresh id
      // claimed up-front, any stale completion self-drops.
      gestureSeq.current += 1;
      const id = gestureSeq.current;
      animSeq.current = id;
      s.scale = toScale;
      s.tx = toX;
      s.ty = toY;
      stopAnimations();
      animSeq.current = id;
      animating.current = true;
      // Publish the destination FIRST so a rapid follow-up tap toggles from
      // where we're headed (clean in -> out -> in), never from an
      // interrupted mid-flight value (half-zoom park / direction flip).
      targetScale.current = toScale;
      // UI-thread timing on Reanimated (smooth even with a busy JS thread);
      // JS-driven timing of identical duration/easing on the fallback.
      zoom.animateTo({ scale: toScale, tx: toX, ty: toY });
      // A completed double-tap zoom means the user got it — drop the hint.
      try {
        dismissHint();
      } catch {
        /* non-fatal */
      }
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
      // Retire synthetic seeds (negative ids) as soon as two REAL fingers
      // are tracked: from then on distance/centroid must use real data only.
      // Otherwise the first two map entries stay (finger1 + stale seed) and
      // the real second finger is ignored — the pinch would freeze.
      let real = 0;
      for (const id of touches.current.keys()) {
        if (id >= 0) {
          real += 1;
          if (real >= 2) break;
        }
      }
      if (real >= 2) {
        for (const id of Array.from(touches.current.keys())) {
          if (id < 0) touches.current.delete(id);
        }
      }
    } catch {
      /* keep the previous touch map */
    }
  };

  // Only an end frame removes touches, keyed by changedTouches (the fingers
  // that actually lifted) so a partial touch list can't wipe the pinch.
  // Synthetic seed points (negative ids, see grant/move) are dropped here
  // too — they only ever exist to bridge late second-finger events.
  const removeEndedTouches = (
    event: { nativeEvent?: { touches?: unknown; changedTouches?: unknown } } | null | undefined,
  ) => {
    try {
      const map = touches.current;
      // A real end frame always drops synthetic seeds first: by release time
      // the true touches are known, and a leftover seed would fake a second
      // finger on the NEXT gesture (phantom pinch / wrong count).
      for (const id of Array.from(map.keys())) {
        if (id < 0) map.delete(id);
      }
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
      // Same seed retirement as mergeTouches: two real fingers make the
      // synthetic bridge point obsolete.
      try {
        let real = 0;
        for (const id of map.keys()) {
          if (id >= 0) {
            real += 1;
            if (real >= 2) break;
          }
        }
        if (real >= 2) {
          for (const id of Array.from(map.keys())) {
            if (id < 0) map.delete(id);
          }
        }
      } catch {
        /* keep the map as-is */
      }
    } catch {
      /* keep the previous touch map */
    }
  };

  // Drop entries not refreshed recently. Vivo/Funtouch under load drops
  // touch-end frames, leaving a frozen "ghost finger" that corrupts the next
  // pinch distance (flicker).
  //
  // AUTHORITATIVE for count only at gesture EDGES (grant/start/end), where a
  // skin may report a partial list: grant takes the max with the responder
  // count, end removes by changedTouches. Mid-gesture (move frames) this
  // NEVER shrinks the map on its own — a move frame that lists a single
  // touch while two fingers are down must not delete the other finger,
  // otherwise count flaps 2→1, the baseline restarts every other frame, and
  // spread/pinch appears to do nothing.
  const STALE_TOUCH_MS = 350;
  // Reused across move frames — filled by livePointsInto, never allocated
  // per frame (old-phone GC win: a 120Hz touch stream used to allocate 2-3
  // arrays + a Map snapshot on EVERY frame).
  const liveScratch: Array<{ id: number; x: number; y: number; lx: number | null; ly: number | null }> = [];
  const livePointsInto = (
    out: Array<{ id: number; x: number; y: number; lx: number | null; ly: number | null }>,
    pruneStale: boolean,
  ) => {
    out.length = 0;
    const now = Date.now();
    try {
      for (const [id, p] of touches.current) {
        // Prune ONLY when explicitly asked (gesture edges + release paths).
        // Move frames pass false so a late second-finger event can never
        // wipe the first finger mid-pinch.
        if (pruneStale && Number.isFinite(p.t) && now - p.t > STALE_TOUCH_MS) {
          touches.current.delete(id);
          continue;
        }
        out.push({ id, x: p.x, y: p.y, lx: p.lx, ly: p.ly });
      }
      // Sort by STABLE touch identifier so every consumer (centroid, span,
      // per-finger direction) reads the same finger pairing no matter which
      // order the OS delivered the move batch in. OEM skins — notably Vivo
      // Funtouch — reorder batch entries across frames; without a stable
      // order the span/centroid teleport and a slide "zooms out by itself".
      // Sorting here (once per frame) covers pinch + slide + hold paths.
      if (out.length > 1) {
        out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
    } catch {
      /* use whatever we collected */
    }
    return out;
  };
  const livePoints = () => livePointsInto(liveScratch, false);

  const pinchDistance = (pts: Array<{ x: number; y: number }>) => {
    try {
      if (pts.length < 2) return 0;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const d = Math.hypot(dx, dy);
      return Number.isFinite(d) ? d : 0;
    } catch {
      return 0;
    }
  };

  const pinchCentroid = (pts: Array<{ x: number; y: number; lx: number | null; ly: number | null }>) => {
    try {
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
        // Capture phase too: inside a Modal + SafeAreaView the parent may
        // otherwise claim the gesture (esp. right after a reload, before
        // layout settles). Claim early so no opening frame is ever lost —
        // a one-shot spread delivers very few frames and losing the first
        // one means the whole gesture does nothing.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_e, gesture) => {
          try {
            return state.current.scale > 1.02 || gesture.numberActiveTouches >= 2;
          } catch {
            return false;
          }
        },
        // Once WE own the gesture, never give it back mid-pinch: on Vivo a
        // termination request arriving on the opening frame hands the rest
        // of the gesture to the Modal/SafeAreaView parent and the spread
        // silently dies (works after many tries only because a later grant
        // randomly wins the race).
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event, gesture) => {
          try {
            const s = state.current;
            s.lastDx = 0;
            s.lastDy = 0;
            s.baseDist = 0;
            s.pinching = false;
            s.smoothDist = 0;
            s.pinchStreak = 0;
            // New contact kills the double-tap timeout: without this, a
            // slow-to-fire tap timer from the PREVIOUS gesture can expire
            // mid-new-gesture and arm a phantom double-tap window — the next
            // quick touch then reads as a double-tap toggle and the photo
            // "randomly zooms out / sticks". Shared-JS guard: identical on
            // dev and preview builds.
            if (tapTimer.current != null) {
              try {
                clearTimeout(tapTimer.current);
              } catch {
                /* non-fatal */
              }
              tapTimer.current = null;
            }
            // Same for an in-flight tap-vs-double-tap snapshot window.
            tapPending.current = null;
            // New contact: the pan baseline is already zeroed above, so there
            // is no stale dx to replay — clear the re-anchor flag here.
            s.needsPanReanchor = false;
            // New gesture takes over: stop the double-tap spring (if any) and
            // invalidate its completion, otherwise the spring keeps writing
            // the old zoom under the new fingers — the Vivo flicker.
            // Also clear the map FIRST so a ghost finger from a dropped
            // touch-end can't corrupt this gesture's pinch distance.
            // Stop the DRIVER-level animation too (Reanimated worklet or
            // Animated timing): without this the spring keeps writing values
            // while the new gesture reads them — the zoom "sticks" mid-value
            // and a fast follow-up double-tap then toggles from a stale
            // target, so it zooms OUT (or nowhere) instead of in.
            try {
              zoom.stop();
            } catch {
              /* non-fatal: driver may be mid-teardown */
            }
            syncLive();
            animating.current = false;
            touches.current = new Map();
            mergeTouches(event);
            // Edge-authoritative count: the responder's numberActiveTouches
            // is the backstop when the skin reports a partial touch list on
            // grant. Seed a SYNTHETIC second point from the gesture when the
            // map only learned one finger — without it the first spread
            // frames see count=1, run the single-finger pan path, and the
            // pinch "never starts" (the reported spread-does-nothing bug).
            // The synthetic point is replaced by the real touch as soon as
            // its events arrive (same-spot merge = zero distance change).
            try {
              const responderCount = Number.isFinite(gesture.numberActiveTouches)
                ? (gesture.numberActiveTouches as number)
                : 0;
              if (responderCount >= 2 && touches.current.size < 2) {
                const entries = Array.from(touches.current.values());
                const anchor = entries[entries.length - 1];
                if (anchor) {
                  const gx = Number.isFinite(gesture.x0) ? (gesture.x0 as number) : anchor.x;
                  const gy = Number.isFinite(gesture.y0) ? (gesture.y0 as number) : anchor.y;
                  let synthId = -1;
                  while (touches.current.has(synthId)) synthId -= 1;
                  touches.current.set(synthId, {
                    x: gx,
                    y: gy,
                    lx: anchor.lx,
                    ly: anchor.ly,
                    t: Date.now(),
                  });
                }
              }
            } catch {
              /* map keeps whatever mergeTouches learned */
            }
            // The page origin can be stale on the very first gesture (measure
            // is async), so re-sync it here — a wrong origin corrupts the
            // focal point and flings the photo off-screen into black.
            refreshPageOrigin();
            // Start a single-tap candidate: confirmed or discarded on release.
            s.grantAt = Date.now();
            s.grantX = Number.isFinite(gesture.x0) ? gesture.x0 : 0;
            s.grantY = Number.isFinite(gesture.y0) ? gesture.y0 : 0;
            // Grant count takes the max with the responder count for the same
            // late-second-finger reason — otherwise a pinch that starts on
            // this grant is misclassified as a tap candidate.
            s.grantTouchCount = touches.current.size;
            try {
              const gtc = Number.isFinite(gesture.numberActiveTouches)
                ? (gesture.numberActiveTouches as number)
                : 0;
              if (gtc > s.grantTouchCount) s.grantTouchCount = gtc;
            } catch {
              /* keep the map count */
            }
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
            // Arm the tap snapshot for THIS grant: dx/dy are 0 here (fresh
            // gesture), count is the max'd grant count above. Any move past
            // the slop, or any touch-count change, clears it — so the release
            // path can trust it as "this gesture never moved / never grew a
            // second finger". The release ALSO re-checks lift position, so a
            // fast flick that outruns its move frames still can't count.
            try {
              tapPending.current = {
                dx0: 0,
                dy0: 0,
                count: s.grantTouchCount,
              };
            } catch {
              tapPending.current = null;
            }
            const dist = pinchDistance(livePointsInto(liveScratch, false));
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
            // Responder count is the backstop for the raw touch map: on
            // skins where the second finger's touch event arrives late, the
            // map still shows 1 while numberActiveTouches is already 2.
            // Carry a SYNTHETIC second point (seeded at grant) forward with
            // the gesture position so the pinch path runs from the first
            // spread frame instead of panning-then-jumping.
            try {
              const responderCount = Number.isFinite(gesture.numberActiveTouches)
                ? (gesture.numberActiveTouches as number)
                : 0;
              if (responderCount >= 2 && touches.current.size < 2) {
                const entries = Array.from(touches.current.values());
                const anchor = entries[entries.length - 1];
                if (anchor) {
                  const gx = Number.isFinite(gesture.moveX)
                    ? (gesture.moveX as number)
                    : Number.isFinite(gesture.x0)
                      ? (gesture.x0 as number)
                      : anchor.x;
                  const gy = Number.isFinite(gesture.moveY)
                    ? (gesture.moveY as number)
                    : Number.isFinite(gesture.y0)
                      ? (gesture.y0 as number)
                      : anchor.y;
                  let synthId = -1;
                  while (touches.current.has(synthId)) synthId -= 1;
                  touches.current.set(synthId, {
                    x: gx,
                    y: gy,
                    lx: anchor.lx,
                    ly: anchor.ly,
                    t: Date.now(),
                  });
                }
              }
            } catch {
              /* map keeps whatever mergeTouches learned */
            }
            // The gesture owns the values now — a stale double-tap spring
            // completion must not overwrite this frame (Vivo flicker).
            gestureSeq.current += 1;
            animSeq.current = gestureSeq.current;
            const count = livePoints().length;
            // Any second finger joining, or movement past the tap slop,
            // kills the single-tap candidate — a slide is never a tap.
            // Count takes the max with the responder count (same late-event
            // reason as the grant seed): the move frame that carries the
            // second finger must already count as 2.
            let effCount = count;
            try {
              const rc = Number.isFinite(gesture.numberActiveTouches)
                ? (gesture.numberActiveTouches as number)
                : 0;
              if (rc > effCount) effCount = rc;
            } catch {
              /* keep the map count */
            }
            if (effCount >= 2) s.grantTouchCount = Math.max(s.grantTouchCount, effCount);
            // Tap-slop tracking: any movement past the slop kills the
            // single-tap candidate — a slide is never a tap.
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
            if (effCount >= 2) {
              // ONE shared pass per frame: every consumer below (distance,
              // baseline seed, direction check, centroid) reads framePts.
              // Previously each helper re-iterated the map with a fresh
              // array — 120Hz touch streams paid that 2-3x per frame.
              const framePts = livePointsInto(liveScratch, false);
              const dist = pinchDistance(framePts);
              if (!(dist > 0)) return;
              if (!s.pinching || !(s.baseDist > 0)) {
                // FIRST two-finger frame seeds the baseline AND applies this
                // frame's ratio immediately. Previously it returned without
                // zooming, so a one-shot spread (a single quick move frame)
                // did nothing — only repeated spreads accumulated enough
                // later frames to move. Now one spread = one zoom.
                const prevBase = s.baseDist > 0 ? s.baseDist : dist;
                s.baseDist = dist;
                s.smoothDist = dist;
                s.baseScale = s.scale;
                s.pinching = true;
                s.pinchStreak = 0;
                // The gesture is two fingers now: any pending 1-finger tap
                // snapshot is dead — a tap that grows a second finger is not a
                // tap. Without this, spread → lift → quick tap replays the
                // stale snapshot as a double-tap toggle and the photo "zooms
                // out by itself".
                tapPending.current = null;
                // Seed the two-finger pan tracking so the first slide frame
                // has a valid previous centroid to diff against.
                const seed = pinchCentroid(framePts);
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
                // Apply THIS frame's spread right away (same clamped-ratio +
                // focal math as the steady path): baseline kept across frames
                // of one pinch vs today's distance. Fresh pinch (no baseline
                // yet): prevBase == dist so ratio is 1 — nothing jumps, later
                // frames zoom normally. Continuing pinch (baseline from an
                // earlier frame): a one-shot spread applies immediately.
                const seedFrameRatio = prevBase > 0 ? dist / prevBase : 1;
                if (Number.isFinite(seedFrameRatio) && seedFrameRatio > 0 && seedFrameRatio !== 1) {
                  const seedClamped = Math.min(1.15, Math.max(1 / 1.15, seedFrameRatio));
                  const seedRaw = s.scale * seedClamped;
                  if (Number.isFinite(seedRaw)) {
                    const seedFocal = pinchCentroid(framePts);
                    let seedLocal = { x: 0, y: 0 };
                    if (seedFocal && seedFocal.lx != null && seedFocal.ly != null) {
                      const ssw = Number.isFinite(s.width) && s.width > 0 ? s.width : 0;
                      const ssh = Number.isFinite(s.height) && s.height > 0 ? s.height : 0;
                      seedLocal = { x: seedFocal.lx - ssw / 2, y: seedFocal.ly - ssh / 2 };
                    } else if (seedFocal) {
                      seedLocal = toLocal(seedFocal.x, seedFocal.y);
                    }
                    const shw = (Number.isFinite(s.width) ? s.width : 0) / 2;
                    const shh = (Number.isFinite(s.height) ? s.height : 0) / 2;
                    seedLocal.x = Math.min(shw, Math.max(-shw, seedLocal.x));
                    seedLocal.y = Math.min(shh, Math.max(-shh, seedLocal.y));
                    const seedOld = s.scale;
                    if (Number.isFinite(seedOld) && seedOld > 0) {
                      // Clamp BEFORE the focal shift (same at-limit rule as the
                      // steady path): a spread at MAX (or pinch at MIN) zoom
                      // holds position instead of walking the image sideways.
                      const seedNext = Math.min(MAX_SCALE, Math.max(MIN_SCALE, seedRaw));
                      const seedCheck = seedNext / Math.max(seedOld, 0.01);
                      if (Number.isFinite(seedCheck) && seedCheck <= 1.5 && seedCheck >= 1 / 1.5) {
                        if (seedNext !== seedOld) {
                          s.scale = seedNext;
                          s.tx += seedLocal.x * (seedOld - seedNext);
                          s.ty += seedLocal.y * (seedOld - seedNext);
                          // Same target lockstep as the steady path (see below).
                          try {
                            targetScale.current = seedNext;
                          } catch {
                            /* non-fatal */
                          }
                        }
                        s.baseScale = s.scale;
                        if (seedFocal) {
                          s.prevCentroidX = seedFocal.x;
                          s.prevCentroidY = seedFocal.y;
                          s.hasPrevCentroid = true;
                        }
                        if (Math.abs(seedNext - 1) > 0.02 && seedNext !== seedOld) {
                          try {
                            dismissHint();
                          } catch {
                            /* non-fatal */
                          }
                        }
                        clamp();
                        apply();
                        return;
                      }
                    }
                  }
                }
                // Reset the single-finger pan baseline so that when one finger
                // lifts, pan doesn't jump by the gesture's accumulated delta.
                s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
                s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
                return;
              }
              // Smoothed-span baseline: page coords arrive quantized to whole px
              // with 1-2px of independent jitter per finger, so the RAW span
              // jumps ±3-5px frame-to-frame — that used to read as a zoom-OUT
              // during a pure two-finger slide. The EMA absorbs the jitter;
              // the ratio is measured against the last DECISION baseline (hold
              // frames below deliberately do NOT advance it), so a slow
              // sustained spread/pinch still accumulates past the dead-zone
              // while jitter averages to ~zero. One bad/spiky frame can only
              // nudge the zoom instead of restarting the pinch (the flicker).
              // Shared-JS filter: identical on dev and preview builds.
              const prevSmooth = s.smoothDist > 0 ? s.smoothDist : s.baseDist;
              const smoothDist = prevSmooth + 0.5 * (dist - prevSmooth);
              if (!Number.isFinite(smoothDist) || smoothDist <= 0) return;
              s.smoothDist = smoothDist;
              const frameRatio = smoothDist / s.baseDist;
              if (!Number.isFinite(frameRatio) || frameRatio <= 0) return;
              // Direction check: per-finger movement vectors this frame.
              // Sliding both fingers left/right moves them the SAME way
              // (vectors agree) while a real pinch moves them OPPOSITE ways
              // (vectors disagree). When the fingers agree, this frame is a
              // two-finger PAN — follow the centroid and NEVER touch the zoom,
              // no matter what the distance number says (distance shrinks
              // spuriously while sliding due to per-finger position noise).
              let isTwoFingerPan = false;
              let pinchConfident = false;
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
                    // Positions come from the SHARED frame pass (framePts in
                    // map order) — never a second livePoints() call, which
                    // used to re-iterate mid-frame and could disagree.
                    const currIds = Array.from(curr.keys());
                    const posOf = (id: number) => {
                      const idx = currIds.indexOf(id);
                      if (idx >= 0 && idx < framePts.length) return framePts[idx];
                      return curr.get(id);
                    };
                    const c0 = posOf(common[0]);
                    const p0 = prev.get(common[0]);
                    const c1 = posOf(common[1]);
                    const p1 = prev.get(common[1]);
                    if (c0 == null || p0 == null || c1 == null || p1 == null) {
                      throw new Error("skip-frame");
                    }
                    const v0 = { x: c0.x - p0.x, y: c0.y - p0.y };
                    const v1 = { x: c1.x - p1.x, y: c1.y - p1.y };
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
                        // Confident opposite motion (both fingers clearly moving
                        // apart/together along the pinch axis) marks a DELIBERATE
                        // pinch — even a slow one — so it can bypass the zoom
                        // dead-zone below. Slide jitter never sustains this.
                        if (minM >= 2 && Number.isFinite(cos) && cos < -0.4) {
                          pinchConfident = true;
                        }
                        if (Number.isFinite(cos) && cos > -0.25) {
                          isTwoFingerPan = true;
                          const focalSlide = pinchCentroid(framePts);
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
                pinchConfident = false;
              }
              // Pinch streak: a confident opposite-direction frame extends it,
              // anything else breaks it. Two confident frames in a row = a real
              // deliberate pinch, even if slow (bypasses the dead-zone below).
              s.pinchStreak = pinchConfident ? s.pinchStreak + 1 : 0;
              const sustainedPinch = pinchConfident && s.pinchStreak >= 2;
              if (isTwoFingerPan && !sustainedPinch) {
                // Pure pan: move with the centroid, leave the zoom EXACTLY
                // alone, and re-sync the pinch baseline to today's distance
                // so no error can accumulate into a zoom-out.
                s.tx += slideDx;
                s.ty += slideDy;
                s.baseDist = dist;
                s.baseScale = s.scale;
                // Slide decision: resync the smoother too, and drop the pinch
                // streak — a later pinch starts accumulating from here.
                s.pinchStreak = 0;
                s.smoothDist = dist;
                const focalSlide = pinchCentroid(framePts);
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
              // Zoom dead-zone on the SMOOTHED span: per-finger quantization +
              // jitter moves dist by ~±3-5px with no real zoom intent, which
              // used to read as zoom-OUT mid-slide. Below ~6px of smoothed
              // movement the frame HOLDs: pan follows the centroid, zoom stays
              // EXACTLY put, and the baseline is deliberately NOT advanced so
              // a slow real pinch still accumulates past the zone. A sustained
              // confident pinch (see streak above) bypasses the zone so slow
              // deliberate zooms stay responsive.
              const smoothDeltaPx = Math.abs(smoothDist - s.baseDist);
              if (!sustainedPinch && smoothDeltaPx < 6) {
                // Jitter-scale HOLD: follow the centroid (so the slide still
                // tracks the fingers), leave zoom EXACTLY put, and resync the
                // smoother to the raw span so a held slide can't drift it.
                // The decision baseline is NOT advanced: a slow real pinch
                // keeps accumulating and zooms once it clears the zone.
                const holdCentroid = pinchCentroid(framePts);
                if (holdCentroid && s.hasPrevCentroid) {
                  const hdx = holdCentroid.x - s.prevCentroidX;
                  const hdy = holdCentroid.y - s.prevCentroidY;
                  if (Number.isFinite(hdx)) s.tx += hdx;
                  if (Number.isFinite(hdy)) s.ty += hdy;
                }
                if (holdCentroid) {
                  s.prevCentroidX = holdCentroid.x;
                  s.prevCentroidY = holdCentroid.y;
                  s.hasPrevCentroid = true;
                }
                s.smoothDist = dist;
                s.baseScale = s.scale;
                const holdSnap = new Map<number, { x: number; y: number }>();
                let holdCount = 0;
                for (const [id, p] of touches.current) {
                  if (holdCount >= 2) break;
                  holdSnap.set(id, { x: p.x, y: p.y });
                  holdCount += 1;
                }
                s.prevPositions = holdSnap;
                s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
                s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
                clamp();
                apply();
                return;
              }
              const clampedRatio = Math.min(1.15, Math.max(1 / 1.15, frameRatio));
              const rawNextScale = s.scale * clampedRatio;
              if (!Number.isFinite(rawNextScale)) return;
              const focal = pinchCentroid(framePts);
              // Focal is VIEW-relative (location coords minus view center) —
              // matching the transform, which pivots around the VIEW center.
              // (A previous revision subtracted the CONTAIN letterbox offset
              // here; that double-counts the centering and pushes repeated
              // zoom-ins toward the bottom black — the reported slide bug.)
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
              // Clamp BEFORE computing the focal shift: at MIN/MAX zoom a further
              // spread/pinch must not translate the photo at all. (Previously the
              // shift was applied with the unclamped scale and only clamped
              // afterwards — pan bounds then leaked the leftovers, so repeating
              // spread at max zoom walked the image left/right.)
              const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawNextScale));
              // Vivo guard: one bad frame (teleported finger from a dropped
              // Funtouch touch batch) must never double/halve the zoom in a
              // single step — that single-frame flash IS the flicker.
              const pinchRatioCheck = nextScale / Math.max(oldScale, 0.01);
              if (!Number.isFinite(pinchRatioCheck) || pinchRatioCheck > 1.5 || pinchRatioCheck < 1 / 1.5) {
                s.baseDist = dist;
                s.smoothDist = dist;
                s.baseScale = s.scale;
                return;
              }
              // At a zoom limit with no room left to move, hold the transform
              // (but still advance the baselines so the next frame stays in
              // sync and no error accumulates into a slide).
              if (nextScale === oldScale) {
                s.baseDist = dist;
                s.smoothDist = dist;
                s.baseScale = s.scale;
                // Held AT the limit: scale didn't move, but the stale toggle
                // target might still say otherwise — re-sync it so the next
                // double-tap reads the truth.
                try {
                  targetScale.current = oldScale;
                } catch {
                  /* non-fatal */
                }
                if (focal) {
                  s.prevCentroidX = focal.x;
                  s.prevCentroidY = focal.y;
                  s.hasPrevCentroid = true;
                }
                const held = new Map<number, { x: number; y: number }>();
                let heldCount = 0;
                for (const [id, p] of touches.current) {
                  if (heldCount >= 2) break;
                  held.set(id, { x: p.x, y: p.y });
                  heldCount += 1;
                }
                s.prevPositions = held;
                s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
                s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
                clamp();
                apply();
                return;
              }
              s.scale = nextScale;
              s.tx += local.x * (oldScale - nextScale);
              s.ty += local.y * (oldScale - nextScale);
              // Keep the toggle TARGET in lockstep with pinch zoom: the
              // double-tap direction is read from targetScale, so a pinch
              // that never publishes leaves a stale target and the next
              // double-tap zooms the WRONG way (or appears stuck).
              try {
                targetScale.current = nextScale;
              } catch {
                /* non-fatal */
              }
              // Advance the baseline so the next frame compounds smoothly.
              // Baselines include the smoother so the EMA stays anchored to the
              // last DECISION (slide/hold/zoom) rather than drifting.
              s.baseDist = dist;
              s.smoothDist = dist;
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
              // First real pinch-zoom past ~1x: the user got it — drop hint.
              if (Math.abs(nextScale - 1) > 0.02) {
                try {
                  dismissHint();
                } catch {
                  /* non-fatal */
                }
              }
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
              s.smoothDist = 0;
              s.pinchStreak = 0;
              s.hasPrevCentroid = false;
              s.prevPositions = null;
              s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
              s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
              // Next single-finger move re-anchors instead of replaying the
              // ended two-finger gesture's leftover dx (the sideways slide).
              s.needsPanReanchor = true;
              clamp();
              apply();
              return;
            }
            // Single-finger drag pans only while zoomed in. At ~1x a one-finger
            // move is NOTHING (not a tap — real taps lift without moving): it
            // clears the tap snapshot AND the stale last-tap window, so a
            // one-finger drag can never later pair as a phantom double-tap.
            // This is the "[spread -> start*start -> finger]" case: after a
            // spread, the finger resting/sliding on the glass must not arm a
            // tap that the NEXT quick touch completes into a stuck zoom-out.
            if (s.scale <= 1.02) {
              if (tapPending.current) tapPending.current = null;
              s.lastTapAt = 0;
              s.lastDx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
              s.lastDy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
            }
            if (s.scale > 1.02) {
              const dx = Number.isFinite(gesture.dx) ? gesture.dx : 0;
              const dy = Number.isFinite(gesture.dy) ? gesture.dy : 0;
              // Any real MOVE cancels a pending tap-vs-double-tap snapshot window:
              // a finger that moved is panning, not tapping — otherwise the
              // LATER release replays a stale double-tap toggle ("zoomed out by
              // itself" after slide → lift → quick tap, or stuck-zoom after fast
              // repeat taps). A touch-count change cancels it too: the second
              // finger joining/leaving means this was never a clean 1-finger tap.
              if (tapPending.current) {
                const pending = tapPending.current;
                const movedPx = Math.hypot(dx - pending.dx0, dy - pending.dy0);
                if (
                  !Number.isFinite(movedPx) ||
                  movedPx > DOUBLE_TAP_SLOP_PX ||
                  !Number.isFinite(gesture.numberActiveTouches) ||
                  gesture.numberActiveTouches !== pending.count
                ) {
                  tapPending.current = null;
                }
              }
              // Fresh single-finger contact after a pinch/release: re-anchor the
              // baseline FIRST so a leftover dx from the ended two-finger gesture
              // can never replay as a jump/slide. Shared-JS guard, so dev and
              // preview builds behave the same.
              if (s.needsPanReanchor) {
                s.needsPanReanchor = false;
                s.lastDx = dx;
                s.lastDy = dy;
                // Re-anchoring also re-arms the tap snapshot to THIS frame's
                // baseline: the leftover two-finger dx must not count as tap
                // movement on the release check below.
                try {
                  tapPending.current = {
                    dx0: dx,
                    dy0: dy,
                    count: Number.isFinite(gesture.numberActiveTouches)
                      ? (gesture.numberActiveTouches as number)
                      : 1,
                  };
                } catch {
                  tapPending.current = null;
                }
                clamp();
                apply();
                return;
              }
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
            s.smoothDist = 0;
            s.pinchStreak = 0;
            s.hasPrevCentroid = false;
            s.prevPositions = null;
            // Any finger still down after this release starts fresh: the next
            // move re-anchors its pan baseline (same sideways-slide guard as
            // the pinch-end path above).
            s.needsPanReanchor = true;
            // Vivo coalesces rapid UP events: changedTouches may list only one
            // of two lifted fingers (or none), leaving a ghost entry that fails
            // the size===0 tap check on every later release ("double-tap
            // permanently stuck"). The responder's own count is authoritative —
            // zero active touches means every finger is up, so drop the map.
            try {
              const active = Number.isFinite(gesture.numberActiveTouches)
                ? (gesture.numberActiveTouches as number)
                : -1;
              if (active === 0) touches.current.clear();
            } catch {
              /* keep the map */
            }
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
              // Snapshot check: the tap snapshot must have SURVIVED the whole
              // gesture — i.e. no move frame ever drifted past the slop and
              // no second finger ever joined/left. This kills the stale replay
              // where a slide/pinch's release pairs with the NEXT quick tap as
              // a phantom double-tap ("zoomed out by itself" / stuck zoom).
              tapPending.current != null &&
              // Final lift-position check: a fast flick's release point is far
              // from its down point even if its move frames were skipped.
              (!Number.isFinite(liftDist) || liftDist <= DOUBLE_TAP_SLOP_PX);
            // Snapshot is single-use: consume it on every release so a tap can
            // never pair twice (the fast-repeat-tap stuck bug).
            tapPending.current = null;
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
                now - s.lastTapAt >= 0 &&
                Number.isFinite(tapDist) &&
                tapDist < DOUBLE_TAP_SLOP_PX
              ) {
                // Second clean tap of the pair — toggle the zoom.
                // Direction comes from the animation TARGET (targetScale),
                // not the interrupted live value: rapid taps alternate
                // cleanly in -> out -> in instead of parking at a
                // half-zoomed state (the fast-tap hold bug). The target is
                // stopped + synced FIRST so the new spring starts from the
                // true on-screen value — otherwise a mid-flight toggle
                // "sticks" and the next fast tap reads a stale target and
                // zooms OUT (or nowhere) instead of in.
                s.lastTapAt = 0;
                // Re-sync to the true on-screen value first, so the zoom-out
                // starts from the screen even if the zoom-in is mid-flight.
                // NOTE: no zoom.stop() here — syncLive() already owns the
                // handoff (capture-live + bump gestureSeq + stale-drop), and
                // animateTo() claims its own fresh id. Stopping twice used to
                // let a release/grant interleave grab the id and drop the
                // live values mid-flight (the 4th-repeat-tap "stuck").
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
              // A previous tap can ONLY pair with the tapPending snapshot flow:
              // arming here uses down-stroke coords validated on release, and
              // the move-frame + grant-time guards above already killed any
              // stale snapshot from a pinch/slide — so a spread-then-tap can
              // never pair as a phantom double-tap ("zoomed out by itself").
              s.lastTapAt = now;
              s.lastTapX = s.grantX;
              s.lastTapY = s.grantY;
            } else {
              // Not a tap at all (moved / held / multi-touch / slow release):
              // the old tap window is dead. Without this a slide's stale
              // first-tap arms a phantom pair and the NEXT quick tap toggles
              // zoom out of nowhere (the "sometimes it zoomed out" bug).
              s.lastTapAt = 0;
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
            s.smoothDist = 0;
            s.pinchStreak = 0;
            s.hasPrevCentroid = false;
            s.prevPositions = null;
            s.grantAt = 0;
            s.grantTouchCount = 0;
            s.movedPastSlop = false;
            // Terminated mid-gesture: kill any tap pairing too — the finger
            // never lifted cleanly, so it must never count as a tap later.
            s.lastTapAt = 0;
            s.needsPanReanchor = true;
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
      {hintVisible && <PinchZoomHint visible={hintVisible} onDone={dismissHint} />}
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

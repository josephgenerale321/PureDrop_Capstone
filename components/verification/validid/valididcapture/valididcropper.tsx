import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type PanResponderInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
// Legacy subpath — same convention as the capture flow (SDK 54 deprecates the
// root import). Used only to clean up the normalized intermediate file.
import * as FileSystem from "expo-file-system/legacy";
// Type-only import — erased at build time, so bundling/evaluating this screen
// never touches the native module. The runtime import happens lazily inside
// handleConfirmCrop (a top-level import would throw at route-load time on
// dev-client builds that predate expo-image-manipulator, crashing the whole
// capture screen before the camera even opens).
import type { ImageRef } from "expo-image-manipulator";
import {
  activeTouchCount,
  createZoomGestures,
  effectiveRect,
  IDENTITY_ZOOM,
  type ZoomState,
} from "./valididzoom";

// CR80 ID card ratio (85.6mm x 54mm) — same ratio as the capture guide frame,
// so confirming the centered default crop reproduces the framed document.
export const CROP_ASPECT = 1.586;
// The crop frame starts at this fraction of the visible photo's edges.
const INITIAL_SIZE_FRACTION = 0.86;
// Smallest allowed crop frame width (screen points).
export const MIN_CROP_WIDTH = 64;
// Drag distance (points) before a touch starts moving the frame, so taps
// never nudge it.
export const MOVE_THRESHOLD = 2;

/** Crop rectangle in screen points (crop canvas coordinates). */
export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The letterboxed ("contain") photo rect inside the crop canvas — the bridge
 * between screen points and image pixels.
 */
export type DisplayedRect = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  scale: number;
};

export type ValidIdCropperProps = {
  /** URI of the freshly captured photo (local temp file). */
  photoUri: string;
  /** Human label of the side being cropped, e.g. "Front of your ID". */
  sideLabel: string;
  /** Called with the cropped file's URI when the user confirms. */
  onConfirm: (croppedUri: string) => void;
  /** Called when the user backs out — the caller discards the capture. */
  onCancel: () => void;
  /**
   * Size of the live camera view the on-screen ID guide was drawn over, in
   * points. Omitted when the cropper is entered without one (deep link).
   */
  viewWidth?: number;
  /** @see viewWidth */
  viewHeight?: number;
  /**
   * The capture screen's guide rectangle, measured in the same point space as
   * viewWidth/viewHeight. When supplied together with the view size, the cropper
   * opens on exactly the region the guide described instead of guessing.
   */
  guideRect?: GuideRect | null;
};

/** A rectangle in view/screen points. */
export type GuideRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Maps the capture screen's on-screen ID guide back onto the captured photo.
 *
 * WHY THIS IS NEEDED
 * The live preview is centre-cropped to the view — vision-camera's Android
 * default `resizeMode` is COVER (HybridPreviewView.kt), so a tall view shows
 * only a horizontal slice of the 3:4 sensor frame. The rectangle the user
 * lined the card up against is therefore NOT "86% of the photo": on a 9:19.5
 * view it maps to roughly HALF the photo's width. Opening the cropper on a
 * fixed 86% frame made the capture screen lie about what would be cropped, so
 * every capture had to be re-framed by hand.
 *
 * This inverts that cover transform, giving the guide's true rectangle in photo
 * pixels. The capture screen is then WYSIWYG, and the frame still matches the
 * ID-card aspect the guide advertises.
 *
 * Returns null when any dimension is unusable (caller falls back to the
 * centered default).
 */
export function guideRectInPhoto(
  view: { width: number; height: number },
  guide: GuideRect,
  photo: { width: number; height: number },
): CropRect | null {
  if (
    !(view.width > 0) ||
    !(view.height > 0) ||
    !(photo.width > 0) ||
    !(photo.height > 0) ||
    !(guide.width > 0) ||
    !(guide.height > 0)
  ) {
    return null;
  }
  // Identical fit to the preview's: scale so the photo fills the view and
  // overflows (is cropped) on the non-matching axis.
  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  // A "cover" fit CENTRES the scaled photo in the view, so it overflows by an
  // equal amount on both sides of whichever axis overflows. This offset is what
  // turns a view-space rectangle into a photo-space one. Omitting it displaces
  // the frame by half the overflow: on a tall 9:19.5 phone the photo overflows
  // horizontally, so the frame landed a full 384px (20% of the photo's width)
  // too far left and the card poked out past its right edge.
  const offsetX = (view.width - photo.width * scale) / 2;
  const offsetY = (view.height - photo.height * scale) / 2;

  const width = Math.min(guide.width / scale, photo.width);
  const height = Math.min(guide.height / scale, photo.height);
  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  return {
    // Clamp so a guide that sits slightly outside the visible slice (possible
    // after rounding, or when the guide is dragged near an edge) still yields a
    // frame fully inside the photo — a negative origin would crash crop().
    x: clamp((guide.x - offsetX) / scale, 0, photo.width - width),
    y: clamp((guide.y - offsetY) / scale, 0, photo.height - height),
    width,
    height,
  };
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

type ManipulatorModule = typeof import("expo-image-manipulator");

/**
 * Guards the lazy `import("expo-image-manipulator")` against interop and
 * bundler-cache surprises: Metro can surface the namespace with named
 * exports, wrap them in `default`, or — with a stale transform cache from an
 * older SDK — resolve the import without the new `ImageManipulator` API at
 * all. Returns null when the API is not available, so callers can degrade
 * gracefully instead of crashing with "Cannot read property 'manipulate' of
 * undefined".
 */
function resolveManipulatorModule(module: unknown): ManipulatorModule | null {
  if (!module || typeof module !== "object") {
    return null;
  }
  const direct = module as Partial<ManipulatorModule>;
  if (direct.ImageManipulator) {
    return direct as ManipulatorModule;
  }
  const nested = (module as { default?: Partial<ManipulatorModule> }).default;
  if (nested?.ImageManipulator) {
    return nested as ManipulatorModule;
  }
  return null;
}

/**
 * The `ImageManipulatorContext` type, derived from the lazy import so the
 * module itself stays unloaded until the crop step actually runs.
 */
type ManipulatorContext = ReturnType<
  ManipulatorModule["ImageManipulator"]["manipulate"]
>;

/**
 * Longest edge, in pixels, of the working copy the cropper previews and crops.
 *
 * WHY THIS IS BOUNDED
 * The ID flow captures through vision-camera's `usePhotoOutput`, whose default
 * `targetResolution` is `CommonResolutions.UHD_4_3` (3024x4032 ~= 12.2 MP), and
 * expo-image-manipulator decodes its source at FULL resolution into an
 * ARGB_8888 bitmap — roughly 49 MB per copy on Android. Every transformer in
 * the chain allocates another one, so a rotate + render of an unbounded capture
 * parks well over 100 MB of native bitmap memory while the camera session is
 * still resident. That is what got the process OOM-killed — Android restarts
 * the activity, which is what looks like "the app reloaded" the moment the
 * cropper opens.
 *
 * This cap is also the preview/crop resolution, so it must stay well above what
 * an ID card needs: the default crop frame spans 86% of the frame's width, and
 * admins zoom in to read small print. 2560 leaves the cropped card around
 * 2200px on its long edge — comfortably legible, at ~20 MB of bitmap.
 */
export const MAX_NORMALIZED_EDGE = 2560;

/**
 * Longest edge used for the orientation probe. The probe only needs the source
 * aspect ratio, so it renders a thumbnail instead of paying for a second
 * full-resolution decode. Its reported width/height are therefore a RATIO, not
 * the source's real size — feed them to fitRatioToEdge, never to resize().
 */
const PROBE_EDGE = 64;

/**
 * Turns an aspect ratio into concrete target dimensions whose longest edge is
 * exactly `maxEdge`.
 *
 * The ratio may come from a THUMBNAIL probe (see PROBE_EDGE), so `width`/
 * `height` here are only proportional — never a pixel size to preserve. Always
 * scaling up to the cap is deliberate: the input is a camera capture, so in
 * practice this downscales, and when a source really is smaller than the cap,
 * upscaling costs a little memory but invents no detail (the crop output stays
 * exactly as sharp as the original was). Guaranteeing the cap is what keeps the
 * native bitmap bounded.
 *
 * Returns null when the ratio is unusable.
 */
export function fitRatioToEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(maxEdge) || maxEdge <= 0) {
    return null;
  }
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Releases an expo shared object without ever throwing.
 *
 * This is not optional bookkeeping: on Android an `ImageManipulatorContext`
 * holds the decoded bitmap (see ManipulatorTask), so a context that is never
 * released keeps ~49 MB pinned for the rest of the screen's life even though
 * the `ImageRef` from `renderAsync()` was freed. `release()` also detaches the
 * native counterpart, so a second call (or a call on an already-collected
 * object) throws — cleanup paths must not propagate that.
 */
function releaseNative(shared: unknown): void {
  if (!shared || typeof shared !== "object") {
    return;
  }
  const release = (shared as { release?: unknown }).release;
  if (typeof release !== "function") {
    return;
  }
  try {
    (release as () => void).call(shared);
  } catch {
    // Already released or already collected — nothing left to free.
  }
}

/** Refs and setters the gesture builders need to move/resize the frame. */
export type CropperGestureDeps = {
  displayedRef: { current: DisplayedRect | null };
  frameRef: { current: CropRect | null };
  isSavingRef: { current: boolean };
  lastTouchRef: { current: { x: number; y: number } };
  isDraggingRef: { current: boolean };
  /** Dedicated resize baseline — NEVER shared with the move gesture. */
  resizeLastXRef: { current: number };
  resizeTravelRef: { current: number };
  resizeDraggingRef: { current: boolean };
  applyFrame: (next: CropRect) => void;
};

export type CropperGestureBuilders = (
  deps: CropperGestureDeps,
) => {
  movePan: PanResponderInstance;
  resizePan: PanResponderInstance;
};

/**
 * Standard gesture builders — pointer deltas straight from the PanResponder
 * state. Correct on modern Android/iOS; the legacy-Android OEM variant
 * (cropperoldphone.tsx) replaces these on old devices whose touch pipeline
 * reports 0/NaN coordinates on grant and synthesizes spike moves, which
 * teleports (or NaNs out) the frame during resize.
 *
 * Vivo (Funtouch OS) hardening, applied on every build: never trust the grant
 * coordinates (Vivo can deliver grant with 0/near-origin coords, then the
 * first move jumps to the true finger position — using that delta teleports
 * the frame), re-baseline from the first verified MOVE event's raw pageX/pageY
 * instead, and drop per-event spikes larger than any real finger travel.
 */
export function createDefaultGestures(
  deps: CropperGestureDeps,
): {
  movePan: PanResponderInstance;
  resizePan: PanResponderInstance;
} {
  const {
    displayedRef,
    frameRef,
    isSavingRef,
    lastTouchRef,
    isDraggingRef,
    resizeLastXRef,
    resizeTravelRef,
    resizeDraggingRef,
    applyFrame,
  } = deps;

  // Pointer travel since grant, accumulated from VERIFIED deltas only
  // (gestureState.dx/dy inherit the same OEM grant-coordinate quirks).
  let travelSinceGrant = 0;

  // Drags the whole crop frame around the visible photo.
  const movePan = PanResponder.create({
    onStartShouldSetPanResponder: (event) => {
      // A second finger means the user is pinching the photo, not moving the
      // frame — yielding here is what lets the canvas zoom responder win.
      if (isSavingRef.current || activeTouchCount(event) >= 2) {
        return false;
      }
      return true;
    },
    onMoveShouldSetPanResponder: (event) => {
      if (isSavingRef.current) {
        return false;
      }
      // Same reasoning as grant: a second finger mid-drag promotes the gesture
      // to a pinch rather than dragging the frame around under it.
      return activeTouchCount(event) < 2;
    },
    onPanResponderGrant: () => {
      // Vivo Funtouch OS can grant with 0/NaN coords — baselining here would
      // teleport the frame on the first move. Mark "no baseline" and let the
      // first verified MOVE event set it instead.
      lastTouchRef.current = { x: Number.NaN, y: Number.NaN };
      travelSinceGrant = 0;
      isDraggingRef.current = false;
    },
    onPanResponderMove: (event, gestureState) => {
      const current = displayedRef.current;
      const currentFrame = frameRef.current;
      if (isSavingRef.current || !current || !currentFrame) {
        return;
      }

      // Prefer raw page coords (gestureState.moveX/moveY inherit the same OEM
      // grant-coordinate quirks); fall back to gestureState when unavailable.
      const raw = event.nativeEvent as {
        pageX?: unknown;
        pageY?: unknown;
      };
      const moveX =
        typeof raw.pageX === "number" && Number.isFinite(raw.pageX)
          ? raw.pageX
          : gestureState.moveX;
      const moveY =
        typeof raw.pageY === "number" && Number.isFinite(raw.pageY)
          ? raw.pageY
          : gestureState.moveY;
      if (!Number.isFinite(moveX) || !Number.isFinite(moveY)) {
        return;
      }
      const last = lastTouchRef.current;
      if (!Number.isFinite(last.x) || !Number.isFinite(last.y)) {
        // First trustworthy sample — baseline only, no move yet.
        lastTouchRef.current = { x: moveX, y: moveY };
        return;
      }
      const deltaX = moveX - last.x;
      const deltaY = moveY - last.y;
      lastTouchRef.current = { x: moveX, y: moveY };
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
        return;
      }
      // Drop synthetic OEM spikes (grant-at-0 → jump-to-finger).
      if (Math.abs(deltaX) > 240 || Math.abs(deltaY) > 240) {
        return;
      }

      // Ignore micro-jitter so a tap never nudges the frame. Accumulated from
      // verified deltas (gestureState.dx/dy inherit OEM grant quirks).
      if (!isDraggingRef.current) {
        if (travelSinceGrant < MOVE_THRESHOLD) {
          travelSinceGrant += Math.abs(deltaX) + Math.abs(deltaY);
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
  // Uses its OWN baseline (never the shared lastTouchRef): the frame's move
  // gesture and this resize gesture share that ref, so without a dedicated
  // baseline a drag on the frame would poison the handle's next tap — the
  // first resize delta would be (handleX - lastFrameX), a huge jump that
  // slams the frame to max size. That is exactly the Android 15 "tap the
  // circle, it maxes out" bug.
  const resizePan = PanResponder.create({
    // Capture so the corner handle wins over the frame's move gesture.
    onStartShouldSetPanResponderCapture: () => !isSavingRef.current,
    // Fallback claim if an OEM ROM dispatches the touch without a capture
    // phase (seen on some Vivo Funtouch builds) — without this the tap falls
    // through to the frame's move gesture and the frame jumps.
    onStartShouldSetPanResponder: () => !isSavingRef.current,
    onMoveShouldSetPanResponderCapture: () => !isSavingRef.current,
    // Never let the frame's move gesture steal the touch mid-resize.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      // Same Vivo guard as the move gesture: never baseline from grant.
      resizeLastXRef.current = Number.NaN;
      // Tap travel guard: a plain tap must never resize, even by a pixel.
      resizeTravelRef.current = 0;
      resizeDraggingRef.current = false;
    },
    onPanResponderMove: (event, gestureState) => {
      const current = displayedRef.current;
      const currentFrame = frameRef.current;
      if (isSavingRef.current || !current || !currentFrame) {
        return;
      }

      const raw = event.nativeEvent as { pageX?: unknown };
      const moveX =
        typeof raw.pageX === "number" && Number.isFinite(raw.pageX)
          ? raw.pageX
          : gestureState.moveX;
      if (!Number.isFinite(moveX)) {
        return;
      }
      const lastX = resizeLastXRef.current;
      if (!Number.isFinite(lastX)) {
        // First trustworthy sample — baseline only, no resize yet. This is
        // the actual Vivo fix: a tap on the handle no longer resizes from a
        // bogus grant baseline.
        resizeLastXRef.current = moveX;
        return;
      }
      const deltaX = moveX - lastX;
      resizeLastXRef.current = moveX;
      if (!Number.isFinite(deltaX)) {
        return;
      }
      if (Math.abs(deltaX) > 240) {
        return;
      }
      // A tap (or finger tremble) on the handle must not resize at all:
      // accumulate real travel first, arm only past the threshold.
      if (!resizeDraggingRef.current) {
        resizeTravelRef.current += Math.abs(deltaX);
        if (resizeTravelRef.current < MOVE_THRESHOLD) {
          return;
        }
        resizeDraggingRef.current = true;
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
      resizeLastXRef.current = Number.NaN;
      resizeTravelRef.current = 0;
      resizeDraggingRef.current = false;
    },
    onPanResponderTerminate: () => {
      resizeLastXRef.current = Number.NaN;
      resizeTravelRef.current = 0;
      resizeDraggingRef.current = false;
    },
  });

  return { movePan, resizePan };
}

type ValidIdCropperFullProps = ValidIdCropperProps & {
  /** Gesture-builder override — used by the legacy-Android OEM variant
   * (cropperoldphone.tsx). Defaults to the standard builders. */
  gestures?: CropperGestureBuilders;
};

/**
 * Full-screen crop step for the Valid ID flow. Shows the captured photo with
 * an aspect-locked (CR80) crop frame the user can drag and resize; confirming
 * crops the image in native pixels via expo-image-manipulator and hands the
 * new file URI back.
 */
export default function ValidIdCropper({
  photoUri,
  sideLabel,
  onConfirm,
  onCancel,
  viewWidth,
  viewHeight,
  guideRect,
  gestures = createDefaultGestures,
}: ValidIdCropperFullProps) {
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [frame, setFrame] = useState<CropRect | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Whether expo-image-manipulator's native module exists in this build.
  // null = still probing. When false, the installed dev client predates the
  // package and "Use Photo" can only attach the uncropped capture.
  const [isCropperReady, setIsCropperReady] = useState<boolean | null>(null);
  // The file actually previewed and cropped. Usually a normalized re-encode
  // of the capture (EXIF orientation baked into plain pixels), produced on
  // mount so the preview and the native crop see identical pixel data. null
  // while the normalization roundtrip is still running.
  const [displayUri, setDisplayUri] = useState<string | null>(null);
  // True while the portrait auto-rotation pass is running (separate from the
  // initial normalization spinner so the preview never flashes mid-rotate).
  const [isRotating, setIsRotating] = useState(false);

  // Refs mirroring state so the (stable) PanResponder callbacks always read
  // fresh values without being recreated mid-gesture.
  const frameRef = useRef<CropRect | null>(null);
  const displayedRef = useRef<DisplayedRect | null>(null);
  // The zoom-1 rect, and the live user zoom. Mirrors rather than state so the
  // PanResponder callbacks and the crop callback can read them mid-gesture.
  const baseRectRef = useRef<DisplayedRect | null>(null);
  // Canvas size as a ref, for the zoom gesture's pan clamping.
  const containerSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY_ZOOM);
  const zoomRef = useRef<ZoomState>(IDENTITY_ZOOM);
  const isSavingRef = useRef(false);
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  // Dedicated resize-gesture state. The move gesture and the resize gesture
  // MUST NOT share lastTouchRef: both PanResponders write it on grant/move,
  // so a frame drag writes frame coords into it and the handle's next tap
  // would diff (handleX - staleFrameX) — a huge phantom delta that clamps to
  // maxWidth and slams the square to fullscreen. Separate refs kill that
  // cross-talk entirely (Android 15 "tap circle → maxes out" bug).
  const resizeLastXRef = useRef<number>(Number.NaN);
  const resizeTravelRef = useRef<number>(0);
  const resizeDraggingRef = useRef<boolean>(false);
  // Mirrors displayUri for the stable crop callback; also tracks the
  // normalized intermediate file for cleanup when the cropper closes.
  const displayUriRef = useRef<string | null>(null);
  const normalizedUriRef = useRef<string | null>(null);

  const applyFrame = useCallback((next: CropRect) => {
    // Never let a NaN/Infinity frame reach layout — OEM touch quirks can
    // produce non-finite deltas, and a NaN style crashes/blank-screens.
    if (
      !Number.isFinite(next.x) ||
      !Number.isFinite(next.y) ||
      !Number.isFinite(next.width) ||
      !Number.isFinite(next.height)
    ) {
      return;
    }
    frameRef.current = next;
    setFrame(next);
  }, []);

  // The zoom-1 letterboxed rect: the contain-fit of the photo in the canvas,
  // before any user zoom. This is the anchor the zoom transform is applied to.
  const baseDisplayed = useMemo<DisplayedRect | null>(() => {
    if (!containerSize || !imageSize) {
      return null;
    }
    // Zero/negative decoded sizes would make scale Infinity — bail out
    // instead of poisoning every frame computation with NaN.
    if (imageSize.width <= 0 || imageSize.height <= 0) {
      return null;
    }
    const scale = Math.min(
      containerSize.width / imageSize.width,
      containerSize.height / imageSize.height,
    );
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    return {
      offsetX: (containerSize.width - width) / 2,
      offsetY: (containerSize.height - height) / 2,
      width,
      height,
      scale,
    };
  }, [containerSize, imageSize]);

  // The gesture builders and the crop callback need the rect without waiting
  // for a re-render, so both the base and the live transform are mirrored.
  useEffect(() => {
    baseRectRef.current = baseDisplayed;
  }, [baseDisplayed]);

  useEffect(() => {
    containerSizeRef.current = containerSize;
  }, [containerSize]);

  useEffect(() => {
    displayedRef.current = baseDisplayed
      ? effectiveRect(baseDisplayed, zoomRef.current)
      : null;
  }, [baseDisplayed, zoom]);

  useEffect(() => {
    displayUriRef.current = displayUri;
  }, [displayUri]);

  // (Re)place the default crop frame whenever the displayed photo changes
  // (initial layout, rotation, or a new capture).
  //
  // Uses baseDisplayed (the zoom-1 rect) deliberately: the frame is placed from
  // the capture guide against the un-zoomed layout, and it must NOT be re-placed
  // when the user zooms — zooming is inspection, not re-framing.
  //
  // Preferred source is the capture screen's guide: mapping it back into photo
  // pixels makes the two screens agree, so lining the card up in the guide is
  // the same thing as framing it here. The centered 86% default is only the
  // fallback for a cropper opened without that geometry (deep link, or the
  // guide had not been measured yet).
  useEffect(() => {
    if (!baseDisplayed) {
      frameRef.current = null;
      setFrame(null);
      return;
    }

    const guidePhotoRect =
      guideRect && imageSize && viewWidth && viewHeight
        ? guideRectInPhoto(
            { width: viewWidth, height: viewHeight },
            guideRect,
            imageSize,
          )
        : null;

    if (guidePhotoRect) {
      // Photo pixels -> canvas points via the same contain-fit the <Image> uses.
      applyFrame({
        x: baseDisplayed.offsetX + guidePhotoRect.x * baseDisplayed.scale,
        y: baseDisplayed.offsetY + guidePhotoRect.y * baseDisplayed.scale,
        width: guidePhotoRect.width * baseDisplayed.scale,
        height: guidePhotoRect.height * baseDisplayed.scale,
      });
      return;
    }

    const width = Math.min(
      baseDisplayed.width * INITIAL_SIZE_FRACTION,
      baseDisplayed.height * CROP_ASPECT,
    );
    const initial: CropRect = {
      x: baseDisplayed.offsetX + (baseDisplayed.width - width) / 2,
      y: baseDisplayed.offsetY + (baseDisplayed.height - width / CROP_ASPECT) / 2,
      width,
      height: width / CROP_ASPECT,
    };
    applyFrame(initial);
  }, [
    baseDisplayed,
    imageSize,
    guideRect,
    viewWidth,
    viewHeight,
    applyFrame,
  ]);

  // Applies a transform to both the mirror and React state. Called on every
  // gesture frame (so the photo tracks the fingers) — which also keeps
  // displayedRef, the source of the crop math, in step.
  const applyZoom = useCallback((next: ZoomState) => {
    zoomRef.current = next;
    const base = baseRectRef.current;
    if (base) {
      displayedRef.current = effectiveRect(base, next);
    }
    setZoom(next);
  }, []);

  // Pinch / pan / double-tap for the photo itself. Built once — every input is a
  // ref, so the responder never needs rebuilding mid-gesture.
  const { zoomPan } = useMemo(
    () =>
      createZoomGestures({
        baseRef: baseRectRef,
        canvasRef: containerSizeRef,
        zoomRef,
        isBusyRef: isSavingRef,
        onCommit: applyZoom,
        onLive: applyZoom,
      }),
    [applyZoom],
  );

  // A new photo starts un-zoomed: the previous transform was fitted to a
  // different image, so keeping it would drop the user somewhere arbitrary.
  useEffect(() => {
    applyZoom(IDENTITY_ZOOM);
  }, [photoUri, applyZoom]);

  // Prepares the file the cropper previews and crops. Vision-camera captures
  // carry EXIF orientation tags, and on Android the dimensions Image.getSize
  // reports can disagree with the pixels expo-image-manipulator's native
  // decoder (Glide) hands to crop() — that mismatch makes "Use Photo" cut a
  // region away from the framed one. Routing the capture through the
  // manipulator once (render + save) bakes the orientation into plain pixels,
  // strips the EXIF tag, and yields the exact dimensions crop() will see, so
  // the preview and the crop can never disagree. Falls back to the raw
  // capture (Image.getSize) if that roundtrip fails.
  useEffect(() => {
    let cancelled = false;
    setDisplayUri(null);
    setImageSize(null);
    normalizedUriRef.current = null;

    const loadRawCaptureFallback = () => {
      Image.getSize(
        photoUri,
        (width, height) => {
          if (!cancelled) {
            setImageSize({ width, height });
            setDisplayUri(photoUri);
          }
        },
        () => {
          if (!cancelled) {
            Alert.alert(
              "Could Not Load Photo",
              "The captured photo could not be opened for cropping. Please retake it.",
            );
            onCancel();
          }
        },
      );
    };

    void (async () => {
      try {
        // Imported lazily: the native module only exists after the dev client
        // is rebuilt (npx expo run:android) — same rationale as the crop
        // step below. resolveManipulatorModule also catches stale-cache
        // bundles that resolve without the ImageManipulator API.
        const resolved = resolveManipulatorModule(
          await import("expo-image-manipulator"),
        );
        if (!resolved) {
          throw new Error("Cannot find native module 'ExpoImageManipulator'");
        }
        const { ImageManipulator, SaveFormat } = resolved;
        // Portrait-held phone + rear camera = the sensor writes landscape
        // pixels (width > height) with an EXIF tag, and renderAsync() alone
        // does NOT bake that tag into pixels on SDK 54. Explicitly rotate the
        // context -90 deg so the normalized file is upright (portrait pixels)
        // before the preview ever shows it.
        //
        // The probe renders a THUMBNAIL. Reading the source aspect ratio used
        // to cost a second full-resolution decode — ~49 MB of native bitmap on
        // top of the real pass, which is what tipped the process into an OOM
        // kill (the "app reload") the moment the cropper opened.
        let sourceWidth = 0;
        let sourceHeight = 0;
        let probeContext: ManipulatorContext | null = null;
        let probe: ImageRef | null = null;
        try {
          probeContext = ImageManipulator.manipulate(photoUri);
          probeContext.resize({ width: PROBE_EDGE });
          probe = await probeContext.renderAsync();
          sourceWidth = probe.width;
          sourceHeight = probe.height;
        } catch (probeError) {
          console.warn(
            "[ValidIdCropper] orientation probe failed, skipping auto-rotate:",
            probeError,
          );
        } finally {
          // Both objects must go: the thumbnail ref AND the context, which
          // pins whatever it decoded.
          releaseNative(probe);
          releaseNative(probeContext);
        }

        const needsPortraitFix = sourceWidth > sourceHeight && sourceHeight > 0;
        // The probe is a PROBE_EDGE-wide THUMBNAIL, so sourceWidth/sourceHeight
        // carry the source's ASPECT RATIO, not its pixel size. They must be
        // re-scaled up to the working cap — passing them straight to resize()
        // would emit a ~64x48 preview (the unreadable-blur regression).
        //
        // Scaling a 90 degree rotation and rotating a scale commute, so the
        // bound can be derived from the pre-rotate ratio. With no probe result
        // there is no ratio, so bound by width alone: the manipulator derives
        // the height from the real source ratio, and the crop math reads the
        // true dimensions back off the rendered ref regardless.
        const target =
          fitRatioToEdge(sourceWidth, sourceHeight, MAX_NORMALIZED_EDGE) ?? {
            width: MAX_NORMALIZED_EDGE,
            height: 0,
          };

        let context: ManipulatorContext | null = null;
        let rendered: ImageRef | null = null;
        let width = 0;
        let height = 0;
        let normalizedUri = "";
        try {
          context = ImageManipulator.manipulate(photoUri);
          // Downscale BEFORE rotating. Every transformer in the chain
          // allocates its own bitmap while the previous one is still
          // reachable, so rotating first meant two full-size copies were live
          // at once; shrinking first keeps the peak at one full-size decode
          // plus two small ones.
          if (target.width > 0) {
            context.resize(
              target.height > 0
                ? { width: target.width, height: target.height }
                : { width: target.width },
            );
          }
          if (needsPortraitFix) {
            console.log(
              "[ValidIdCropper] portrait auto-rotate: sensor ratio",
              `${sourceWidth}:${sourceHeight}`,
              "-> rotating -90 deg, working copy",
              `${target.width}x${target.height}`,
            );
            // -90 deg: landscape sensor pixels -> upright portrait.
            context.rotate(-90);
          }
          rendered = await context.renderAsync();
          // Capture the dimensions before releasing the native ref — they are
          // the ground truth of what crop() will operate on.
          ({ width, height } = rendered);
          const saved = await rendered.saveAsync({
            compress: 0.95,
            format: SaveFormat.JPEG,
          });
          // Some native builds return a bare absolute path instead of a file://
          // URI — normalize the same way the crop result is normalized.
          normalizedUri = /^(file|content|https?):\/\//.test(saved.uri) ||
            saved.uri.startsWith("data:")
            ? saved.uri
            : `file://${saved.uri}`;
        } finally {
          // The decoded bitmap is owned by the context, not only by the ref.
          // Releasing just the ref left ~49 MB resident per manipulation.
          releaseNative(rendered);
          releaseNative(context);
        }
        if (cancelled) {
          FileSystem.deleteAsync(normalizedUri, { idempotent: true }).catch(
            () => {},
          );
          return;
        }
        normalizedUriRef.current = normalizedUri;
        setImageSize({ width, height });
        setDisplayUri(normalizedUri);
      } catch (error) {
        console.warn(
          "[ValidIdCropper] capture normalization failed, using raw file:",
          error,
        );
        if (!cancelled) {
          loadRawCaptureFallback();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photoUri, onCancel]);

  // Removes the normalized intermediate file when the cropper goes away
  // (confirm, cancel, or unmount) — only the crop result outlives the screen.
  useEffect(() => {
    return () => {
      const normalizedUri = normalizedUriRef.current;
      if (normalizedUri && normalizedUri !== photoUri) {
        FileSystem.deleteAsync(normalizedUri, { idempotent: true }).catch(
          () => {},
        );
      }
    };
  }, [photoUri]);

  // Probe for the native manipulator module once on mount so the UI can warn
  // up front when the app build predates expo-image-manipulator (otherwise
  // the user only finds out after tapping Use Photo).
  useEffect(() => {
    let cancelled = false;
    import("expo-image-manipulator")
      .then((module) => {
        if (!cancelled) {
          // A resolving import is not enough — a stale Metro cache can serve
          // an older SDK's copy that lacks the ImageManipulator API.
          setIsCropperReady(resolveManipulatorModule(module) !== null);
        }
      })
      .catch((error) => {
        console.warn("[ValidIdCropper] manipulator module unavailable:", error);
        if (!cancelled) {
          setIsCropperReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Gesture handlers, built once per gesture-builder. The builders only read
  // refs (so the responders always see fresh values without being recreated
  // mid-gesture) — safe against OEM touch quirks via the variant builders.
  const { movePan, resizePan } = useMemo(
    () =>
      gestures({
        displayedRef,
        frameRef,
        isSavingRef,
        lastTouchRef,
        isDraggingRef,
        resizeLastXRef,
        resizeTravelRef,
        resizeDraggingRef,
        applyFrame,
      }),
    // Refs are stable identities — the builders only read .current, so the
    // responders never need rebuilding mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gestures, applyFrame],
  );

  // Maps the screen crop frame into image pixels and writes a new cropped
  // JPEG to the cache directory.
  const handleRotateDisplay = useCallback(async () => {
    const currentUri = displayUriRef.current;
    if (isSavingRef.current || isRotating || !currentUri) {
      return;
    }

    isSavingRef.current = true;
    setIsRotating(true);
    let context: ManipulatorContext | null = null;
    let rendered: ImageRef | null = null;
    try {
      const resolved = resolveManipulatorModule(
        await import("expo-image-manipulator"),
      );
      if (!resolved) {
        throw new Error("Cannot find native module 'ExpoImageManipulator'");
      }
      const { ImageManipulator, SaveFormat } = resolved;
      // Manual 90 deg clockwise step for OEMs where the auto-detect guesses
      // wrong (some Vivo builds tag the sensor opposite). Rotates the exact
      // file the preview shows, swaps dimensions, and re-centers the frame
      // via the displayed effect.
      context = ImageManipulator.manipulate(currentUri);
      context.rotate(90);
      rendered = await context.renderAsync();
      const { width, height } = rendered;
      const result = await rendered.saveAsync({
        compress: 0.95,
        format: SaveFormat.JPEG,
      });
      const rotatedUri = /^(file|content|https?):\/\//.test(result.uri) ||
        result.uri.startsWith("data:")
        ? result.uri
        : `file://${result.uri}`;
      const previousUri = displayUriRef.current;
      const previousNormalized = normalizedUriRef.current;
      normalizedUriRef.current = rotatedUri;
      displayUriRef.current = rotatedUri;
      setImageSize({ width, height });
      setDisplayUri(rotatedUri);
      // Drop the superseded intermediate so only the rotated file outlives
      // the screen (never delete the raw capture — the caller owns it).
      if (
        previousUri &&
        previousUri !== photoUri &&
        previousUri !== rotatedUri &&
        previousUri === previousNormalized
      ) {
        FileSystem.deleteAsync(previousUri, { idempotent: true }).catch(
          () => {},
        );
      }
    } catch (error) {
      console.warn("[ValidIdCropper] manual rotate failed:", error);
      Alert.alert(
        "Rotate Failed",
        "Could not rotate the photo. Please retake it.",
      );
    } finally {
      releaseNative(rendered);
      releaseNative(context);
      isSavingRef.current = false;
      setIsRotating(false);
    }
  }, [isRotating, photoUri]);

  const handleConfirmCrop = useCallback(async () => {
    const current = displayedRef.current;
    const currentFrame = frameRef.current;
    if (isSavingRef.current || !current || !currentFrame) {
      return;
    }

    const originX = Math.round(
      (currentFrame.x - current.offsetX) / current.scale,
    );
    const originY = Math.round(
      (currentFrame.y - current.offsetY) / current.scale,
    );
    const width = Math.round(currentFrame.width / current.scale);
    const height = Math.round(currentFrame.height / current.scale);
    if (
      width < 1 ||
      height < 1 ||
      !Number.isFinite(originX) ||
      !Number.isFinite(originY)
    ) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    let context: ManipulatorContext | null = null;
    let rendered: ImageRef | null = null;
    try {
      // Crop the same normalized file the preview shows, so the output is
      // always exactly the framed region (identical pixel data on both
      // sides). Falls back to the raw capture if normalization failed.
      const sourceUri = displayUriRef.current ?? photoUri;
      // Imported lazily: the native module only exists after the dev client is
      // rebuilt (npx expo run:android). Loading it here keeps the capture
      // screen usable on older builds and lets us fall back gracefully.
      const resolved = resolveManipulatorModule(
        await import("expo-image-manipulator"),
      );
      if (!resolved) {
        // Matches the missing-native-module message below so the user gets
        // the "Cropper Unavailable" guidance instead of a cryptic TypeError.
        throw new Error("Cannot find native module 'ExpoImageManipulator'");
      }
      const { ImageManipulator, SaveFormat } = resolved;
      context = ImageManipulator.manipulate(sourceUri);
      context.crop({ originX, originY, width, height });
      rendered = await context.renderAsync();
      const result = await rendered.saveAsync({
        compress: 0.9,
        format: SaveFormat.JPEG,
      });
      // Free the decoded bitmap before handing off: onConfirm navigates away
      // and the crop result is already on disk, so nothing below needs it.
      releaseNative(rendered);
      rendered = null;
      releaseNative(context);
      context = null;
      console.log(
        "[ValidIdCropper] cropped:",
        result.uri,
        `${result.width}x${result.height}`,
        "from crop rect",
        { originX, originY, width, height },
        "of image",
        {
          width: Math.round(current.width / current.scale),
          height: Math.round(current.height / current.scale),
        },
        "scale",
        current.scale,
      );
      // Some native builds return a bare absolute path instead of a file://
      // URI (vision-camera needed the same normalization) — without the
      // scheme RN Image renders nothing and the attachment looks blank.
      const croppedUri = /^(file|content|https?):\/\//.test(result.uri) ||
        result.uri.startsWith("data:")
        ? result.uri
        : `file://${result.uri}`;
      onConfirm(croppedUri);
    } catch (error) {
      console.error("[ValidIdCropper] crop failed:", error);
      if (
        error instanceof Error &&
        error.message.includes("Cannot find native module")
      ) {
        // Dev client was built before expo-image-manipulator was added.
        // Offer the raw capture so the verification flow still completes;
        // real cropping returns after the rebuild.
        Alert.alert(
          "Cropper Unavailable",
          "Cropping needs a rebuilt dev client (npx expo run:android). Use the uncropped photo instead?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Use Original", onPress: () => onConfirm(photoUri) },
          ],
        );
      } else {
        Alert.alert(
          "Crop Failed",
          "Could not crop the photo. Please try again.",
        );
      }
    } finally {
      releaseNative(rendered);
      releaseNative(context);
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [photoUri, onConfirm]);

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onCancel}
            disabled={isSaving || isRotating}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Discard the captured photo and return to the camera"
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Crop ID Photo</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {sideLabel}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleRotateDisplay}
            disabled={isSaving || isRotating || !displayUri}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Rotate the photo 90 degrees clockwise"
          >
            {isRotating ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="refresh" size={22} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>

        <View
          style={styles.canvas}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setContainerSize((prev) =>
              prev && prev.width === width && prev.height === height
                ? prev
                : { width, height },
            );
          }}
          // Pinch / pan / double-tap on the photo. On the canvas rather than
          // the frame: the frame is a CHILD of this view, so RN gives touches
          // that land on it to the frame's own move/resize responders first.
          {...zoomPan.panHandlers}
        >
          {displayUri ? (
            <Image
              source={{ uri: displayUri }}
              style={[
                StyleSheet.absoluteFill,
                // Translate before scale so the pan distance stays in screen
                // points, matching the focal-point math in valididzoom. RN
                // scales about this element's center, which is the canvas
                // center — the same origin effectiveRect assumes.
                {
                  transform: [
                    { translateX: zoom.tx },
                    { translateY: zoom.ty },
                    { scale: zoom.scale },
                  ],
                },
              ]}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.canvasLoading}>
              <ActivityIndicator size="large" color="#0EA5E9" />
            </View>
          )}

          {frame && (
            <>
              {/* Dim everything outside the crop frame (four masks). */}
              <View
                style={[styles.mask, { top: 0, left: 0, right: 0, height: frame.y }]}
              />
              <View
                style={[
                  styles.mask,
                  {
                    top: frame.y,
                    left: 0,
                    width: frame.x,
                    height: frame.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.mask,
                  {
                    top: frame.y,
                    left: frame.x + frame.width,
                    right: 0,
                    height: frame.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.mask,
                  {
                    left: 0,
                    right: 0,
                    top: frame.y + frame.height,
                    bottom: 0,
                  },
                ]}
              />

              {/* The crop frame — drag anywhere on it to move. */}
              <View
                style={[
                  styles.cropFrame,
                  {
                    left: frame.x,
                    top: frame.y,
                    width: frame.width,
                    height: frame.height,
                  },
                ]}
                {...movePan.panHandlers}
              >
                <View style={styles.cropCornerTL} />
                <View style={styles.cropCornerTR} />
                <View style={styles.cropCornerBL} />
                <View style={styles.cropCornerBR} />

                {/* Bottom-right resize handle (aspect-locked). The touch target
                    is intentionally larger than the visible circle (transparent
                    padding via hitSlop + a bigger wrapper) so fat-finger taps
                    on Vivo/large-screen devices land on the handle instead of
                    the move frame behind it. */}
                <View
                  style={styles.resizeHitArea}
                  {...resizePan.panHandlers}
                  hitSlop={{ top: 16, right: 16, bottom: 16, left: 16 }}
                >
                  <View style={styles.resizeHandle}>
                    <Ionicons name="resize" size={14} color="#0F172A" />
                  </View>
                </View>
              </View>
            </>
          )}
        </View>

        <Text style={styles.hint}>
          Drag the frame over your ID and resize with the corner handle. Pinch
          or double-tap the photo to zoom in and check the details.
        </Text>

        {isCropperReady === false && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={16} color="#F59E0B" />
            <Text style={styles.warningText}>
              Cropping is unavailable in this app build — rebuild your
              development build (npx eas-cli build --profile development)
              first. Use Photo will attach the uncropped photo.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.confirmButton,
              isSaving && styles.actionButtonDisabled,
            ]}
            onPress={() => void handleConfirmCrop()}
            disabled={isSaving || !frame}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Crop and use this photo"
            accessibilityState={{ disabled: isSaving || !frame }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.confirmText}>Use Photo</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0B1220",
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 2,
  },
  canvas: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  canvasLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  mask: {
    position: "absolute",
    backgroundColor: "rgba(11, 18, 32, 0.72)",
  },
  cropFrame: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    borderRadius: 10,
  },
  cropCornerTL: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 26,
    height: 26,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopColor: "#0EA5E9",
    borderLeftColor: "#0EA5E9",
    borderTopLeftRadius: 10,
  },
  cropCornerTR: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 26,
    height: 26,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopColor: "#0EA5E9",
    borderRightColor: "#0EA5E9",
    borderTopRightRadius: 10,
  },
  cropCornerBL: {
    position: "absolute",
    bottom: -2,
    left: -2,
    width: 26,
    height: 26,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomColor: "#0EA5E9",
    borderLeftColor: "#0EA5E9",
    borderBottomLeftRadius: 10,
  },
  cropCornerBR: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomColor: "#0EA5E9",
    borderRightColor: "#0EA5E9",
    borderBottomRightRadius: 10,
  },
  resizeHitArea: {
    position: "absolute",
    // Larger than the visible circle — extends the grab zone outward so taps
    // near the corner reliably hit the handle, not the move frame.
    right: -24,
    bottom: -24,
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  resizeHandle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  hint: {
    color: "#94A3B8",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  warningText: {
    flex: 1,
    color: "#FCD34D",
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmButton: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
});






import { useGT } from "gt-react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { flushSync } from "react-dom";

import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import {
  onWindowControlsOverlayGeometryChange,
  windowControlsOverlayHeight,
} from "../../lib/windowControlsOverlay";

import { AttachmentImage } from "../media/AttachmentImage";

const MAX_ZOOM = 8;
const ZOOM_HUD_HIDE_MS = 1100;
const SWIPE_LOCK_SLOP_PX = 10;
const SWIPE_COMMIT_DISTANCE_PX = 48;
const SWIPE_FLICK_DISTANCE_PX = 28;
const SWIPE_FLICK_VELOCITY_PX_PER_MS = 0.35;
const SWIPE_HORIZONTAL_RATIO = 1.2;

// Subtract the caption strip, matching dialog CSS's --native-titlebar-height.
function readViewerSize() {
  return { width: window.innerWidth, height: window.innerHeight - windowControlsOverlayHeight() };
}

let viewerSize: ReturnType<typeof readViewerSize> | null = null;

// Cached so an unchanged size keeps its identity: a new one resets the zoom.
function getViewerSize() {
  const next = readViewerSize();
  if (next.width !== viewerSize?.width || next.height !== viewerSize.height) viewerSize = next;
  return viewerSize;
}

function subscribeViewerSize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  // Fullscreen caption-strip changes may not emit resize.
  const stopOverlayListener = onWindowControlsOverlayGeometryChange(onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    stopOverlayListener();
  };
}

export interface ZoomableImageHandle {
  pan: (key: string) => boolean;
}

export function ZoomableImage({
  src,
  name,
  mimeType,
  onError,
  onSwipeNavigate,
  ref,
}: {
  src: string;
  name: string;
  mimeType?: string | undefined;
  onError: () => void;
  onSwipeNavigate?: ((direction: -1 | 1) => void) | undefined;
  ref?: Ref<ZoomableImageHandle>;
}) {
  const gt = useGT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const zoomAnimationRef = useRef<Animation | null>(null);
  const zoomHudTimerRef = useRef<number | null>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const viewerSize = useSyncExternalStore(subscribeViewerSize, getViewerSize);
  const [zoom, setZoom] = useState(1);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  // A resized viewer refits the image.
  const [zoomViewerSize, setZoomViewerSize] = useState(viewerSize);
  if (zoomViewerSize !== viewerSize) {
    setZoomViewerSize(viewerSize);
    setZoom(1);
    setZoomHudVisible(false);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cleans up the ephemeral zoom HUD hide timer and WAAPI animation on unmount
  useEffect(() => {
    return () => {
      if (zoomHudTimerRef.current !== null) {
        window.clearTimeout(zoomHudTimerRef.current);
        zoomHudTimerRef.current = null;
      }
      zoomAnimationRef.current?.cancel();
      zoomAnimationRef.current = null;
    };
  }, []);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const activeTouchPointersRef = useRef<Set<number>>(new Set());
  const touchSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    axis: "horizontal" | "vertical" | null;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const maxHeight = Math.max(1, Math.min(viewerSize.height * 0.86, viewerSize.height - 160));
  // A vector scales without loss, and an SVG without width and height reports a tiny default size.
  const fit = Math.min(
    mimeType === "image/svg+xml" ? Infinity : 1,
    (viewerSize.width * 0.92 - (viewerSize.width >= 640 ? 96 : 0)) / (naturalSize.width || 1),
    maxHeight / (naturalSize.height || 1),
  );
  const width = naturalSize.width * fit * zoom;
  const height = naturalSize.height * fit * zoom;

  useImperativeHandle(
    ref,
    () => ({
      pan(key) {
        const viewport = viewportRef.current;
        if (!viewport || zoom <= 1) return false;
        // A vertical scrollbar alone must not swallow gallery navigation.
        if (
          (key === "ArrowLeft" || key === "ArrowRight") &&
          viewport.scrollWidth <= viewport.offsetWidth
        )
          return false;
        switch (key) {
          case "ArrowLeft":
            viewport.scrollLeft -= 40;
            break;
          case "ArrowRight":
            viewport.scrollLeft += 40;
            break;
          case "ArrowUp":
            viewport.scrollTop -= 40;
            break;
          case "ArrowDown":
            viewport.scrollTop += 40;
            break;
          default:
            return false;
        }
        return true;
      },
    }),
    [zoom],
  );

  const flashZoomHud = () => {
    setZoomHudVisible(true);
    if (zoomHudTimerRef.current !== null) {
      window.clearTimeout(zoomHudTimerRef.current);
    }
    zoomHudTimerRef.current = window.setTimeout(() => {
      zoomHudTimerRef.current = null;
      setZoomHudVisible(false);
    }, ZOOM_HUD_HIDE_MS);
  };

  const changeZoom = (
    next: number,
    point?: { x: number; y: number },
    options?: { readonly smooth?: boolean },
  ) => {
    const viewport = viewportRef.current;
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
    if (!viewport || zoom === clamped) return;
    const previousZoom = zoom;
    const bounds = viewport.getBoundingClientRect();
    const x = point ? point.x - bounds.left : viewport.clientWidth / 2;
    const y = point ? point.y - bounds.top : viewport.clientHeight / 2;
    const anchorX = (viewport.scrollLeft + x) / zoom;
    const anchorY = (viewport.scrollTop + y) / zoom;
    const clientX = bounds.left + x;
    const clientY = bounds.top + y;
    // The new size must be laid out before the scroll position can keep the anchor in place.
    flushSync(() => setZoom(clamped));
    const resized = viewport.getBoundingClientRect();
    viewport.scrollLeft = anchorX * clamped - (clientX - resized.left);
    viewport.scrollTop = anchorY * clamped - (clientY - resized.top);
    flashZoomHud();
    if (
      options?.smooth &&
      !prefersReducedMotion() &&
      imageWrapRef.current &&
      typeof imageWrapRef.current.animate === "function"
    ) {
      zoomAnimationRef.current?.cancel();
      const ratio = previousZoom / clamped;
      const timing = getSpringWaapiTiming("snappy");
      zoomAnimationRef.current = imageWrapRef.current.animate(
        [{ transform: `scale(${ratio.toFixed(4)})` }, { transform: "scale(1)" }],
        { duration: Math.min(200, timing.duration), easing: timing.easing },
      );
    }
  };

  const attachViewport = (viewport: HTMLDivElement) => {
    viewportRef.current = viewport;
    // Trackpad pinch arrives as a ctrlKey wheel; plain wheels pan through native overflow scrolling.
    // React's onWheel is passive and cannot stop the browser's own page zoom.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      changeZoom(zoom * Math.exp(-delta * 0.01), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", wheel);
      viewportRef.current = null;
    };
  };

  return (
    <div className="relative min-w-0">
      <div
        ref={attachViewport}
        role="region"
        aria-label={gt("{name}, zoomable image", { name })}
        aria-description={gt(
          "Click to zoom in or return to fit. Pinch or Ctrl+scroll to zoom, scroll or drag to pan. Use Enter to toggle zoom, plus or minus to zoom, and 0 to fit.",
        )}
        tabIndex={0}
        className="max-w-[var(--media-width)] overflow-auto overscroll-contain rounded-lg bg-background shadow-2xl ring-1 ring-border/70 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
        style={{
          width: width || undefined,
          height: height || undefined,
          maxHeight,
          cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          touchAction: zoom <= 1 && onSwipeNavigate ? "pan-y pinch-zoom" : undefined,
        }}
        onClick={(event) => {
          // Pointer capture emits a click after dragging; preserve zoom.
          if (suppressClickRef.current || event.detail > 1) return;
          changeZoom(zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY }, { smooth: true });
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!event.repeat) changeZoom(zoom > 1 ? 1 : 2, undefined, { smooth: true });
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            changeZoom(zoom * 1.5, undefined, { smooth: true });
          } else if (event.key === "-") {
            event.preventDefault();
            changeZoom(zoom / 1.5, undefined, { smooth: true });
          } else if (event.key === "0") {
            event.preventDefault();
            changeZoom(1, undefined, { smooth: true });
          }
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") {
            activeTouchPointersRef.current.add(event.pointerId);
            if (activeTouchPointersRef.current.size > 1) {
              touchSwipeRef.current = null;
              return;
            }
            suppressClickRef.current = false;
            if (zoom > 1 || !onSwipeNavigate) return;
            touchSwipeRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              startTime: event.timeStamp || performance.now(),
              axis: null,
            };
            return;
          }
          if (dragRef.current) return;
          suppressClickRef.current = false;
          if (event.pointerType !== "mouse" || event.button !== 0 || zoom <= 1) return;
          const viewport = event.currentTarget;
          const bounds = viewport.getBoundingClientRect();
          if (
            event.clientX - bounds.left >= viewport.clientWidth ||
            event.clientY - bounds.top >= viewport.clientHeight
          )
            return;
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
          };
          viewport.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const swipe = touchSwipeRef.current;
          if (swipe && swipe.pointerId === event.pointerId) {
            const dx = event.clientX - swipe.startX;
            const dy = event.clientY - swipe.startY;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            if (swipe.axis === null && Math.hypot(dx, dy) >= SWIPE_LOCK_SLOP_PX) {
              if (absX > absY * SWIPE_HORIZONTAL_RATIO) {
                swipe.axis = "horizontal";
                suppressClickRef.current = true;
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Synthetic pointer events in tests may not provide a capturable pointerId.
                }
              } else {
                swipe.axis = "vertical";
              }
            }
            return;
          }
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
            suppressClickRef.current = true;
          }
          event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
          event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y);
        }}
        onPointerUp={(event) => {
          if (event.pointerType === "touch") {
            activeTouchPointersRef.current.delete(event.pointerId);
            const swipe = touchSwipeRef.current;
            if (!swipe || swipe.pointerId !== event.pointerId) return;
            touchSwipeRef.current = null;
            try {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            } catch {
              // Ignore synthetic capture release errors.
            }
            if (zoom > 1 || !onSwipeNavigate || swipe.axis === "vertical") return;
            const dx = event.clientX - swipe.startX;
            const dy = event.clientY - swipe.startY;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            const dt = Math.max(1, (event.timeStamp || performance.now()) - swipe.startTime);
            const isHorizontal = absX > absY * SWIPE_HORIZONTAL_RATIO;
            const isCommitted =
              absX >= SWIPE_COMMIT_DISTANCE_PX ||
              (absX >= SWIPE_FLICK_DISTANCE_PX && absX / dt >= SWIPE_FLICK_VELOCITY_PX_PER_MS);
            if (isHorizontal && isCommitted) {
              suppressClickRef.current = true;
              onSwipeNavigate(dx < 0 ? 1 : -1);
            }
            return;
          }
          if (dragRef.current?.pointerId !== event.pointerId) return;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={(event) => {
          if (event.pointerType === "touch") {
            activeTouchPointersRef.current.delete(event.pointerId);
            if (touchSwipeRef.current?.pointerId === event.pointerId) {
              touchSwipeRef.current = null;
              suppressClickRef.current = false;
            }
            return;
          }
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          suppressClickRef.current = false;
          setDragging(false);
        }}
        onLostPointerCapture={(event) => {
          if (event.target !== event.currentTarget) return;
          if (touchSwipeRef.current?.pointerId === event.pointerId) {
            activeTouchPointersRef.current.delete(event.pointerId);
            touchSwipeRef.current = null;
            suppressClickRef.current = false;
          }
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <div ref={imageWrapRef} className="origin-center">
          <AttachmentImage
            name={name}
            mimeType={mimeType}
            src={src}
            alt={name}
            draggable={false}
            className="block max-w-none select-none"
            style={
              naturalSize.width ? { width, height } : { maxWidth: "var(--media-width)", maxHeight }
            }
            onLoad={(event) => {
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            onError={onError}
          />
        </div>
      </div>
      <div
        aria-hidden="true"
        data-zoom-hud="true"
        data-visible={zoomHudVisible ? "true" : "false"}
        className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-black/80 px-2.5 py-0.5 font-medium text-xs text-white tabular-nums shadow-md"
      >
        {Math.round(zoom * 100)}%
      </div>
      <span className="sr-only" aria-live="polite">
        {gt("{percent}% zoom", { percent: Math.round(zoom * 100) })}
      </span>
    </div>
  );
}

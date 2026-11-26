import { useGT } from "gt-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import {
  Grid2x2Icon,
  MaximizeIcon,
  MinusIcon,
  MoonIcon,
  PlusIcon,
  ScanIcon,
  SunIcon,
} from "lucide-react";
import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { AttachmentImage } from "../media/AttachmentImage";
import { FileSurfaceAction, FileSurfaceFailure } from "./fileSurfaceChrome";

type StageBackdrop = "checkerboard" | "dark" | "light";

const STAGE_BACKDROP_CLASS: Record<StageBackdrop, string> = {
  checkerboard: "media-stage-checkerboard",
  dark: "media-stage-dark",
  light: "media-stage-light",
};

export default function PreviewImageContent(props: {
  readonly src: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly onError?: () => void;
}) {
  const gt = useGT();
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [backdrop, setBackdrop] = useState<StageBackdrop>("checkerboard");
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const zoomHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAnchorRef = useRef<{
    contentX: number;
    contentY: number;
    cursorX: number;
    cursorY: number;
  } | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressExpandClickRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clears the auto-fading zoom HUD timer on unmount.
  useEffect(
    () => () => {
      if (zoomHudTimerRef.current !== null) clearTimeout(zoomHudTimerRef.current);
    },
    [],
  );

  const revealZoomHud = () => {
    setZoomHudVisible(true);
    if (zoomHudTimerRef.current !== null) clearTimeout(zoomHudTimerRef.current);
    zoomHudTimerRef.current = setTimeout(() => {
      setZoomHudVisible(false);
      zoomHudTimerRef.current = null;
    }, 1100);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Measure the image viewport before paint and observe resizes to keep fit-to-view scaling accurate.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // clientWidth rounds a fractional pane size up, and an image fitted to it overflows the pane.
    // The computed size keeps the fraction; it reads "auto" while an ancestor is display:none.
    const update = () => {
      const size = getComputedStyle(node);
      setViewport({
        width: Math.floor(Number.parseFloat(size.width) || 0),
        height: Math.floor(Number.parseFloat(size.height) || 0),
      });
    };
    update();
    return observeResize(node, update);
  }, []);

  const fit = natural.width
    ? Math.min(
        1,
        Math.max(1, viewport.width - 32) / natural.width,
        Math.max(1, viewport.height - 32) / natural.height,
      )
    : 1;
  const scale = zoom ?? fit;

  const canPan =
    natural.width > 0 &&
    (natural.width * scale + 32 > viewport.width + 1 ||
      natural.height * scale + 32 > viewport.height + 1);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps Ctrl+wheel / pinch zoom anchored under the cursor after the scaled layout commits.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const node = ref.current;
    if (!anchor || !node) return;
    node.scrollLeft = Math.max(0, anchor.contentX * scale - anchor.cursorX);
    node.scrollTop = Math.max(0, anchor.contentY * scale - anchor.cursorY);
  }, [scale]);

  const handleWheelZoom = useEffectEvent((event: WheelEvent) => {
    const node = ref.current;
    if (!node || !(event.ctrlKey || event.metaKey) || !natural.width) return;
    event.preventDefault();
    const factor = Math.max(0.8, Math.min(1.25, Math.exp(-event.deltaY * 0.0025)));
    const nextScale = Math.max(0.05, Math.min(8, scale * factor));
    if (Math.abs(nextScale - scale) < 1e-4) return;
    const rect = node.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    zoomAnchorRef.current = {
      contentX: (node.scrollLeft + cursorX) / scale,
      contentY: (node.scrollTop + cursorY) / scale,
      cursorX,
      cursorY,
    };
    setZoom(nextScale);
    revealZoomHud();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Installs a non-passive wheel listener for cursor-anchored Ctrl+wheel and trackpad pinch zoom.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => handleWheelZoom(event);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const changeZoom = (factor: number) => {
    setZoom(Math.max(0.05, Math.min(8, scale * factor)));
    revealZoomHud();
  };
  if (failed) return <FileSurfaceFailure message={gt("Unable to load image.")} />;
  return (
    <>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-1 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {natural.width
            ? `${natural.width.toLocaleString()} × ${natural.height.toLocaleString()}`
            : gt("Loading image…")}
        </span>
        <div className="flex items-center gap-1">
          <FileSurfaceAction
            label={gt("Checkerboard backdrop")}
            pressed={backdrop === "checkerboard"}
            onPress={() => setBackdrop("checkerboard")}
          >
            <Grid2x2Icon className="size-3.5" />
          </FileSurfaceAction>
          <FileSurfaceAction
            label={gt("Dark backdrop")}
            pressed={backdrop === "dark"}
            onPress={() => setBackdrop("dark")}
          >
            <MoonIcon className="size-3.5" />
          </FileSurfaceAction>
          <FileSurfaceAction
            label={gt("Light backdrop")}
            pressed={backdrop === "light"}
            onPress={() => setBackdrop("light")}
          >
            <SunIcon className="size-3.5" />
          </FileSurfaceAction>
          <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border/60" />
          <FileSurfaceAction
            label={gt("Zoom out")}
            disabled={!natural.width || scale <= 0.05}
            onPress={() => changeZoom(1 / 1.25)}
          >
            <MinusIcon className="size-3.5" />
          </FileSurfaceAction>
          <span className="min-w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <FileSurfaceAction
            label={gt("Zoom in")}
            disabled={!natural.width || scale >= 8}
            onPress={() => changeZoom(1.25)}
          >
            <PlusIcon className="size-3.5" />
          </FileSurfaceAction>
          <FileSurfaceAction
            label={gt("Fit image")}
            pressed={zoom === null}
            onPress={() => {
              setZoom(null);
              revealZoomHud();
            }}
          >
            <ScanIcon className="size-3.5" />
          </FileSurfaceAction>
          <FileSurfaceAction
            label={gt("Actual image size")}
            pressed={zoom === 1}
            onPress={() => {
              setZoom(1);
              revealZoomHud();
            }}
          >
            <MaximizeIcon className="size-3.5" />
          </FileSurfaceAction>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={ref}
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            STAGE_BACKDROP_CLASS[backdrop],
            canPan && "media-stage-pannable cursor-grab",
          )}
          onPointerDown={(event) => {
            if (!canPan || event.button !== 0) return;
            const node = ref.current;
            if (!node) return;
            panStateRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              startScrollLeft: node.scrollLeft,
              startScrollTop: node.scrollTop,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const pan = panStateRef.current;
            const node = ref.current;
            if (!pan || !node || pan.pointerId !== event.pointerId) return;
            const dx = event.clientX - pan.startX;
            const dy = event.clientY - pan.startY;
            if (!pan.moved && Math.hypot(dx, dy) > 4) {
              pan.moved = true;
              node.setPointerCapture(event.pointerId);
              node.setAttribute("data-panning", "true");
            }
            if (!pan.moved) return;
            event.preventDefault();
            node.scrollLeft = pan.startScrollLeft - dx;
            node.scrollTop = pan.startScrollTop - dy;
          }}
          onPointerUp={(event) => {
            const pan = panStateRef.current;
            const node = ref.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            panStateRef.current = null;
            if (pan.moved) {
              suppressExpandClickRef.current = true;
              node?.removeAttribute("data-panning");
              if (node?.hasPointerCapture(event.pointerId)) {
                node.releasePointerCapture(event.pointerId);
              }
            }
          }}
          onPointerCancel={(event) => {
            const pan = panStateRef.current;
            const node = ref.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            panStateRef.current = null;
            node?.removeAttribute("data-panning");
            if (node?.hasPointerCapture(event.pointerId)) {
              node.releasePointerCapture(event.pointerId);
            }
          }}
        >
          <div
            className="flex min-h-full min-w-full items-center justify-center p-4"
            style={{
              width: natural.width ? natural.width * scale + 32 : undefined,
              height: natural.height ? natural.height * scale + 32 : undefined,
            }}
          >
            <button
              type="button"
              aria-label={gt("Zoom {name}", { name: props.name })}
              className={cn("shrink-0", canPan ? "cursor-grab" : "cursor-zoom-in")}
              onClick={() => {
                if (suppressExpandClickRef.current) {
                  suppressExpandClickRef.current = false;
                  return;
                }
                setExpanded(true);
              }}
            >
              <AttachmentImage
                name={props.name}
                mimeType={props.mimeType}
                src={props.src}
                alt={props.name}
                draggable={false}
                className="block max-w-none select-none"
                // A cached image has its natural size before onLoad runs, so it stays at 0x0 until the
                // fit scale is known instead of painting at full size for a frame.
                style={
                  natural.width
                    ? { width: natural.width * scale, height: natural.height * scale }
                    : { width: 0, height: 0 }
                }
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => {
                  setFailed(true);
                  props.onError?.();
                }}
              />
            </button>
          </div>
        </div>
        <div
          aria-live="polite"
          data-visible={zoomHudVisible ? "true" : "false"}
          className="doc-scrub-hud surface-optical-chrome surface-elevated-rim pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full px-2.5 py-1 text-2xs font-medium text-foreground tabular-nums"
        >
          {`${Math.round(scale * 100)}%`}
        </div>
      </div>
      {expanded ? (
        <ExpandedImageDialog
          preview={{
            images: [
              {
                src: props.src,
                name: props.name,
                ...(props.mimeType ? { mimeType: props.mimeType } : {}),
              },
            ],
            index: 0,
          }}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </>
  );
}

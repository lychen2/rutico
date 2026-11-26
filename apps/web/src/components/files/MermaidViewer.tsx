import { T, useGT } from "gt-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Grid2x2Icon, MinusIcon, MoonIcon, PlusIcon, RotateCcwIcon, SunIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { MermaidDiagram } from "../chat/MermaidDiagram";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { FileSurfaceAction } from "./fileSurfaceChrome";

type MermaidBackdrop = "checkerboard" | "dark" | "light";

const MERMAID_BACKDROP_CLASS: Record<MermaidBackdrop, string> = {
  checkerboard: "media-stage-checkerboard",
  dark: "media-stage-dark",
  light: "media-stage-light",
};

export default function MermaidViewer(props: { readonly text: string }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<MermaidBackdrop>("checkerboard");
  const [zoom, setZoom] = useState(1);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const zoomHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clears the auto-fading Mermaid zoom HUD timer on unmount.
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

  const handleWheelZoom = useEffectEvent((event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const factor = Math.max(0.82, Math.min(1.22, Math.exp(-event.deltaY * 0.0025)));
    setZoom((current) => Math.max(0.4, Math.min(3, current * factor)));
    revealZoomHud();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Installs a non-passive wheel listener for Ctrl+wheel and trackpad pinch zoom on the diagram stage.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => handleWheelZoom(event);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  // Mermaid lays out DOM before sanitizing its SVG. Refuse resource and config
  // syntax before that pass so standalone files cannot initiate requests. Node
  // metadata is YAML, whose escaped/aliased image keys cannot be checked lexically.
  if (
    /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file):/im.test(
      props.text,
    )
  )
    return (
      <div role="alert" className="p-6 text-xs text-muted-foreground">
        <T>
          This diagram contains resource URLs, markup, node metadata, or custom configuration. Show
          Mermaid source to inspect it safely.
        </T>
      </div>
    );

  const stepZoom = (factor: number) => {
    setZoom((current) => Math.max(0.4, Math.min(3, current * factor)));
    revealZoomHud();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-end gap-1 border-b border-border/60 px-3 py-1 text-xs text-muted-foreground">
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
          disabled={zoom <= 0.4}
          onPress={() => stepZoom(1 / 1.2)}
        >
          <MinusIcon className="size-3.5" />
        </FileSurfaceAction>
        <span className="min-w-10 text-center tabular-nums">{`${Math.round(zoom * 100)}%`}</span>
        <FileSurfaceAction label={gt("Zoom in")} disabled={zoom >= 3} onPress={() => stepZoom(1.2)}>
          <PlusIcon className="size-3.5" />
        </FileSurfaceAction>
        <FileSurfaceAction
          label={gt("Reset zoom")}
          disabled={zoom === 1}
          onPress={() => {
            setZoom(1);
            revealZoomHud();
          }}
        >
          <RotateCcwIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          className={cn(
            "scrollbar-gutter-both min-h-0 flex-1 overflow-auto p-6 [&_*]:animate-none!",
            MERMAID_BACKDROP_CLASS[backdrop],
          )}
        >
          <div
            data-slot="mermaid-diagram-stage"
            className="origin-top-left"
            style={zoom === 1 ? undefined : { zoom }}
          >
            <MermaidDiagram source={props.text} onExpand={setExpanded} />
          </div>
          {expanded ? (
            <ExpandedImageDialog
              preview={{ images: [{ src: expanded, name: gt("Mermaid diagram") }], index: 0 }}
              onClose={() => setExpanded(null)}
            />
          ) : null}
        </div>
        <div
          aria-live="polite"
          data-visible={zoomHudVisible ? "true" : "false"}
          className="doc-scrub-hud surface-optical-chrome surface-elevated-rim pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full px-2.5 py-1 text-2xs font-medium text-foreground tabular-nums"
        >
          {`${Math.round(zoom * 100)}%`}
        </div>
      </div>
    </div>
  );
}

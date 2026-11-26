import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";
import { T } from "gt-react";
import { MousePointer2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { cn } from "~/lib/utils";

import {
  agentBrowserCursorOpacity,
  computeAgentCursorTiltDeg,
  type BrowserController,
} from "./agentBrowserCursorLogic";

const CURSOR_ACTIVE_MS = 700;

export function AgentBrowserCursor(props: {
  readonly tabId: string;
  readonly zoomFactor: number;
  readonly controller: BrowserController;
}) {
  const { tabId, zoomFactor, controller } = props;
  const event = useBrowserPointerStore((state) => state.byTabId[tabId] ?? null);
  const content = useBrowserSurfaceStore((state) => state.byTabId[tabId]?.content ?? null);

  if (!event) return null;

  return (
    <AgentBrowserCursorEvent
      event={event}
      content={content}
      zoomFactor={zoomFactor}
      controller={controller}
    />
  );
}

function AgentBrowserCursorEvent(props: {
  readonly event: DesktopPreviewPointerEvent;
  readonly content: {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly scrollLeft: number;
    readonly scrollTop: number;
  } | null;
  readonly zoomFactor: number;
  readonly controller: BrowserController;
}) {
  const { event, content, zoomFactor, controller } = props;
  const scale = zoomFactor * (content?.scale ?? 1);
  return (
    <AgentCursorMark
      phase={event.phase}
      sequence={event.sequence}
      left={event.x * scale + (content?.x ?? 0) - (content?.scrollLeft ?? 0)}
      top={event.y * scale + (content?.y ?? 0) - (content?.scrollTop ?? 0)}
      controller={controller}
    />
  );
}

export function AgentCursorMark(props: {
  readonly phase: "move" | "click";
  readonly sequence: number;
  readonly left: number;
  readonly top: number;
  readonly controller: BrowserController;
}) {
  const { phase, sequence, left, top, controller } = props;
  const [inactiveSequence, setInactiveSequence] = useState<number | null>(null);
  const [trajectory, setTrajectory] = useState(() => ({
    sequence,
    left,
    tiltDeg: 0,
  }));
  if (trajectory.sequence !== sequence) {
    setTrajectory({
      sequence,
      left,
      tiltDeg: computeAgentCursorTiltDeg(left - trajectory.left),
    });
  }
  const active = inactiveSequence !== sequence;
  const appliedTilt = active ? trajectory.tiltDeg : 0;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer fades the agent cursor after each move or click
  useEffect(() => {
    const timeout = window.setTimeout(() => setInactiveSequence(sequence), CURSOR_ACTIVE_MS);
    return () => window.clearTimeout(timeout);
  }, [sequence]);

  return (
    <div
      className="agent-cursor-track pointer-events-none absolute top-0 left-0 z-40 will-change-transform motion-reduce:transition-none"
      style={{
        opacity: agentBrowserCursorOpacity(active, controller),
        transform: `translate3d(${left}px, ${top}px, 0) rotate(${appliedTilt.toFixed(1)}deg)`,
      }}
      aria-hidden="true"
      data-agent-browser-cursor
      data-agent-cursor-phase={phase}
    >
      {phase === "click" ? (
        <span key={sequence} className="pointer-events-none absolute top-0 left-0">
          <span className="agent-cursor-shockwave-outer absolute -top-2.5 -left-2.5 size-5 rounded-full border border-primary/80" />
          <span className="agent-cursor-shockwave-inner absolute -top-1.5 -left-1.5 size-3 rounded-full bg-primary/30 ring-1 ring-primary/70" />
        </span>
      ) : null}
      <span
        key={phase === "click" ? `click-${sequence}` : "move"}
        className={cn(
          "relative block origin-top-left",
          phase === "click" && active && "agent-cursor-click-press",
        )}
      >
        <MousePointer2 className="relative size-5 -translate-x-0.5 -translate-y-0.5 fill-primary stroke-2 text-primary-foreground drop-shadow-sm" />
      </span>
      <span
        data-active={active ? "true" : "false"}
        className={cn(
          "agent-cursor-pill surface-optical-chrome surface-elevated-rim pointer-events-none absolute top-3.5 left-3.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs font-medium tracking-tight text-foreground",
          active ? "opacity-100 scale-100" : "opacity-0 scale-90",
        )}
      >
        <span className="size-1.5 rounded-full bg-primary" />
        <span>
          <T>Agent</T>
        </span>
      </span>
    </div>
  );
}

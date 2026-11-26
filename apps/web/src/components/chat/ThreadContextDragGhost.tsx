import { MessagesSquareIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { computeDragFlightTiltDeg } from "~/components/files/fileTreeDragMention";
import { prefersReducedMotion } from "~/lib/motion/springs";
import { useThreadContextDragGhost } from "./threadContextDrag";

export function ThreadContextDragGhost() {
  const ghost = useThreadContextDragGhost();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const physicsRef = useRef<{
    targetX: number;
    targetY: number;
    lastX: number;
    velocityX: number;
    rafId: number | null;
    initialized: boolean;
  }>({
    targetX: 0,
    targetY: 0,
    lastX: 0,
    velocityX: 0,
    rafId: null,
    initialized: false,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives imperative velocity-tilted GPU transform on the drag ghost leaf element
  useEffect(() => {
    const physics = physicsRef.current;
    if (ghost === null) {
      if (physics.rafId !== null) {
        window.cancelAnimationFrame(physics.rafId);
        physics.rafId = null;
      }
      physics.initialized = false;
      physics.velocityX = 0;
      return;
    }

    if (!physics.initialized) {
      physics.initialized = true;
      physics.targetX = ghost.x;
      physics.targetY = ghost.y;
      physics.lastX = ghost.x;
      physics.velocityX = 0;
    } else {
      physics.targetX = ghost.x;
      physics.targetY = ghost.y;
    }

    const tick = () => {
      physics.rafId = null;
      const el = rootRef.current;
      if (!el) return;
      const dx = physics.targetX - physics.lastX;
      physics.lastX = physics.targetX;
      physics.velocityX = physics.velocityX * 0.72 + dx * 0.65;
      const tiltDeg = prefersReducedMotion() ? 0 : computeDragFlightTiltDeg(physics.velocityX);
      const tx = Math.round(physics.targetX + 12);
      const ty = Math.round(physics.targetY + 12);
      el.style.transform =
        tiltDeg === 0
          ? `translate3d(${tx}px, ${ty}px, 0)`
          : `translate3d(${tx}px, ${ty}px, 0) rotate(${tiltDeg.toFixed(2)}deg)`;

      if (Math.abs(physics.velocityX) > 0.08 && !prefersReducedMotion()) {
        physics.rafId = window.requestAnimationFrame(tick);
      }
    };

    if (physics.rafId === null) {
      physics.rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (physics.rafId !== null) {
        window.cancelAnimationFrame(physics.rafId);
        physics.rafId = null;
      }
    };
  }, [ghost]);

  if (ghost === null) return null;
  return createPortal(
    <div
      ref={rootRef}
      aria-hidden="true"
      data-slot="thread-context-drag-ghost"
      className="pointer-events-none fixed top-0 left-0 z-100 will-change-transform"
      style={{
        transform: `translate3d(${Math.round(ghost.x + 12)}px, ${Math.round(ghost.y + 12)}px, 0)`,
      }}
    >
      <div className="drag-flight-card relative">
        {ghost.count >= 3 ? (
          <div className="drag-flight-stack-card-2 pointer-events-none absolute inset-0 rounded-lg border border-border/75 bg-popover shadow-sm" />
        ) : null}
        {ghost.count >= 2 ? (
          <div className="drag-flight-stack-card-1 pointer-events-none absolute inset-0 rounded-lg border border-border/80 bg-popover shadow-md" />
        ) : null}
        <div className="surface-optical-chrome surface-elevated-rim relative flex max-w-72 items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <MessagesSquareIcon className="size-4 shrink-0 text-secondary-label" />
          <span className="truncate">{ghost.title}</span>
          {ghost.count > 1 ? (
            <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 font-mono text-2xs font-medium tabular-nums text-primary-foreground">
              +{ghost.count - 1}
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { type PointerEvent, useState } from "react";

export interface ResizeBounds {
  readonly min: number;
  readonly max: number;
}

interface ResizeDragMeta {
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
}

interface ResizeSession {
  width: number;
  edge: "left" | "right";
  /** Pointer widths are clamped to these before `resize` sees them. */
  bounds: ResizeBounds;
  resize: (width: number, meta: ResizeDragMeta) => number;
  finish: (width: number, moved: boolean) => void;
  cleanup?: (committed: boolean) => void;
}

function clampToBounds(width: number, bounds: ResizeBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, width));
}

interface ActiveDrag<T extends HTMLElement> {
  session: ResizeSession;
  target: T;
  pointerId: number;
  startX: number;
  pendingX: number;
  pendingY: number;
  altKey: boolean;
  width: number;
  moved: boolean;
  frame: number | null;
  onBlur: () => void;
  onKeyChange: (event: KeyboardEvent) => void;
}

function createResizeDrag<T extends HTMLElement>() {
  let drag: ActiveDrag<T> | null = null;

  const flush = () => {
    const active = drag;
    if (!active) return;
    const delta = (active.pendingX - active.startX) * (active.session.edge === "left" ? -1 : 1);
    if (Math.abs(delta) > 2) active.moved = true;
    active.width = active.session.resize(
      clampToBounds(active.session.width + delta, active.session.bounds),
      {
        clientX: active.pendingX,
        clientY: active.pendingY,
        altKey: active.altKey,
      },
    );
  };

  const scheduleFlush = (active: ActiveDrag<T>) => {
    if (active.frame !== null) return;
    active.frame = requestAnimationFrame(() => {
      active.frame = null;
      flush();
    });
  };

  const finish = (commit: boolean) => {
    const active = drag;
    if (!active) return;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    window.removeEventListener("blur", active.onBlur);
    window.removeEventListener("keydown", active.onKeyChange);
    window.removeEventListener("keyup", active.onKeyChange);
    if (commit) flush();
    // Release can synchronously dispatch lostpointercapture.
    drag = null;
    try {
      if (active.target.hasPointerCapture(active.pointerId)) {
        active.target.releasePointerCapture(active.pointerId);
      }
    } catch {}
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    active.session.cleanup?.(commit);
    if (commit) active.session.finish(active.width, active.moved);
  };

  const end = (event: PointerEvent<T>, usePosition: boolean) => {
    const active = drag;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (usePosition) {
      active.pendingX = event.clientX;
      active.pendingY = event.clientY;
      active.altKey = event.altKey;
    }
    finish(true);
  };

  return {
    ref: (node: T | null) => (node === null ? undefined : () => finish(false)),
    cancel: () => finish(false),
    refresh(bounds?: ResizeBounds) {
      if (!drag) return;
      if (bounds) drag.session.bounds = bounds;
      flush();
    },
    begin(event: PointerEvent<T>, start: (event: PointerEvent<T>) => ResizeSession | null) {
      if (event.button !== 0 || drag) return;
      const session = start(event);
      if (!session) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        session.cleanup?.(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Leaving the window mid-drag commits where the pointer was.
      const onBlur = () => finish(true);
      const onKeyChange = (keyEvent: KeyboardEvent) => {
        if (!drag || keyEvent.key !== "Alt") return;
        const nextAlt = keyEvent.type === "keydown" ? true : keyEvent.altKey;
        if (drag.altKey === nextAlt) return;
        drag.altKey = nextAlt;
        scheduleFlush(drag);
      };
      window.addEventListener("blur", onBlur);
      window.addEventListener("keydown", onKeyChange);
      window.addEventListener("keyup", onKeyChange);
      drag = {
        session,
        target: event.currentTarget,
        pointerId: event.pointerId,
        startX: event.clientX,
        pendingX: event.clientX,
        pendingY: event.clientY,
        altKey: event.altKey,
        width: session.width,
        moved: false,
        frame: null,
        onBlur,
        onKeyChange,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    onPointerMove(event: PointerEvent<T>) {
      const active = drag;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      active.pendingX = event.clientX;
      active.pendingY = event.clientY;
      active.altKey = event.altKey;
      if (Math.abs(event.clientX - active.startX) > 2) active.moved = true;
      scheduleFlush(active);
    },
    onPointerUp: (event: PointerEvent<T>) => end(event, true),
    onPointerCancel: (event: PointerEvent<T>) => end(event, false),
    onLostPointerCapture: (event: PointerEvent<T>) => end(event, false),
  };
}

/**
 * A pointer drag that resizes along one edge. The session `start` returns owns
 * everything the drag needs, so options read at pointer-down hold for the whole
 * drag. Attach `ref` to the handle so unmounting it abandons the drag.
 */
export function useResizeDrag<T extends HTMLElement>(
  start: (event: PointerEvent<T>) => ResizeSession | null,
) {
  // Created once: `ref` must keep its identity, or a re-render mid-drag would run its cleanup.
  const [drag] = useState(createResizeDrag<T>);
  const { begin, ...rest } = drag;
  return { ...rest, onPointerDown: (event: PointerEvent<T>) => begin(event, start) };
}

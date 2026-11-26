import { type CSSProperties, useEffect, useRef } from "react";

import { prefersReducedMotion } from "~/lib/motion/springs";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

// Enforced inline so unstyled mounts (without Tailwind utilities) never intercept pointer hit-testing.
const FLOATING_HIGHLIGHT_STYLE: CSSProperties = {
  pointerEvents: "none",
  position: "absolute",
  top: 0,
  left: 0,
  zIndex: 0,
};

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface RectBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function crossProductSign(p1: Point2D, p2: Point2D, p3: Point2D): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

/**
 * Kubai087 Tip 002 safe-triangle test: returns true when `point` falls inside
 * the prediction cone from `apex` to the near edge of `targetRect`.
 */
export function isPointInSafeTriangle(
  point: Point2D,
  apex: Point2D,
  targetRect: RectBounds,
  marginPx = 8,
): boolean {
  const expandedTop = targetRect.top - marginPx;
  const expandedBottom = targetRect.bottom + marginPx;
  const isRightOfApex = targetRect.left >= apex.x;
  const edgeX = isRightOfApex ? targetRect.left : targetRect.right;

  const v1: Point2D = apex;
  const v2: Point2D = { x: edgeX, y: expandedTop };
  const v3: Point2D = { x: edgeX, y: expandedBottom };

  const d1 = crossProductSign(point, v1, v2);
  const d2 = crossProductSign(point, v2, v3);
  const d3 = crossProductSign(point, v3, v1);

  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Shared GPU-composited sliding highlight plate for Menu, Select, Combobox, and Autocomplete.
 * Observes `[data-highlighted]` mutations on sibling items inside its relative parent container
 * without re-rendering React or touching Base UI's Positioner transform.
 */
export function FloatingHighlight({
  className,
  itemSelector = "[data-highlighted]",
}: {
  readonly className?: string;
  readonly itemSelector?: string;
}) {
  const plateRef = useRef<HTMLDivElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks [data-highlighted] DOM mutations to glide a GPU highlight plate
  useEffect(() => {
    const plate = plateRef.current;
    const container = plate?.parentElement;
    if (!plate || !container) return;

    let hasPositioned = false;

    const sync = (allowMotion: boolean) => {
      const highlighted = container.querySelector<HTMLElement>(itemSelector);
      if (!highlighted || !container.contains(highlighted)) {
        plate.style.opacity = "0";
        plate.dataset.active = "false";
        hasPositioned = false;
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const itemRect = highlighted.getBoundingClientRect();
      if (itemRect.width <= 0 || itemRect.height <= 0) return;

      const x = itemRect.left - containerRect.left + container.scrollLeft;
      const y = itemRect.top - containerRect.top + container.scrollTop;
      const win = container.ownerDocument.defaultView ?? globalThis.window;
      const instant = !allowMotion || !hasPositioned || prefersReducedMotion(win);

      plate.style.transition = instant
        ? "opacity 100ms ease-out"
        : "transform 150ms var(--spring-snappy), width 150ms var(--spring-snappy), height 150ms var(--spring-snappy), opacity 100ms ease-out";
      plate.style.width = `${itemRect.width}px`;
      plate.style.height = `${itemRect.height}px`;
      plate.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      plate.style.opacity = "1";
      plate.dataset.active = "true";
      hasPositioned = true;
    };

    sync(false);

    const mutationObserver = new MutationObserver(() => {
      sync(true);
    });
    mutationObserver.observe(container, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ["data-highlighted", "data-popup-open"],
    });

    const stopResize = observeResize(container, () => sync(false));

    return () => {
      mutationObserver.disconnect();
      stopResize();
    };
  }, [itemSelector]);

  return (
    <div
      ref={plateRef}
      aria-hidden="true"
      inert
      data-slot="floating-highlight"
      data-active="false"
      style={FLOATING_HIGHLIGHT_STYLE}
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-0 rounded-(--radius-concentric-menu-inner) bg-accent opacity-0 will-change-transform",
        className,
      )}
    />
  );
}

import {
  resolveTimelineMinimapPreview,
  type TimelineMinimapItem,
  type TimelineMinimapSemantic,
} from "./timelineMinimapItems";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useGT } from "gt-react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapNavigationInteractive,
  resolveTimelineMinimapTopPercent,
  TIMELINE_MINIMAP_MIN_ITEMS,
} from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

const ARRIVAL_HIGHLIGHT_DURATION_MS = 600;
const ARRIVAL_HIGHLIGHT_ATTR = "data-timeline-arrival-highlight";
/** Kubai087 Tip 025: suppress accidental hover card reveal during fast gutter sweeps. */
const MINIMAP_HOVER_VELOCITY_THRESHOLD_PX_PER_MS = 0.1;
const MINIMAP_HOVER_SETTLE_DELAY_MS = 90;
const MINIMAP_SCRUB_THRESHOLD_PX = 3;
const MINIMAP_BASE_STRIP_SCALE = 0.333;
const MINIMAP_FISHEYE_RADIUS = 3.2;

let activeArrivalHighlight: { element: HTMLElement; animation: Animation } | null = null;

function isRowVisibleInViewport(row: HTMLElement, viewport: HTMLElement | null): boolean {
  if (!viewport) return true;
  const viewportRect = viewport.getBoundingClientRect();
  if (viewportRect.height === 0) return true;
  const rowRect = row.getBoundingClientRect();
  return rowRect.bottom > viewportRect.top && rowRect.top < viewportRect.bottom;
}

function pulseTimelineTargetRow(element: HTMLElement): void {
  if (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof element.animate !== "function"
  ) {
    return;
  }
  if (activeArrivalHighlight) {
    const previous = activeArrivalHighlight;
    activeArrivalHighlight = null;
    previous.element.removeAttribute(ARRIVAL_HIGHLIGHT_ATTR);
    previous.animation.cancel();
  }
  element.setAttribute(ARRIVAL_HIGHLIGHT_ATTR, "true");
  const animation = element.animate(
    [
      {
        backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--primary) 20%, transparent)",
        borderRadius: "12px",
      },
      {
        backgroundColor: "color-mix(in srgb, var(--primary) 7%, transparent)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--primary) 14%, transparent)",
        borderRadius: "12px",
        offset: 0.25,
      },
      {
        backgroundColor: "transparent",
        boxShadow: "inset 0 0 0 1px transparent",
        borderRadius: "12px",
      },
    ],
    {
      duration: ARRIVAL_HIGHLIGHT_DURATION_MS,
      easing: "ease-out",
    },
  );
  const current = { element, animation };
  activeArrivalHighlight = current;
  const clear = () => {
    element.removeAttribute(ARRIVAL_HIGHLIGHT_ATTR);
    if (activeArrivalHighlight === current) {
      activeArrivalHighlight = null;
    }
  };
  animation.addEventListener("finish", clear, { once: true });
  animation.addEventListener("cancel", clear, { once: true });
}

export function scheduleTimelineTargetHighlight(
  findTarget: () => HTMLElement | "skip" | null,
  maxFrames = 30,
): () => void {
  if (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return () => {};
  }
  let cancelled = false;
  let frameId: number | null = null;
  let attempts = 0;

  const probe = () => {
    frameId = null;
    if (cancelled) return;
    const target = findTarget();
    if (target === "skip") return;
    if (target?.isConnected) {
      pulseTimelineTargetRow(target);
      return;
    }
    attempts += 1;
    if (attempts < maxFrames) {
      frameId = requestAnimationFrame(probe);
    }
  };

  frameId = requestAnimationFrame(probe);
  return () => {
    cancelled = true;
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}

export function isTimelineRowVisibleInViewport(
  row: HTMLElement,
  viewport: HTMLElement | null,
): boolean {
  return isRowVisibleInViewport(row, viewport);
}

// A release outside the window can skip `mouseup`, so the next button-free
// `mousemove` also counts.
function onMouseButtonsReleased(onRelease: () => void): () => void {
  const check = (event: globalThis.MouseEvent) => {
    if (event.buttons !== 0) return;
    stop();
    onRelease();
  };
  const stop = () => {
    window.removeEventListener("mouseup", check);
    window.removeEventListener("mousemove", check);
  };
  window.addEventListener("mouseup", check);
  window.addEventListener("mousemove", check);
  return stop;
}

function readEventTimestamp(timeStamp: number): number {
  return timeStamp || performance.now();
}

function computeFisheyeScale(distance: number, scrubbing: boolean): number {
  if (distance >= MINIMAP_FISHEYE_RADIUS) return MINIMAP_BASE_STRIP_SCALE;
  const peak = scrubbing ? 1.1 : 1;
  const bell = Math.exp(-0.58 * distance * distance);
  return MINIMAP_BASE_STRIP_SCALE + (peak - MINIMAP_BASE_STRIP_SCALE) * bell;
}

function semanticMarkerLabel(
  semantic: TimelineMinimapSemantic | null | undefined,
  gt: ReturnType<typeof useGT>,
): string {
  if (semantic === "plan") return gt("Plan");
  if (semantic === "error") return gt("Error");
  if (semantic === "fork") return gt("Branch");
  return "";
}

export function TimelineMinimap({
  hasPersistentGutter,
  hitStrip: { left: hitStripLeft, width: hitStripWidth },
  currentIndex,
  atEnd,
  items,
  stripMap,
  onWheel,
  onSelect,
  onScrub,
}: {
  hasPersistentGutter: boolean;
  hitStrip: { left: number; width: number };
  currentIndex: number | null;
  atEnd: boolean;
  items: ReadonlyArray<TimelineMinimapItem>;
  stripMap: Map<string, HTMLSpanElement>;
  onWheel: (event: WheelEvent) => void;
  onSelect: (item: TimelineMinimapItem) => void;
  onScrub?: (item: TimelineMinimapItem) => void;
}) {
  const gt = useGT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLSpanElement | null>(null);
  const cardTurnRef = useRef<HTMLSpanElement | null>(null);
  const cardSemanticRef = useRef<HTMLSpanElement | null>(null);
  const cardUserRef = useRef<HTMLSpanElement | null>(null);
  const cardAssistantRef = useRef<HTMLSpanElement | null>(null);
  const stripNodesRef = useRef<Map<number, HTMLSpanElement>>(new Map());
  const activeIndexRef = useRef<number | null>(null);
  const cardVisibleRef = useRef(false);
  const hoverSettleTimerRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; timeStamp: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    scrubbing: boolean;
    railRect: DOMRect;
    lastScrubId: string | null;
  } | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubItemRef = useRef<TimelineMinimapItem | null>(null);
  const suppressNextClickRef = useRef(false);
  const pendingHighlightCleanupRef = useRef<(() => void) | null>(null);
  const wheelTargetRef = (node: HTMLDivElement | null) => {
    if (!node) return;
    rootRef.current = node;
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      pendingHighlightCleanupRef.current?.();
      pendingHighlightCleanupRef.current = null;
      if (rootRef.current === node) {
        rootRef.current = null;
      }
    };
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels hover settle timer and rAF scrub handle on unmount
  useEffect(() => {
    return () => {
      if (hoverSettleTimerRef.current !== null) {
        window.clearTimeout(hoverSettleTimerRef.current);
        hoverSettleTimerRef.current = null;
      }
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
    };
  }, []);

  const clearHoverSettleTimer = () => {
    if (hoverSettleTimerRef.current !== null) {
      window.clearTimeout(hoverSettleTimerRef.current);
      hoverSettleTimerRef.current = null;
    }
  };

  const touchedStripsRef = useRef<Set<number>>(new Set());
  const cachedPreviewRef = useRef<{
    item: TimelineMinimapItem;
    preview: ReturnType<typeof resolveTimelineMinimapPreview>;
  } | null>(null);

  const resetStripsDirectDom = () => {
    const baseTransform = `translateY(-50%) scaleX(${MINIMAP_BASE_STRIP_SCALE})`;
    for (const stripIndex of touchedStripsRef.current) {
      const strip = stripNodesRef.current.get(stripIndex);
      if (!strip) continue;
      strip.style.transform = baseTransform;
      strip.dataset.minimapActive = "false";
    }
    touchedStripsRef.current.clear();
  };

  const hidePreviewDirectDom = () => {
    clearHoverSettleTimer();
    activeIndexRef.current = null;
    cardVisibleRef.current = false;
    lastPointerRef.current = null;
    resetStripsDirectDom();
    const card = cardRef.current;
    if (card) {
      card.dataset.minimapPreviewVisible = "false";
      card.dataset.minimapScrubbing = "false";
    }
    if (rootRef.current) {
      rootRef.current.dataset.minimapScrubbing = "false";
    }
    if (railButtonRef.current) {
      railButtonRef.current.setAttribute(
        "aria-label",
        gt("Jump to message: {text}", { text: gt("User message") }),
      );
    }
  };

  const applyFocusDirectDom = (
    discreteIndex: number,
    continuousIndex: number,
    options: {
      readonly showCard: boolean;
      readonly scrubbing: boolean;
      readonly railHeight: number;
    },
  ) => {
    const item = items[discreteIndex];
    if (!item) return;

    const prevDiscreteIndex = activeIndexRef.current;
    activeIndexRef.current = discreteIndex;

    // Only touch strips inside the old or new fisheye neighborhood instead of every turn strip.
    const minIndex = Math.max(0, Math.floor(continuousIndex - MINIMAP_FISHEYE_RADIUS));
    const maxIndex = Math.min(
      items.length - 1,
      Math.ceil(continuousIndex + MINIMAP_FISHEYE_RADIUS),
    );
    const baseTransform = `translateY(-50%) scaleX(${MINIMAP_BASE_STRIP_SCALE})`;
    const nextTouched = new Set<number>();

    for (const stripIndex of touchedStripsRef.current) {
      if (stripIndex < minIndex || stripIndex > maxIndex) {
        const strip = stripNodesRef.current.get(stripIndex);
        if (strip) {
          strip.style.transform = baseTransform;
          strip.dataset.minimapActive = "false";
        }
      }
    }

    for (let stripIndex = minIndex; stripIndex <= maxIndex; stripIndex += 1) {
      const strip = stripNodesRef.current.get(stripIndex);
      if (!strip) continue;
      const distance = Math.abs(stripIndex - continuousIndex);
      const scale = computeFisheyeScale(distance, options.scrubbing);
      strip.style.transform = `translateY(-50%) scaleX(${scale.toFixed(3)})`;
      strip.dataset.minimapActive = stripIndex === discreteIndex ? "true" : "false";
      if (distance < MINIMAP_FISHEYE_RADIUS || stripIndex === discreteIndex) {
        nextTouched.add(stripIndex);
      }
    }
    touchedStripsRef.current = nextTouched;

    // Defer Markdown preview parsing during fast sweeps when the card is hidden.
    if (!options.showCard && prevDiscreteIndex === discreteIndex) return;
    let preview: ReturnType<typeof resolveTimelineMinimapPreview>;
    if (cachedPreviewRef.current?.item === item) {
      preview = cachedPreviewRef.current.preview;
    } else if (options.showCard) {
      preview = resolveTimelineMinimapPreview(item);
      cachedPreviewRef.current = { item, preview };
    } else {
      preview = null;
    }
    const userLabel = preview?.userText ?? gt("User message");
    if (railButtonRef.current && options.showCard) {
      railButtonRef.current.setAttribute(
        "aria-label",
        gt("Jump to message: {text}", { text: userLabel }),
      );
    }

    const card = cardRef.current;
    if (!card) return;
    if (options.showCard) {
      const topPercent = resolveTimelineMinimapTopPercent(discreteIndex, items.length);
      const yPx = options.railHeight > 0 ? (topPercent / 100) * options.railHeight : 0;
      card.style.transform = `translate3d(0, ${yPx.toFixed(1)}px, 0) translateY(-50%)`;
      card.dataset.minimapPreviewVisible = "true";
      card.dataset.minimapScrubbing = options.scrubbing ? "true" : "false";
      cardVisibleRef.current = true;
      if (cardTurnRef.current) {
        cardTurnRef.current.textContent = gt("Turn {current} / {total}", {
          current: discreteIndex + 1,
          total: items.length,
        });
      }
      if (cardSemanticRef.current) {
        const badgeText = semanticMarkerLabel(item.semantic, gt);
        cardSemanticRef.current.textContent = badgeText;
        cardSemanticRef.current.hidden = badgeText.length === 0;
        if (item.semantic) {
          cardSemanticRef.current.dataset.minimapSemanticBadge = item.semantic;
        } else {
          delete cardSemanticRef.current.dataset.minimapSemanticBadge;
        }
      }
      if (cardUserRef.current) {
        cardUserRef.current.textContent = userLabel;
      }
      if (cardAssistantRef.current) {
        const assistantText = preview?.assistantText ?? null;
        cardAssistantRef.current.textContent = assistantText ?? "";
        cardAssistantRef.current.hidden = assistantText === null;
      }
    }
  };

  const selectItem = (item: TimelineMinimapItem) => {
    onSelect(item);
    pendingHighlightCleanupRef.current?.();
    const viewport =
      rootRef.current?.closest<HTMLElement>("[data-assistant-citation-viewport]") ??
      rootRef.current?.parentElement ??
      null;
    const escapedId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(item.id)
        : item.id.replace(/["\\]/g, "\\$&");
    const rowSelector = `[data-timeline-row-id="${escapedId}"]`;
    pendingHighlightCleanupRef.current = scheduleTimelineTargetHighlight(() => {
      const scope: ParentNode = viewport ?? document;
      const row = scope.querySelector<HTMLElement>(rowSelector);
      return row && isRowVisibleInViewport(row, viewport) ? row : null;
    });
  };

  const scheduleScrubToItem = (item: TimelineMinimapItem) => {
    const drag = dragRef.current;
    if (drag && drag.lastScrubId === item.id) return;
    if (drag) drag.lastScrubId = item.id;
    pendingScrubItemRef.current = item;
    if (scrubRafRef.current !== null) return;
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      const target = pendingScrubItemRef.current;
      pendingScrubItemRef.current = null;
      if (!target) return;
      (onScrub ?? onSelect)(target);
    });
  };

  const pressedOnStripRef = useRef(false);
  const [passThrough, setPassThrough] = useState(false);

  const navigationInteractive =
    resolveTimelineMinimapNavigationInteractive(hitStripWidth) && !passThrough;
  const resolvedCurrentIndex =
    currentIndex !== null && currentIndex >= 0 && currentIndex < items.length ? currentIndex : null;
  const previousItem =
    resolvedCurrentIndex === null ? null : (items[resolvedCurrentIndex - 1] ?? null);
  const nextItem =
    resolvedCurrentIndex === null || atEnd ? null : (items[resolvedCurrentIndex + 1] ?? null);

  const resolvePointerGeometry = (clientY: number, rect: DOMRect) => {
    const discreteIndex = resolveTimelineMinimapIndexFromPointer({
      itemCount: items.length,
      railTop: rect.top,
      railHeight: rect.height,
      pointerY: clientY,
    });
    const ratio =
      rect.height > 0 ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) : 0;
    const continuousIndex = ratio * Math.max(0, items.length - 1);
    return { discreteIndex, continuousIndex };
  };

  const resolveActiveIndexFromPointer = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return resolveTimelineMinimapIndexFromPointer({
      itemCount: items.length,
      railTop: rect.top,
      railHeight: rect.height,
      pointerY: event.clientY,
    });
  };

  const moveKeyboardIndex = (nextIndex: number) => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
    const railHeight = railButtonRef.current?.getBoundingClientRect().height ?? 0;
    applyFocusDirectDom(clamped, clamped, {
      showCard: true,
      scrubbing: false,
      railHeight,
    });
  };

  const handleRailPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    clearHoverSettleTimer();
    suppressNextClickRef.current = false;
    pressedOnStripRef.current = true;
    const railRect = event.currentTarget.getBoundingClientRect();
    const { discreteIndex, continuousIndex } = resolvePointerGeometry(event.clientY, railRect);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      scrubbing: false,
      railRect,
      lastScrubId: null,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in browser tests may omit a capturable pointerId.
    }
    if (discreteIndex !== null) {
      applyFocusDirectDom(discreteIndex, continuousIndex, {
        showCard: true,
        scrubbing: false,
        railHeight: railRect.height,
      });
    }
  };

  const handleRailPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const { discreteIndex, continuousIndex } = resolvePointerGeometry(
        event.clientY,
        drag.railRect,
      );
      if (!drag.scrubbing && Math.abs(event.clientY - drag.startY) >= MINIMAP_SCRUB_THRESHOLD_PX) {
        drag.scrubbing = true;
        if (rootRef.current) {
          rootRef.current.dataset.minimapScrubbing = "true";
        }
      }
      if (discreteIndex !== null) {
        applyFocusDirectDom(discreteIndex, continuousIndex, {
          showCard: true,
          scrubbing: drag.scrubbing,
          railHeight: drag.railRect.height,
        });
        if (drag.scrubbing) {
          const scrubbedItem = items[discreteIndex];
          if (scrubbedItem) {
            scheduleScrubToItem(scrubbedItem);
          }
        }
      }
      return;
    }

    if (event.buttons !== 0 && !pressedOnStripRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const { discreteIndex, continuousIndex } = resolvePointerGeometry(event.clientY, rect);
    if (discreteIndex === null) return;

    const now = readEventTimestamp(event.timeStamp);
    const prev = lastPointerRef.current;
    let speedPxPerMs = 0;
    if (prev !== null) {
      const dt = Math.max(1, now - prev.timeStamp);
      speedPxPerMs = Math.hypot(event.clientX - prev.x, event.clientY - prev.y) / dt;
    }
    lastPointerRef.current = { x: event.clientX, y: event.clientY, timeStamp: now };

    const fastSweep =
      !cardVisibleRef.current &&
      prev !== null &&
      speedPxPerMs > MINIMAP_HOVER_VELOCITY_THRESHOLD_PX_PER_MS;

    if (fastSweep) {
      applyFocusDirectDom(discreteIndex, continuousIndex, {
        showCard: false,
        scrubbing: false,
        railHeight: rect.height,
      });
      clearHoverSettleTimer();
      const targetIndex = discreteIndex;
      const targetContinuous = continuousIndex;
      const targetHeight = rect.height;
      hoverSettleTimerRef.current = window.setTimeout(() => {
        hoverSettleTimerRef.current = null;
        if (activeIndexRef.current !== null) {
          applyFocusDirectDom(targetIndex, targetContinuous, {
            showCard: true,
            scrubbing: false,
            railHeight: targetHeight,
          });
        }
      }, MINIMAP_HOVER_SETTLE_DELAY_MS);
      return;
    }

    clearHoverSettleTimer();
    applyFocusDirectDom(discreteIndex, continuousIndex, {
      showCard: true,
      scrubbing: false,
      railHeight: rect.height,
    });
  };

  const endRailPointerDrag = (
    event: PointerEvent<HTMLButtonElement>,
    mode: "commit" | "cancel",
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    pressedOnStripRef.current = false;
    if (rootRef.current) {
      rootRef.current.dataset.minimapScrubbing = "false";
    }
    if (cardRef.current) {
      cardRef.current.dataset.minimapScrubbing = "false";
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore synthetic capture release errors.
    }
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    const pending = pendingScrubItemRef.current;
    pendingScrubItemRef.current = null;
    if (mode === "commit" && drag.scrubbing) {
      suppressNextClickRef.current = true;
      if (pending) {
        (onScrub ?? onSelect)(pending);
      }
    }
  };

  if (items.length < TIMELINE_MINIMAP_MIN_ITEMS) {
    return null;
  }

  return (
    <div
      className={cn(
        "group/minimap pointer-events-none absolute bottom-0 left-0 top-[calc(-1*var(--chat-header-height,0px))] z-40 w-18",
        hasPersistentGutter
          ? "opacity-100"
          : "hidden opacity-0 transition-opacity duration-150 motion-reduce:transition-none hover:opacity-100 focus-within:opacity-100 [@media(pointer:fine)]:block",
      )}
      data-testid="timeline-minimap"
      data-persistent-gutter={hasPersistentGutter ? "true" : "false"}
      data-minimap-scrubbing="false"
      ref={wheelTargetRef}
    >
      <div className="relative h-full w-full select-none">
        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2",
            hitStripWidth > 0 && !passThrough ? "pointer-events-auto" : "pointer-events-none",
          )}
          onMouseDown={() => {
            if (pressedOnStripRef.current) return;
            pressedOnStripRef.current = true;
            onMouseButtonsReleased(() => {
              pressedOnStripRef.current = false;
            });
          }}
          onMouseMove={(event) => {
            if (event.buttons === 0 || pressedOnStripRef.current || passThrough) return;
            setPassThrough(true);
            onMouseButtonsReleased(() => setPassThrough(false));
          }}
          style={{
            height: resolveTimelineMinimapHeightStyle(items.length),
            left: hitStripLeft,
            width: hitStripWidth,
          }}
        >
          <TimelineMinimapNavigationButton
            direction="previous"
            disabled={previousItem === null}
            interactive={navigationInteractive}
            onClick={() => {
              if (previousItem) selectItem(previousItem);
            }}
          />
          <button
            ref={railButtonRef}
            aria-label={gt("Jump to message: {text}", { text: gt("User message") })}
            className="absolute inset-y-0 left-0 w-full cursor-pointer touch-none bg-transparent before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            onBlur={hidePreviewDirectDom}
            onClick={(event) => {
              if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false;
                return;
              }
              const nextIndex = resolveActiveIndexFromPointer(event);
              const selectedItem = nextIndex === null ? null : (items[nextIndex] ?? null);
              if (selectedItem) {
                selectItem(selectedItem);
              }
              event.currentTarget.blur();
            }}
            onFocus={() => moveKeyboardIndex(activeIndexRef.current ?? resolvedCurrentIndex ?? 0)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveKeyboardIndex((activeIndexRef.current ?? 0) + 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveKeyboardIndex((activeIndexRef.current ?? 0) - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                moveKeyboardIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                moveKeyboardIndex(items.length - 1);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const idx = activeIndexRef.current;
                const target = idx === null ? null : (items[idx] ?? null);
                if (target) {
                  selectItem(target);
                }
              }
            }}
            onPointerDown={handleRailPointerDown}
            onPointerMove={handleRailPointerMove}
            onPointerUp={(event) => endRailPointerDrag(event, "commit")}
            onPointerCancel={(event) => endRailPointerDrag(event, "cancel")}
            onLostPointerCapture={(event) => endRailPointerDrag(event, "cancel")}
            onPointerLeave={() => {
              if (dragRef.current) return;
              hidePreviewDirectDom();
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            {items.map((item, index) => {
              const top = `${resolveTimelineMinimapTopPercent(index, items.length)}%`;
              return (
                // Compositor-friendly on purpose: in-view state and the 120fps fisheye
                // scrub wave mutate only transform and opacity via direct DOM writes.
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 h-0.5 w-6 origin-left rounded-full bg-muted-foreground/25 after:absolute after:inset-0 after:rounded-full after:bg-foreground/65 after:opacity-0 after:transition-opacity after:duration-150 data-[in-view=true]:after:opacity-100"
                  data-in-view="false"
                  data-minimap-active="false"
                  data-minimap-strip
                  key={item.id}
                  ref={(node) => {
                    if (node) {
                      stripMap.set(item.id, node);
                      stripNodesRef.current.set(index, node);
                    } else {
                      stripMap.delete(item.id);
                      if (stripNodesRef.current.get(index) === undefined) return;
                      stripNodesRef.current.delete(index);
                    }
                  }}
                  style={{ top }}
                >
                  {item.semantic ? (
                    <span
                      aria-hidden="true"
                      data-minimap-semantic={item.semantic}
                      className="pointer-events-none absolute -right-1.5 top-1/2 size-0.5 -translate-y-1/2 rounded-full"
                    />
                  ) : null}
                  {(item.findMatchCount ?? 0) > 0 || item.hasActiveFindMatch ? (
                    <span
                      aria-hidden="true"
                      data-minimap-find-dot="true"
                      data-minimap-find-active={item.hasActiveFindMatch ? "true" : "false"}
                      data-minimap-find-count={item.findMatchCount ?? 1}
                      data-minimap-find-dense={(item.findMatchCount ?? 0) >= 3 ? "true" : undefined}
                      className="pointer-events-none absolute -right-2.5 top-1/2 -translate-y-1/2 rounded-full"
                    />
                  ) : null}
                </span>
              );
            })}
            {/* Display-only: translated purely via GPU translate3d without layout top transitions. */}
            <span
              ref={cardRef}
              aria-hidden="true"
              data-minimap-preview-card="true"
              data-minimap-preview-visible="false"
              data-minimap-scrubbing="false"
              className="pointer-events-none absolute top-0 left-8 w-80"
              style={{ transform: "translate3d(0, 0px, 0) translateY(-50%)" }}
            >
              <span className="t3-minimap-card-enter dropdown-glass block rounded-xl p-3 text-left text-popover-foreground shadow-xl shadow-black/25">
                <span className="mb-1 flex items-center justify-between gap-2 text-2xs font-medium text-muted-foreground tabular-nums">
                  <span ref={cardTurnRef} data-minimap-turn-badge="true" />
                  <span
                    ref={cardSemanticRef}
                    hidden
                    className="rounded-full bg-muted/80 px-1.5 py-0.5 text-3xs font-medium text-foreground/85"
                  />
                </span>
                <span
                  ref={cardUserRef}
                  data-minimap-user-text="true"
                  className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5"
                />
                <span
                  ref={cardAssistantRef}
                  data-minimap-assistant-text="true"
                  hidden
                  className="mt-1 max-h-[3.75rem] overflow-hidden text-muted-foreground text-sm leading-5"
                  style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 3,
                  }}
                />
              </span>
            </span>
          </button>
          <TimelineMinimapNavigationButton
            direction="next"
            disabled={nextItem === null}
            interactive={navigationInteractive}
            onClick={() => {
              if (nextItem) selectItem(nextItem);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TimelineMinimapNavigationButton({
  direction,
  disabled,
  interactive,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  interactive: boolean;
  onClick: () => void;
}) {
  const gt = useGT();
  const previous = direction === "previous";
  const label = previous ? gt("Previous turn") : gt("Next turn");
  const Icon = previous ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "absolute left-1 z-10 inline-flex -translate-x-1/2 opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none group-hover/minimap:opacity-100 group-focus-within/minimap:opacity-100 hover:opacity-100 focus-within:opacity-100",
              interactive ? "pointer-events-auto" : "pointer-events-none",
              previous ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            )}
          />
        }
      >
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-micro"
          type="button"
          variant="ghost-muted"
        >
          <Icon className="size-4 text-foreground/90" />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side={previous ? "top" : "bottom"}>{label}</TooltipPopup>
    </Tooltip>
  );
}

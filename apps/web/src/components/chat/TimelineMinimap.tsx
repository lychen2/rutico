import { resolveTimelineMinimapPreview, type TimelineMinimapItem } from "./timelineMinimapItems";
import { useRef, useState, type MouseEvent } from "react";
import { T, useGT } from "gt-react";
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

export function TimelineMinimap({
  hasPersistentGutter,
  hitStrip: { left: hitStripLeft, width: hitStripWidth },
  currentIndex,
  atEnd,
  items,
  stripMap,
  onWheel,
  onSelect,
}: {
  hasPersistentGutter: boolean;
  hitStrip: { left: number; width: number };
  currentIndex: number | null;
  atEnd: boolean;
  items: ReadonlyArray<TimelineMinimapItem>;
  stripMap: Map<string, HTMLSpanElement>;
  onWheel: (event: WheelEvent) => void;
  onSelect: (item: TimelineMinimapItem) => void;
}) {
  const gt = useGT();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const pressedOnStripRef = useRef(false);
  const [passThrough, setPassThrough] = useState(false);

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolveTimelineMinimapPreview(
    resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null),
  );
  const navigationInteractive =
    resolveTimelineMinimapNavigationInteractive(hitStripWidth) && !passThrough;
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : resolveTimelineMinimapTopPercent(resolvedActiveIndex, items.length);
  const resolvedCurrentIndex =
    currentIndex !== null && currentIndex >= 0 && currentIndex < items.length ? currentIndex : null;
  const previousItem =
    resolvedCurrentIndex === null ? null : (items[resolvedCurrentIndex - 1] ?? null);
  const nextItem =
    resolvedCurrentIndex === null || atEnd ? null : (items[resolvedCurrentIndex + 1] ?? null);

  const resolveActiveIndexFromPointer = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return resolveTimelineMinimapIndexFromPointer({
      itemCount: items.length,
      railTop: rect.top,
      railHeight: rect.height,
      pointerY: event.clientY,
    });
  };

  const updateActiveIndexFromPointer = (event: MouseEvent<HTMLElement>) => {
    const nextIndex = resolveActiveIndexFromPointer(event);
    setActiveIndex(nextIndex);
  };

  const moveActiveIndex = (delta: number) => {
    setActiveIndex((current) => {
      const base = current ?? 0;
      return Math.max(0, Math.min(items.length - 1, base + delta));
    });
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
            aria-label={gt("Jump to message: {text}", {
              text: activeItem?.userText ?? gt("User message"),
            })}
            className="absolute inset-y-0 left-0 w-full cursor-pointer bg-transparent before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            onBlur={() => setActiveIndex(null)}
            onClick={(event) => {
              const nextIndex = resolveActiveIndexFromPointer(event);
              const selectedItem = nextIndex === null ? null : (items[nextIndex] ?? null);
              if (selectedItem) {
                selectItem(selectedItem);
              }
              event.currentTarget.blur();
            }}
            onFocus={() => setActiveIndex((current) => current ?? resolvedCurrentIndex ?? 0)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActiveIndex(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActiveIndex(-1);
              } else if (event.key === "Home") {
                event.preventDefault();
                setActiveIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setActiveIndex(items.length - 1);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (activeItem) {
                  selectItem(activeItem);
                }
              }
            }}
            onMouseLeave={() => setActiveIndex(null)}
            onMouseMove={(event) => {
              if (event.buttons !== 0 && !pressedOnStripRef.current) return;
              updateActiveIndexFromPointer(event);
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            {items.map((item, index) => {
              const top = `${resolveTimelineMinimapTopPercent(index, items.length)}%`;
              const activeDistance =
                resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
              return (
                // Compositor-friendly on purpose: in-view state and the hover
                // fisheye animate constantly (every scroll tick and streaming
                // update flips a band of strips), so the strip animates only
                // transform and opacity.
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute left-0 h-0.5 w-6 origin-left -translate-y-1/2 rounded-full transition-transform duration-200 ease-(--ease-spring-snappy) motion-reduce:transition-none after:absolute after:inset-0 after:rounded-full after:bg-foreground/65 after:opacity-0 after:transition-opacity after:duration-150 data-[in-view=true]:after:opacity-100",
                    activeDistance === 0 ? "bg-muted-foreground/75" : "bg-muted-foreground/25",
                    activeDistance === 0
                      ? "scale-x-100"
                      : activeDistance === 1
                        ? "scale-x-[0.667]"
                        : activeDistance === 2
                          ? "scale-x-[0.417]"
                          : "scale-x-[0.333]",
                  )}
                  data-in-view="false"
                  data-minimap-strip
                  key={item.id}
                  ref={(node) => {
                    if (node) {
                      stripMap.set(item.id, node);
                    } else {
                      stripMap.delete(item.id);
                    }
                  }}
                  style={{ top }}
                />
              );
            })}
            {activeItem ? (
              // Display-only: it overlaps the message column, and the strip keeps tracking beneath it.
              <span
                className="pointer-events-none absolute left-8 w-80 -translate-y-1/2 transition-[top] duration-120 ease-out motion-reduce:transition-none"
                style={{ top: `${activeTopPercent}%` }}
              >
                <span className="t3-minimap-card-enter dropdown-glass block rounded-xl p-3 text-left text-popover-foreground shadow-xl shadow-black/25">
                  <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5">
                    {activeItem.userText ?? <T>User message</T>}
                  </span>
                  {activeItem.assistantText ? (
                    <span
                      className="mt-1 max-h-[3.75rem] overflow-hidden text-muted-foreground text-sm leading-5"
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 3,
                      }}
                    >
                      {activeItem.assistantText}
                    </span>
                  ) : null}
                </span>
              </span>
            ) : null}
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

import {
  cloneElement,
  isValidElement,
  createContext,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { createVelocityTracker } from "~/lib/motion/rubberBand";
import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import { cn } from "~/lib/utils";
import {
  DEFAULT_TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  useTooltipScrollTracker,
} from "./tooltip";

// Kubai087 Tip 025: 500ms cold intent open, 0ms warm glide, 0.1px/ms pointer speed filter.
const OPEN_DELAY_MS = DEFAULT_TOOLTIP_DELAY_MS;
const REOPEN_WINDOW_MS = 400;
const CLOSE_GRACE_MS = 120;
const POINTER_SETTLE_SPEED_PX_PER_MS = 0.1;
const POINTER_SETTLE_RETRY_MS = 90;

/** Return true when cursor sweep speed exceeds the Tip 025 0.1px/ms intent threshold. */
export function shouldDeferTooltipForPointerSpeed(speedPerMs: number): boolean {
  return Number.isFinite(speedPerMs) && speedPerMs > POINTER_SETTLE_SPEED_PX_PER_MS;
}

interface SharedTooltipContent {
  readonly render: () => ReactNode;
  /** Comparable key that changes whenever `render()` output changes while open. */
  readonly contentKey?: unknown;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly align?: "start" | "center" | "end";
  readonly sideOffset?: number;
  readonly openDelayMs?: number;
  readonly variant?: "default" | "glass" | "code";
  readonly className?: string;
}

interface SharedTooltipState extends SharedTooltipContent {
  readonly anchor: HTMLElement;
  readonly open: boolean;
  readonly slideOffset?: { readonly x: number; readonly y: number } | null;
  readonly switchSeq: number;
}

interface HoveredTrigger {
  readonly content: SharedTooltipContent;
  readonly onHover: () => void;
}

interface SharedTooltipApi {
  hover(anchor: HTMLElement, content: SharedTooltipContent, onHover: () => void): void;
  leave(anchor: HTMLElement, relatedTarget: EventTarget | null): void;
  show(anchor: HTMLElement, content: SharedTooltipContent, immediate: boolean): void;
  refresh(anchor: HTMLElement, content: SharedTooltipContent): void;
  hide(anchor: HTMLElement): void;
  /** A press closes it at once, as Base UI's closeOnClick does. */
  dismiss(anchor: HTMLElement): void;
  /** An unmounting trigger drops its own pending open and closes the popup only if it is its. */
  release(anchor: HTMLElement): void;
  holdOpen(): void;
  cleanup(): void;
}

function setAriaDescribedBy(element: HTMLElement, id: string, present: boolean) {
  const tokens = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const next = present
    ? tokens.includes(id)
      ? tokens
      : [...tokens, id]
    : tokens.filter((token) => token !== id);
  if (next.length > 0) element.setAttribute("aria-describedby", next.join(" "));
  else element.removeAttribute("aria-describedby");
}

function computeAnchorSlideOffset(
  prevAnchor: HTMLElement | null,
  nextAnchor: HTMLElement,
): { readonly x: number; readonly y: number } | null {
  if (!prevAnchor || prevAnchor === nextAnchor || !prevAnchor.isConnected) return null;
  const prevRect = prevAnchor.getBoundingClientRect();
  const nextRect = nextAnchor.getBoundingClientRect();
  const dx = nextRect.left + nextRect.width / 2 - (prevRect.left + prevRect.width / 2);
  const dy = nextRect.top + nextRect.height / 2 - (prevRect.top + prevRect.height / 2);
  if (Math.hypot(dx, dy) < 2) return null;
  const clamp = (delta: number) =>
    Math.max(-6, Math.min(6, Math.sign(delta) * Math.min(6, Math.abs(delta) * 0.12)));
  return { x: clamp(dx), y: clamp(dy) };
}

const SharedTooltipContext = createContext<SharedTooltipApi | null>(null);

/**
 * One tooltip for many triggers: a long message would otherwise mount a Base UI tooltip per
 * link and file chip, and almost none of them are ever hovered.
 */
export function SharedTooltipProvider({ children }: { children: ReactNode }) {
  const popupId = useId();
  const [state, setState] = useState<SharedTooltipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<SharedTooltipState | null>(null);
  const lastClosedAt = useRef(0);
  const current = useRef<SharedTooltipState | null>(null);
  const switchSeqRef = useRef(0);
  const contentWrapperRef = useRef<HTMLDivElement | null>(null);
  const hovered = useRef<WeakMap<HTMLElement, HoveredTrigger>>(new WeakMap());

  const commit = (next: SharedTooltipState | null) => {
    current.current = next;
    setState(next);
  };
  const [api] = useState<SharedTooltipApi>(() => {
    const velocityTracker = createVelocityTracker(90);
    let trackingMove = false;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      velocityTracker.push(event.clientX, event.clientY, event.timeStamp);
    };
    const stopVelocityTracking = () => {
      if (!trackingMove || typeof window === "undefined") return;
      trackingMove = false;
      window.removeEventListener("pointermove", handlePointerMove, true);
      velocityTracker.reset();
    };
    const startVelocityTracking = () => {
      if (trackingMove || typeof window === "undefined") return;
      trackingMove = true;
      velocityTracker.reset();
      window.addEventListener("pointermove", handlePointerMove, true);
    };
    const clearTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      stopVelocityTracking();
    };
    const findHoveredAncestor = (
      relatedTarget: EventTarget | null,
    ): [HTMLElement, HoveredTrigger] | null => {
      let node: Node | null = relatedTarget instanceof Node ? relatedTarget : null;
      while (node) {
        if (node instanceof HTMLElement) {
          const entry = hovered.current.get(node);
          if (entry) return [node, entry];
        }
        node = node.parentNode;
      }
      return null;
    };
    const schedulePendingCommit = (delayMs: number) => {
      timer.current = setTimeout(() => {
        const next = pending.current;
        if (!next) {
          stopVelocityTracking();
          return;
        }
        const speed = velocityTracker.getVelocity(performance.now()).speedPerMs;
        if (shouldDeferTooltipForPointerSpeed(speed)) {
          schedulePendingCommit(POINTER_SETTLE_RETRY_MS);
          return;
        }
        pending.current = null;
        timer.current = null;
        stopVelocityTracking();
        commit(next);
      }, delayMs);
    };
    const show: SharedTooltipApi["show"] = (anchor, content, immediate) => {
      clearTimer();
      // A Root that mounts open skips Base UI's mount transition, so the popup would slide in from (0,0).
      if (!current.current) {
        flushSync(() =>
          commit({ ...content, anchor, open: false, slideOffset: null, switchSeq: 0 }),
        );
      }
      const open = current.current?.open === true;
      const reopen = performance.now() - lastClosedAt.current < REOPEN_WINDOW_MS;
      if (immediate || open || reopen) {
        const slideOffset =
          open && current.current ? computeAnchorSlideOffset(current.current.anchor, anchor) : null;
        if (slideOffset) switchSeqRef.current += 1;
        commit({
          ...content,
          anchor,
          open: true,
          slideOffset,
          switchSeq: switchSeqRef.current,
        });
        return;
      }
      pending.current = {
        ...content,
        anchor,
        open: true,
        slideOffset: null,
        switchSeq: switchSeqRef.current,
      };
      startVelocityTracking();
      schedulePendingCommit(content.openDelayMs ?? OPEN_DELAY_MS);
    };
    const hover: SharedTooltipApi["hover"] = (anchor, content, onHover) => {
      hovered.current.set(anchor, { content, onHover });
      show(anchor, content, false);
      onHover();
    };
    const hide: SharedTooltipApi["hide"] = (anchor) => {
      if (pending.current?.anchor === anchor) {
        clearTimer();
        return;
      }
      if (current.current?.anchor !== anchor || !current.current.open) return;
      clearTimer();
      timer.current = setTimeout(() => {
        if (current.current?.open) lastClosedAt.current = performance.now();
        if (current.current) commit({ ...current.current, open: false, slideOffset: null });
      }, CLOSE_GRACE_MS);
    };
    return {
      hover,
      leave(anchor, relatedTarget) {
        hovered.current.delete(anchor);
        const isOwnActive = current.current?.anchor === anchor && current.current.open;
        const isOwnPending = pending.current?.anchor === anchor;
        if (isOwnActive || isOwnPending) {
          // Moving back onto an enclosing trigger fires no pointerenter there, so restore it here.
          const ancestor = findHoveredAncestor(relatedTarget);
          if (ancestor) {
            const [parentAnchor, parentEntry] = ancestor;
            hover(parentAnchor, parentEntry.content, parentEntry.onHover);
            return;
          }
        }
        hide(anchor);
      },
      show,
      refresh(anchor, content) {
        const existingHover = hovered.current.get(anchor);
        if (existingHover) hovered.current.set(anchor, { ...existingHover, content });
        if (pending.current?.anchor === anchor) {
          pending.current = { ...pending.current, ...content };
        }
        const active = current.current;
        if (!active || active.anchor !== anchor) return;
        if (
          active.contentKey === content.contentKey &&
          active.side === content.side &&
          active.align === content.align &&
          active.sideOffset === content.sideOffset &&
          active.variant === content.variant &&
          active.className === content.className
        ) {
          return;
        }
        commit({ ...active, ...content });
      },
      hide,
      dismiss(anchor) {
        clearTimer();
        if (current.current?.anchor !== anchor) return;
        if (current.current.open) lastClosedAt.current = 0;
        commit({ ...current.current, open: false, slideOffset: null });
      },
      release(anchor) {
        hovered.current.delete(anchor);
        if (pending.current?.anchor === anchor) clearTimer();
        if (current.current?.anchor === anchor && current.current.open) {
          commit({ ...current.current, open: false, slideOffset: null });
        }
      },
      holdOpen() {
        clearTimer();
      },
      cleanup() {
        clearTimer();
      },
    };
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cleans up active hover timer and pointer velocity listener on unmount
  useEffect(() => () => api.cleanup(), [api]);

  const activeSlideOffset = state?.open ? state.slideOffset : null;
  const activeSwitchSeq = state?.switchSeq ?? 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives subtle directional content slide when gliding between adjacent triggers
  useLayoutEffect(() => {
    if (!activeSlideOffset || activeSwitchSeq === 0) return;
    const node = contentWrapperRef.current;
    if (!node || typeof node.animate !== "function" || prefersReducedMotion()) return;
    const timing = getSpringWaapiTiming("snappy");
    const animation = node.animate(
      [
        {
          opacity: 0.4,
          transform: `translate3d(${activeSlideOffset.x.toFixed(1)}px, ${activeSlideOffset.y.toFixed(1)}px, 0)`,
        },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      { duration: Math.min(180, timing.duration), easing: timing.easing },
    );
    return () => animation.cancel();
  }, [activeSlideOffset, activeSwitchSeq]);

  const activeAnchor = state?.open ? state.anchor : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- links the active trigger DOM element to the shared tooltip popup via aria-describedby
  useEffect(() => {
    if (!activeAnchor) return;
    setAriaDescribedBy(activeAnchor, popupId, true);
    return () => setAriaDescribedBy(activeAnchor, popupId, false);
  }, [activeAnchor, popupId]);

  return (
    <SharedTooltipContext value={api}>
      {children}
      {state ? (
        <Tooltip
          open={state.open}
          onOpenChange={(open) => {
            if (!open) api.hide(state.anchor);
          }}
        >
          <TooltipPopup
            id={popupId}
            anchor={state.anchor}
            side={state.side ?? "top"}
            align={state.align ?? "center"}
            sideOffset={state.sideOffset ?? 4}
            variant={state.variant ?? "default"}
            className={cn("pointer-events-auto", state.className)}
            onMouseEnter={() => api.holdOpen()}
            onMouseLeave={() => api.hide(state.anchor)}
          >
            <div ref={contentWrapperRef} data-slot="shared-tooltip-content">
              {state.render()}
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </SharedTooltipContext>
  );
}

export interface SharedTooltipTriggerProps {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}

const handledTooltipFocusEvents = new WeakSet<Event>();

/**
 * Props that show `content` on the shared tooltip, or null outside a SharedTooltipProvider.
 * A disabled trigger opens nothing, and closes the tooltip if it was showing.
 */
export function useSharedTooltip(
  content: SharedTooltipContent,
  enabled = true,
): SharedTooltipTriggerProps | null {
  const api = use(SharedTooltipContext);
  const scrollTracker = useTooltipScrollTracker();
  const anchorRef = useRef<HTMLElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes an open shared tooltip when its trigger's label changes, and closes it when the trigger is disabled
  useEffect(() => {
    if (!api || !anchorRef.current) return;
    if (enabled) api.refresh(anchorRef.current, content);
    // Only this trigger's own pending open or popup; another trigger's must survive.
    else api.release(anchorRef.current);
  }, [api, content, enabled]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a removed trigger fires no pointerleave, so it must close the popup anchored to it
  useEffect(
    () => () => {
      if (api && anchorRef.current) api.release(anchorRef.current);
    },
    [api],
  );
  if (!api) return null;
  return {
    // Touch never opens it, as Base UI's mouseOnly trigger; taps also send compatibility mouse events.
    onPointerEnter: (event) => {
      if (event.pointerType === "touch" || !enabled) return;
      const trigger = event.currentTarget;
      anchorRef.current = trigger;
      // Scrolling the timeline closes it, as it does a TooltipTrigger's.
      api.hover(trigger, content, () =>
        scrollTracker?.hover(trigger, api, () => api.dismiss(trigger)),
      );
    },
    onPointerLeave: (event) => api.leave(event.currentTarget, event.relatedTarget),
    // Keyboard focus shows it at once, as Base UI does.
    onFocus: (event) => {
      // Only the innermost enabled trigger handles a bubbling focus event, so an outer row tooltip
      // never overwrites an inner action button's tooltip.
      if (handledTooltipFocusEvents.has(event.nativeEvent)) return;
      // A wrapper's handler sees focus bubble from the control inside it, so check the focused element.
      const focused = event.target instanceof Element ? event.target : event.currentTarget;
      if (enabled && focused.matches(":focus-visible")) {
        handledTooltipFocusEvents.add(event.nativeEvent);
        anchorRef.current = event.currentTarget;
        api.show(event.currentTarget, content, true);
      }
    },
    onBlur: (event) => api.hide(event.currentTarget),
    onPointerDown: (event) => api.dismiss(event.currentTarget),
  };
}

type Handlers = Partial<Record<keyof SharedTooltipTriggerProps, (event: never) => void>>;

/** The trigger's own handlers run first, then the shared tooltip's. */
export function withSharedTooltip<Props>(
  element: ReactElement<Props>,
  tooltip: SharedTooltipTriggerProps,
  children?: ReactNode,
): ReactElement {
  const own = element.props as Handlers;
  const merged: Record<string, (event: never) => void> = {};
  for (const key of Object.keys(tooltip) as Array<keyof SharedTooltipTriggerProps>) {
    const shared = tooltip[key] as (event: never) => void;
    const mine = own[key];
    merged[key] = mine
      ? (event) => {
          mine(event);
          shared(event);
        }
      : shared;
  }
  return children === undefined
    ? cloneElement(element, merged as Partial<Props>)
    : cloneElement(element, merged as Partial<Props>, children);
}

// A disabled control gets no pointer events, so its tooltip is unreachable anyway; treating it as a
// disabled trigger also closes a tooltip that was open when the control became disabled.
function renderedDisabled(element: ReactElement): boolean {
  const props = element.props as { disabled?: unknown; render?: unknown };
  if (props.disabled === true) return true;
  return isValidElement(props.render) && renderedDisabled(props.render);
}

/** A tooltip on `render`: the shared one inside a SharedTooltipProvider, Base UI's otherwise. */
export function SharedTooltipTrigger({
  render,
  children,
  label,
  side = "top",
  align,
  sideOffset,
  openDelayMs,
  variant,
  className,
  disabled = false,
}: {
  render: ReactElement;
  children?: ReactNode;
  label: ReactNode;
  side?: SharedTooltipContent["side"];
  align?: SharedTooltipContent["align"];
  sideOffset?: SharedTooltipContent["sideOffset"];
  openDelayMs?: SharedTooltipContent["openDelayMs"];
  variant?: SharedTooltipContent["variant"];
  className?: SharedTooltipContent["className"];
  disabled?: boolean | undefined;
}) {
  const inactive = disabled === true || renderedDisabled(render);
  const tooltip = useSharedTooltip(
    {
      render: () => label,
      contentKey: label,
      side,
      ...(align ? { align } : {}),
      ...(sideOffset === undefined ? {} : { sideOffset }),
      ...(openDelayMs === undefined ? {} : { openDelayMs }),
      ...(variant ? { variant } : {}),
      ...(className ? { className } : {}),
    },
    !inactive,
  );
  if (tooltip) return withSharedTooltip(render, tooltip, children);
  return (
    <Tooltip disabled={inactive}>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipPopup
        side={side}
        {...(align ? { align } : {})}
        {...(sideOffset === undefined ? {} : { sideOffset })}
        {...(variant ? { variant } : {})}
        {...(className ? { className } : {})}
      >
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}

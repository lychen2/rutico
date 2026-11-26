import {
  cloneElement,
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
  readonly variant?: "default" | "glass" | "code";
}

interface SharedTooltipState extends SharedTooltipContent {
  readonly anchor: HTMLElement;
  readonly open: boolean;
  readonly slideOffset?: { readonly x: number; readonly y: number } | null;
  readonly switchSeq: number;
}

interface SharedTooltipApi {
  show(anchor: HTMLElement, content: SharedTooltipContent, immediate: boolean): void;
  refresh(anchor: HTMLElement, content: SharedTooltipContent): void;
  hide(anchor: HTMLElement): void;
  /** A press closes it at once, as Base UI's closeOnClick does. */
  dismiss(anchor: HTMLElement): void;
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

    return {
      show(anchor, content, immediate) {
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
            open && current.current
              ? computeAnchorSlideOffset(current.current.anchor, anchor)
              : null;
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
        schedulePendingCommit(OPEN_DELAY_MS);
      },
      refresh(anchor, content) {
        if (pending.current?.anchor === anchor) {
          pending.current = { ...pending.current, ...content };
        }
        const active = current.current;
        if (!active || active.anchor !== anchor) return;
        if (
          active.contentKey === content.contentKey &&
          active.side === content.side &&
          active.variant === content.variant
        ) {
          return;
        }
        commit({ ...active, ...content });
      },
      hide(anchor) {
        if (current.current && current.current.anchor !== anchor) {
          clearTimer();
          return;
        }
        clearTimer();
        timer.current = setTimeout(() => {
          if (current.current?.open) lastClosedAt.current = performance.now();
          if (current.current) commit({ ...current.current, open: false, slideOffset: null });
        }, CLOSE_GRACE_MS);
      },
      dismiss(anchor) {
        clearTimer();
        if (current.current?.anchor !== anchor) return;
        if (current.current.open) lastClosedAt.current = 0;
        commit({ ...current.current, open: false, slideOffset: null });
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
            variant={state.variant ?? "default"}
            className="pointer-events-auto"
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

/** Props that show `content` on the shared tooltip, or null outside a SharedTooltipProvider. */
export function useSharedTooltip(content: SharedTooltipContent): SharedTooltipTriggerProps | null {
  const api = use(SharedTooltipContext);
  const scrollTracker = useTooltipScrollTracker();
  const anchorRef = useRef<HTMLElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes an open shared tooltip when its trigger's label changes
  useEffect(() => {
    if (api && anchorRef.current) api.refresh(anchorRef.current, content);
  }, [api, content]);
  if (!api) return null;
  return {
    // Touch never opens it, as Base UI's mouseOnly trigger; taps also send compatibility mouse events.
    onPointerEnter: (event) => {
      if (event.pointerType === "touch") return;
      const trigger = event.currentTarget;
      anchorRef.current = trigger;
      api.show(trigger, content, false);
      // Scrolling the timeline closes it, as it does a TooltipTrigger's.
      scrollTracker?.hover(trigger, api, () => api.dismiss(trigger));
    },
    onPointerLeave: (event) => api.hide(event.currentTarget),
    // Keyboard focus shows it at once, as Base UI does.
    onFocus: (event) => {
      if (event.currentTarget.matches(":focus-visible")) {
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

/** A tooltip on `render`: the shared one inside a SharedTooltipProvider, Base UI's otherwise. */
export function SharedTooltipTrigger({
  render,
  children,
  label,
  side = "top",
  variant,
}: {
  render: ReactElement;
  children?: ReactNode;
  label: ReactNode;
  side?: SharedTooltipContent["side"];
  variant?: SharedTooltipContent["variant"];
}) {
  const tooltip = useSharedTooltip({
    render: () => label,
    contentKey: label,
    side,
    ...(variant ? { variant } : {}),
  });
  if (tooltip) return withSharedTooltip(render, tooltip, children);
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipPopup side={side} {...(variant ? { variant } : {})}>
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}

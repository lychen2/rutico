import { useEffect, useRef, type PointerEvent, type RefObject, type UIEvent } from "react";

import {
  createVelocityTracker,
  rubberband,
  RUBBER_BAND_COEFFICIENT,
  shouldDismissByDrag,
  type VelocityTracker,
} from "./rubberBand";
import { createSpringKeyframes, getSpringWaapiTiming, prefersReducedMotion } from "./springs";

export type SheetDragSide = "left" | "right" | "top" | "bottom";

/** Vaul scroll-edge cooldown preventing accidental sheet dismissal right after scrolling. */
export const SHEET_SCROLL_COOLDOWN_MS = 100;

const DRAG_LOCK_DISTANCE_PX = 8;
const DIRECTION_DOMINANCE_RATIO = 1.15;
const MIN_OVERSCROLL_DIMENSION_PX = 120;

export interface SheetDragOffset {
  /** Signed raw displacement toward dismissal (> 0 dismisses, < 0 overscrolls). */
  readonly dismissDelta: number;
  /** Visual displacement along dismiss axis after logarithmic overscroll resistance. */
  readonly visualDismissOffset: number;
  readonly tx: number;
  readonly ty: number;
  readonly backdropOpacity: number;
}

/** Map pointer delta `(dx, dy)` to 1:1 dismiss translation or logarithmic rubber-band overscroll. */
export function computeSheetDragOffset(
  side: SheetDragSide,
  dx: number,
  dy: number,
  dimension: number,
): SheetDragOffset {
  const safeDimension = Math.max(1, dimension);
  const dismissDelta = side === "right" ? dx : side === "left" ? -dx : side === "bottom" ? dy : -dy;
  const visualDismissOffset =
    dismissDelta >= 0
      ? dismissDelta
      : rubberband(
          dismissDelta,
          Math.max(safeDimension, MIN_OVERSCROLL_DIMENSION_PX),
          RUBBER_BAND_COEFFICIENT,
        );

  const tx = side === "right" ? visualDismissOffset : side === "left" ? -visualDismissOffset : 0;
  const ty = side === "bottom" ? visualDismissOffset : side === "top" ? -visualDismissOffset : 0;
  const progress = Math.max(0, Math.min(1, dismissDelta / safeDimension));
  const backdropOpacity = Math.max(0, Math.min(1, 1 - progress));

  return { dismissDelta, visualDismissOffset, tx, ty, backdropOpacity };
}

/** Resolve signed release velocity (px/ms) along a sheet's dismissal direction. */
export function resolveAxisDismissVelocity(
  side: SheetDragSide,
  vxPerMs: number,
  vyPerMs: number,
): number {
  if (side === "right") return vxPerMs;
  if (side === "left") return -vxPerMs;
  if (side === "bottom") return vyPerMs;
  return -vyPerMs;
}

/** Return true if a scrollable child moved recently enough to block drag-to-dismiss. */
export function isWithinSheetScrollCooldown(
  nowMs: number,
  lastScrollAtMs: number,
  cooldownMs = SHEET_SCROLL_COOLDOWN_MS,
): boolean {
  if (lastScrollAtMs <= 0) return false;
  return nowMs - lastScrollAtMs < cooldownMs;
}

function isHorizontalSide(side: SheetDragSide): boolean {
  return side === "left" || side === "right";
}

function isInteractiveDragExcludedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [data-sheet-no-drag]',
    ),
  );
}

function hasScrollableRoomInDirection(
  target: EventTarget | null,
  root: HTMLElement,
  side: SheetDragSide,
  dx: number,
  dy: number,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  let node: HTMLElement | null = target;
  while (node && node !== root) {
    const style = getComputedStyle(node);
    if (isHorizontalSide(side)) {
      const scrollableX =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1;
      if (scrollableX) {
        if (dx > 0 && node.scrollLeft > 0) return true;
        if (dx < 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
      }
    } else {
      const scrollableY =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight + 1;
      if (scrollableY) {
        if (dy > 0 && node.scrollTop > 0) return true;
        if (dy < 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function formatOffsetTransform(side: SheetDragSide, visualDismissOffset: number): string {
  const tx = side === "right" ? visualDismissOffset : side === "left" ? -visualDismissOffset : 0;
  const ty = side === "bottom" ? visualDismissOffset : side === "top" ? -visualDismissOffset : 0;
  return `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
}

export interface UseSheetDragOptions {
  readonly enabled: boolean;
  readonly side: SheetDragSide;
  readonly popupRef: RefObject<HTMLElement | null>;
  readonly backdropRef: RefObject<HTMLElement | null>;
  readonly onDismiss: () => void;
}

interface ActiveSheetDragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly dimension: number;
  readonly startTarget: EventTarget | null;
  locked: boolean;
  aborted: boolean;
  lastOffset: SheetDragOffset;
  readonly velocityTracker: VelocityTracker;
}

/** Four-direction pointer drag-to-dismiss with Vaul scroll cooldown and WAAPI momentum handoff. */
export function useSheetDrag({
  enabled,
  side,
  popupRef,
  backdropRef,
  onDismiss,
}: UseSheetDragOptions) {
  const dragRef = useRef<ActiveSheetDragState | null>(null);
  const lastScrollAtRef = useRef(0);
  const activeAnimationsRef = useRef<Animation[]>([]);
  const animationGenerationRef = useRef(0);

  const cancelActiveAnimations = () => {
    animationGenerationRef.current += 1;
    for (const animation of activeAnimationsRef.current) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
    }
    activeAnimationsRef.current = [];
  };

  const clearInlineStyles = () => {
    cancelActiveAnimations();
    const popup = popupRef.current;
    if (popup) {
      popup.style.transform = "";
      popup.style.transition = "";
    }
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.opacity = "";
      backdrop.style.transition = "";
    }
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels active WAAPI sheet drag animations on unmount or disable
  useEffect(() => {
    const cancelPending = () => {
      dragRef.current = null;
      animationGenerationRef.current += 1;
      for (const animation of activeAnimationsRef.current) {
        animation.onfinish = null;
        animation.oncancel = null;
        animation.cancel();
      }
      activeAnimationsRef.current = [];
    };
    if (!enabled) cancelPending();
    return cancelPending;
  }, [enabled]);

  const finishDrag = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    const popup = popupRef.current;
    const backdrop = backdropRef.current;
    if (!drag.locked || !popup) return;

    const velocity = drag.velocityTracker.getVelocity(event.timeStamp);
    const axisVelocity = resolveAxisDismissVelocity(side, velocity.vxPerMs, velocity.vyPerMs);
    const dismiss =
      !cancelled && shouldDismissByDrag(drag.lastOffset.dismissDelta, drag.dimension, axisVelocity);

    if (prefersReducedMotion() || typeof popup.animate !== "function") {
      clearInlineStyles();
      if (dismiss) onDismiss();
      return;
    }

    cancelActiveAnimations();
    const generation = animationGenerationRef.current;

    if (dismiss) {
      const targetOffset = Math.max(drag.dimension, 160);
      const spring = createSpringKeyframes(
        drag.lastOffset.visualDismissOffset,
        targetOffset,
        "snappy",
        {
          initialVelocity: Math.max(0, axisVelocity) * 1000,
          format: (value) => ({ transform: formatOffsetTransform(side, value) }),
        },
      );
      const popupAnim = popup.animate(spring.keyframes, {
        duration: Math.max(110, Math.min(240, spring.durationMs)),
        easing: spring.easing,
        fill: "forwards",
      });
      const animations: Animation[] = [popupAnim];
      if (backdrop && typeof backdrop.animate === "function") {
        animations.push(
          backdrop.animate([{ opacity: drag.lastOffset.backdropOpacity }, { opacity: 0 }], {
            duration: Math.max(100, Math.min(200, spring.durationMs)),
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
            fill: "forwards",
          }),
        );
      }
      activeAnimationsRef.current = animations;
      const finalize = () => {
        if (animationGenerationRef.current !== generation) return;
        onDismiss();
        requestAnimationFrame(() => {
          if (animationGenerationRef.current !== generation) return;
          clearInlineStyles();
        });
      };
      popupAnim.onfinish = finalize;
      popupAnim.oncancel = () => {
        if (animationGenerationRef.current !== generation) return;
        clearInlineStyles();
      };
      return;
    }

    // Snap back smoothly to rest using analytical spring inheriting release velocity.
    const spring = createSpringKeyframes(drag.lastOffset.visualDismissOffset, 0, "spatial", {
      initialVelocity: axisVelocity * 1000,
      format: (value) => ({ transform: formatOffsetTransform(side, value) }),
    });
    const popupAnim = popup.animate(spring.keyframes, {
      duration: Math.max(180, spring.durationMs),
      easing: spring.easing,
    });
    const animations: Animation[] = [popupAnim];
    if (backdrop && typeof backdrop.animate === "function") {
      const timing = getSpringWaapiTiming("spatial");
      animations.push(
        backdrop.animate([{ opacity: drag.lastOffset.backdropOpacity }, { opacity: 1 }], {
          duration: Math.min(260, timing.duration),
          easing: timing.easing,
        }),
      );
    }
    activeAnimationsRef.current = animations;
    popupAnim.onfinish = () => {
      if (animationGenerationRef.current !== generation) return;
      clearInlineStyles();
    };
    popupAnim.oncancel = () => {
      if (animationGenerationRef.current !== generation) return;
      clearInlineStyles();
    };
  };

  return {
    onScrollCapture(_event: UIEvent<HTMLElement>) {
      lastScrollAtRef.current = performance.now();
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || event.defaultPrevented || event.button !== 0) return;
      if (isInteractiveDragExcludedTarget(event.target)) return;
      if (isWithinSheetScrollCooldown(performance.now(), lastScrollAtRef.current)) return;
      const popup = popupRef.current;
      if (!popup) return;

      cancelActiveAnimations();

      const rect = popup.getBoundingClientRect();
      const dimension = isHorizontalSide(side) ? rect.width : rect.height;
      if (dimension <= 0) return;

      const tracker = createVelocityTracker(90);
      tracker.push(event.clientX, event.clientY, event.timeStamp);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dimension,
        startTarget: event.target,
        locked: false,
        aborted: false,
        lastOffset: computeSheetDragOffset(side, 0, 0, dimension),
        velocityTracker: tracker,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const drag = dragRef.current;
      const popup = popupRef.current;
      if (!drag || drag.aborted || !popup || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      drag.velocityTracker.push(event.clientX, event.clientY, event.timeStamp);

      if (!drag.locked) {
        const primary = isHorizontalSide(side) ? Math.abs(dx) : Math.abs(dy);
        const cross = isHorizontalSide(side) ? Math.abs(dy) : Math.abs(dx);
        if (primary < DRAG_LOCK_DISTANCE_PX && cross < DRAG_LOCK_DISTANCE_PX) return;

        if (
          cross * DIRECTION_DOMINANCE_RATIO > primary ||
          isWithinSheetScrollCooldown(performance.now(), lastScrollAtRef.current) ||
          hasScrollableRoomInDirection(drag.startTarget, popup, side, dx, dy)
        ) {
          drag.aborted = true;
          return;
        }

        drag.locked = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events in tests may not provide an active pointerId to capture.
        }
        popup.style.transition = "none";
        if (backdropRef.current) {
          backdropRef.current.style.transition = "none";
        }
      }

      const offset = computeSheetDragOffset(side, dx, dy, drag.dimension);
      drag.lastOffset = offset;
      popup.style.transform = `translate3d(${offset.tx.toFixed(2)}px, ${offset.ty.toFixed(2)}px, 0)`;
      if (backdropRef.current) {
        backdropRef.current.style.opacity = offset.backdropOpacity.toFixed(3);
      }
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      finishDrag(event, false);
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      finishDrag(event, true);
    },
  };
}

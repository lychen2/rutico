import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "../lib/motion/springs";
import { observeResize } from "../lib/observeResize";

const HEIGHT_TRANSITION_FALLBACK_MS = 420;

/**
 * Benji Taylor *Family Drawer* dynamic crossfade duration:
 * scales smoothly between 150ms and 270ms based on height delta.
 */
function computeDynamicFadeDurationMs(deltaHeightPx: number): number {
  const seconds = Math.min(0.27, Math.max(0.15, Math.abs(deltaHeightPx) / 500));
  return Math.round(seconds * 1000);
}

export function AnimatedHeight({
  children,
  holdHeight = false,
  contentKey,
}: {
  readonly children: ReactNode;
  readonly holdHeight?: boolean;
  /** Optional view key; when changed, triggers a Family-Drawer dynamic crossfade scaled to height delta. */
  readonly contentKey?: string | number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousHeightRef = useRef<number | null>(null);
  const previousContentKeyRef = useRef<string | number | undefined>(contentKey);
  const fadeAnimationRef = useRef<Animation | null>(null);
  const [heightState, setHeightState] = useState<{
    readonly height: number | null;
    readonly isClipping: boolean;
  }>({ height: null, isClipping: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fallback timer that ends clipping when the height transition never reports its end
  useEffect(() => {
    if (!heightState.isClipping) return;
    const timeoutId = window.setTimeout(() => {
      setHeightState((currentState) =>
        currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
      );
    }, HEIGHT_TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A height change mid-transition starts a new transition, so the fallback timer restarts.
    heightState.height,
    heightState.isClipping,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures offsetHeight and observes content size before paint to animate container morphing
  useLayoutEffect(() => {
    if (holdHeight) return;
    const element = contentRef.current;
    if (!element) return;
    let firstFrameId: number | null = null;
    let secondFrameId: number | null = null;

    const updateHeight = () => {
      // offsetHeight avoids distortion when an ancestor applies CSS scale (e.g. spatial modal recess).
      const nextHeight = Math.ceil(element.offsetHeight || element.scrollHeight);
      const prevHeight = previousHeightRef.current;
      previousHeightRef.current = nextHeight;
      setHeightState((currentState) => {
        if (currentState.height === nextHeight) return currentState;
        return {
          height: nextHeight,
          isClipping: currentState.height !== null,
        };
      });
      return { prevHeight, nextHeight };
    };
    const cancelPendingFrames = () => {
      if (firstFrameId !== null) {
        window.cancelAnimationFrame(firstFrameId);
        firstFrameId = null;
      }
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
        secondFrameId = null;
      }
    };
    const updateHeightAfterPaint = () => {
      cancelPendingFrames();
      updateHeight();
      firstFrameId = window.requestAnimationFrame(() => {
        firstFrameId = null;
        updateHeight();
        secondFrameId = window.requestAnimationFrame(() => {
          secondFrameId = null;
          updateHeight();
        });
      });
    };

    updateHeightAfterPaint();
    const stopObserving = observeResize(element, updateHeightAfterPaint);
    return () => {
      stopObserving();
      cancelPendingFrames();
    };
  }, [holdHeight]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives dynamic Family-Drawer content crossfade when contentKey transitions
  useLayoutEffect(() => {
    const keyChanged = previousContentKeyRef.current !== contentKey;
    previousContentKeyRef.current = contentKey;
    if (!keyChanged || contentKey === undefined) return;

    const element = contentRef.current;
    if (!element || typeof element.animate !== "function" || prefersReducedMotion()) return;

    fadeAnimationRef.current?.cancel();
    const nextHeight = Math.ceil(element.offsetHeight || element.scrollHeight);
    const delta = previousHeightRef.current === null ? 0 : nextHeight - previousHeightRef.current;
    const fadeDurationMs = computeDynamicFadeDurationMs(delta);
    const animation = element.animate(
      [
        { opacity: 0, transform: "translate3d(0, 3px, 0)" },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      {
        duration: fadeDurationMs,
        delay: 40,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "backwards",
      },
    );
    fadeAnimationRef.current = animation;
    return () => {
      animation.cancel();
      if (fadeAnimationRef.current === animation) {
        fadeAnimationRef.current = null;
      }
    };
  }, [contentKey]);

  return (
    <div
      data-slot="animated-height"
      className="transition-[height] duration-(--duration-spatial) ease-(--spring-spatial) motion-reduce:transition-none [overflow-clip-margin:2px]"
      style={
        heightState.height === null
          ? undefined
          : {
              height: heightState.height,
              overflow: holdHeight || heightState.isClipping ? "clip" : "visible",
            }
      }
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "height") return;
        setHeightState((currentState) =>
          currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
        );
      }}
    >
      <div ref={contentRef} style={holdHeight ? { height: "100%" } : undefined}>
        {children}
      </div>
    </div>
  );
}

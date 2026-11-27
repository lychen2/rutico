/**
 * Shared sliding indicator engine (Kubai087 Tip 015(g)):
 * Pure DOM-ref driven WAAPI indicator with mid-flight velocity inheritance and
 * ~15% fluid velocity-proportional squash along the cross-axis.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { observeResize } from "~/lib/observeResize";
import {
  createSpringKeyframes,
  evaluateSpringAt,
  prefersReducedMotion,
  resolveSpringPreset,
  type SpringPresetName,
} from "./springs";

export interface UseSharedIndicatorOptions {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly indicatorRef: RefObject<HTMLElement | null>;
  /** CSS selector matching the currently active item inside `containerRef`. */
  readonly activeSelector: string;
  /** Changing this key triggers an animated move to the newly active item. */
  readonly activeKey: string | number | null | undefined;
  /**
   * Optional layout signature (e.g. item membership/order). Changing this snaps the
   * indicator to the active item's updated bounds without treating it as a selection change.
   */
  readonly layoutKey?: string | number | null | undefined;
  readonly preset?: SpringPresetName;
  /** Maximum cross-axis squash fraction at peak travel speed (default 0.15 = 15%). */
  readonly maxSquash?: number;
  /** Primary travel axis (`"both"` infers horizontal vs vertical per move). */
  readonly axis?: "x" | "y" | "both";
}

interface IndicatorGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ActiveIndicatorMotion {
  readonly animation: Animation;
  readonly from: IndicatorGeometry;
  readonly to: IndicatorGeometry;
  readonly durationMs: number;
  readonly initialVx: number;
  readonly initialVy: number;
  readonly preset: SpringPresetName;
}

interface SharedIndicatorState {
  lastGeometry: IndicatorGeometry | null;
  lastActiveKey: string | number | null | undefined;
  lastLayoutKey: string | number | null | undefined;
  activeMotion: ActiveIndicatorMotion | null;
}

function measureActiveItem(
  container: HTMLElement,
  activeSelector: string,
): IndicatorGeometry | null {
  const activeElement = container.querySelector<HTMLElement>(activeSelector);
  if (!activeElement) return null;
  const containerRect = container.getBoundingClientRect();
  const itemRect = activeElement.getBoundingClientRect();
  if (itemRect.width <= 0 || itemRect.height <= 0) return null;
  return {
    x: itemRect.left - containerRect.left + container.scrollLeft,
    y: itemRect.top - containerRect.top + container.scrollTop,
    width: itemRect.width,
    height: itemRect.height,
  };
}

function applyGeometry(element: HTMLElement, geometry: IndicatorGeometry): void {
  element.style.width = `${geometry.width}px`;
  element.style.height = `${geometry.height}px`;
  element.style.transform = `translate3d(${geometry.x}px, ${geometry.y}px, 0)`;
  element.style.opacity = "1";
  element.setAttribute("data-indicator-ready", "true");
}

function sampleInFlight(active: ActiveIndicatorMotion): {
  readonly geometry: IndicatorGeometry;
  readonly vx: number;
  readonly vy: number;
} {
  const currentTime = active.animation.currentTime;
  const elapsedMs = typeof currentTime === "number" ? currentTime : active.durationMs;
  if (elapsedMs <= 0 || elapsedMs >= active.durationMs) {
    return { geometry: active.to, vx: 0, vy: 0 };
  }
  const params = resolveSpringPreset(active.preset);
  const tSec = elapsedMs / 1000;
  const dx = active.to.x - active.from.x;
  const dy = active.to.y - active.from.y;
  const normVx = Math.abs(dx) > 1e-4 ? active.initialVx / dx : 0;
  const normVy = Math.abs(dy) > 1e-4 ? active.initialVy / dy : 0;
  const sx = evaluateSpringAt(tSec, params, normVx);
  const sy = evaluateSpringAt(tSec, params, normVy);
  const sw = evaluateSpringAt(tSec, params, 0);
  return {
    geometry: {
      x: active.from.x + dx * sx.value,
      y: active.from.y + dy * sy.value,
      width: active.from.width + (active.to.width - active.from.width) * sw.value,
      height: active.from.height + (active.to.height - active.from.height) * sw.value,
    },
    vx: dx * sx.velocity,
    vy: dy * sy.velocity,
  };
}

function syncSharedIndicatorElement(
  container: HTMLElement | null,
  indicator: HTMLElement | null,
  state: SharedIndicatorState,
  config: {
    readonly activeKey: string | number | null | undefined;
    readonly activeSelector: string;
    readonly preset: SpringPresetName;
    readonly maxSquash: number;
    readonly axis: "x" | "y" | "both";
  },
  animate: boolean,
): void {
  if (!container || !indicator) return;

  indicator.style.position = "absolute";
  indicator.style.top = "0px";
  indicator.style.left = "0px";
  indicator.style.pointerEvents = "none";

  const target =
    config.activeKey === null ? null : measureActiveItem(container, config.activeSelector);
  state.lastActiveKey = config.activeKey;
  if (!target) {
    state.activeMotion?.animation.cancel();
    state.activeMotion = null;
    state.lastGeometry = null;
    indicator.style.opacity = "0";
    indicator.removeAttribute("data-indicator-ready");
    return;
  }

  const previousMotion = state.activeMotion;
  let from = state.lastGeometry;
  let initialVx = 0;
  let initialVy = 0;

  if (previousMotion && previousMotion.animation.playState === "running") {
    const sampled = sampleInFlight(previousMotion);
    from = sampled.geometry;
    initialVx = sampled.vx;
    initialVy = sampled.vy;
    previousMotion.animation.cancel();
    state.activeMotion = null;
  }

  const win = container.ownerDocument.defaultView ?? globalThis.window;
  const shouldAnimate =
    animate &&
    from !== null &&
    !prefersReducedMotion(win) &&
    typeof indicator.animate === "function";

  applyGeometry(indicator, target);
  state.lastGeometry = target;

  if (!shouldAnimate || !from) return;

  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dw = target.width - from.width;
  const dh = target.height - from.height;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dw) < 0.5 && Math.abs(dh) < 0.5) {
    return;
  }

  const samples = 28;
  const xSpring = createSpringKeyframes(from.x, target.x, config.preset, {
    initialVelocity: initialVx,
    samples,
    format: (v) => ({ v }) as unknown as Keyframe,
  });
  const ySpring = createSpringKeyframes(from.y, target.y, config.preset, {
    initialVelocity: initialVy,
    samples,
    format: (v) => ({ v }) as unknown as Keyframe,
  });
  const wSpring = createSpringKeyframes(from.width, target.width, config.preset, {
    samples,
    format: (v) => ({ v }) as unknown as Keyframe,
  });
  const hSpring = createSpringKeyframes(from.height, target.height, config.preset, {
    samples,
    format: (v) => ({ v }) as unknown as Keyframe,
  });

  const durationMs = Math.max(xSpring.durationMs, ySpring.durationMs, 120);
  const clampedSquash = Math.max(0, Math.min(0.2, config.maxSquash));
  const horizontalDominant =
    config.axis === "x" || (config.axis === "both" && Math.abs(dx) >= Math.abs(dy));

  const keyframes: Keyframe[] = [];
  for (let i = 0; i < samples; i += 1) {
    const curX = Number((xSpring.keyframes[i] as unknown as { v: number })?.v ?? target.x);
    const curY = Number((ySpring.keyframes[i] as unknown as { v: number })?.v ?? target.y);
    const curW = Math.max(
      1,
      Number((wSpring.keyframes[i] as unknown as { v: number })?.v ?? target.width),
    );
    const curH = Math.max(
      1,
      Number((hSpring.keyframes[i] as unknown as { v: number })?.v ?? target.height),
    );

    // Estimate instantaneous travel speed from adjacent spring samples for fluid ~15% squash.
    const prevIdx = Math.max(0, i - 1);
    const prevX = Number((xSpring.keyframes[prevIdx] as unknown as { v: number })?.v ?? curX);
    const prevY = Number((ySpring.keyframes[prevIdx] as unknown as { v: number })?.v ?? curY);
    const stepDist = Math.hypot(curX - prevX, curY - prevY);
    const speedRatio =
      i === 0 || i === samples - 1 ? 0 : Math.min(1, stepDist / Math.max(12, target.height * 0.8));
    const squash = clampedSquash * speedRatio;
    const scaleX = (curW / target.width) * (horizontalDominant ? 1 + squash * 0.45 : 1 - squash);
    const scaleY = (curH / target.height) * (horizontalDominant ? 1 - squash : 1 + squash * 0.45);

    keyframes.push({
      transform: `translate3d(${curX.toFixed(2)}px, ${curY.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`,
    });
  }

  const animation = indicator.animate(keyframes, {
    duration: durationMs,
    easing: "linear",
  });

  const motion: ActiveIndicatorMotion = {
    animation,
    from,
    to: target,
    durationMs,
    initialVx,
    initialVy,
    preset: config.preset,
  };
  state.activeMotion = motion;
  animation.addEventListener(
    "finish",
    () => {
      if (state.activeMotion?.animation === animation) {
        state.activeMotion = null;
      }
    },
    { once: true },
  );
}

export function useSharedIndicator({
  containerRef,
  indicatorRef,
  activeSelector,
  activeKey,
  layoutKey,
  preset = "fluid",
  maxSquash = 0.15,
  axis = "both",
}: UseSharedIndicatorOptions): void {
  const stateRef = useRef<SharedIndicatorState>({
    lastGeometry: null,
    lastActiveKey: undefined,
    lastLayoutKey: undefined,
    activeMotion: null,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures active item DOM bounds before paint to move indicator via WAAPI
  useLayoutEffect(() => {
    const state = stateRef.current;
    state.lastLayoutKey = layoutKey;
    syncSharedIndicatorElement(
      containerRef.current,
      indicatorRef.current,
      state,
      { activeKey, activeSelector, preset, maxSquash, axis },
      state.lastGeometry !== null && state.lastActiveKey !== activeKey,
    );
  }, [activeKey, activeSelector, axis, containerRef, indicatorRef, layoutKey, maxSquash, preset]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resyncs shared indicator geometry on container resize or child membership changes without animating
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const state = stateRef.current;
    const resyncWithoutAnimation = () => {
      syncSharedIndicatorElement(
        container,
        indicatorRef.current,
        state,
        { activeKey: state.lastActiveKey, activeSelector, preset, maxSquash, axis },
        false,
      );
    };
    const stop = observeResize(container, resyncWithoutAnimation);
    const mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(resyncWithoutAnimation) : null;
    mutationObserver?.observe(container, { childList: true });
    return () => {
      stop();
      mutationObserver?.disconnect();
      state.activeMotion?.animation.cancel();
      state.activeMotion = null;
    };
  }, [activeSelector, axis, containerRef, indicatorRef, maxSquash, preset]);
}

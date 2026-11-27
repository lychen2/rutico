import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { prefersReducedMotion } from "../lib/motion/springs";
import { cn, isMacPlatform } from "../lib/utils";
import { canNavigateHistory, navigateHistory, type HistoryDirection } from "../navigationHistory";

const SWIPE_TRIGGER_DISTANCE = 120;
// Movement needed before the gesture picks an axis; first events are often diagonal.
const SWIPE_AXIS_LOCK_DISTANCE = 8;
// Vertical scrolls drift sideways, so a swipe's horizontal travel must clearly dominate once
// it has moved far enough for its direction to be more than noise.
const SWIPE_HORIZONTAL_DOMINANCE = 2;
const SWIPE_DOMINANCE_DISTANCE = 30;
const MOMENTUM_SAMPLE_SIZE = 5;

const LINUX_WHEEL_SWIPE_STORAGE_KEY = "t3code:linux-wheel-history-swipe";
const MAC_BROWSER_WHEEL_QUIET_TIMEOUT_MS = 140;
const LINUX_WHEEL_QUIET_TIMEOUT_MS = 110;
const LINUX_WHEEL_MIN_EVENTS = 3;
const DISCRETE_NAV_DEDUPE_WINDOW_MS = 100;
const EDGE_PULSE_DURATION_MS = 220;
const MAX_PARALLAX_PX = 12;
const DISCRETE_NUDGE_PX = 6;

const BLOCKED_NAVIGATION_TARGET_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-preview-panel-mode], [data-preview-viewport], [data-server-browser-surface], webview';

const OPEN_MODAL_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

const EDITABLE_KEY_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [data-keybinding-capture], .xterm';

type SwipeBounds = { left: number; top: number; width: number; height: number };
type SwipeGesture =
  | { kind: "pending"; path: EventTarget[]; y: number; sumX: number; sumY: number }
  | {
      kind: "tracking";
      direction: HistoryDirection;
      distance: number;
      deltas: number[];
      travelX: number;
      travelY: number;
      y: number;
      bounds: SwipeBounds;
    }
  // Not a swipe, or one already decided: the rest of its events are ignored.
  | { kind: "ignored" };

type LinuxWheelGesture =
  | {
      kind: "pending";
      path: EventTarget[];
      y: number;
      sumX: number;
      sumY: number;
      events: number;
    }
  | {
      kind: "tracking";
      direction: HistoryDirection;
      distance: number;
      travelX: number;
      travelY: number;
      events: number;
      y: number;
      bounds: SwipeBounds;
    }
  | { kind: "ignored" };

type SwipeIndicatorState = {
  direction: HistoryDirection;
  progress: number;
  y: number;
  bounds: SwipeBounds;
  tracking: boolean;
  pulse?: boolean;
};

type DiscreteNavigationSource = "alt-arrow" | "mouse-button" | "app-command";

function readMainContentElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
}

function readMainContentBounds(): SwipeBounds {
  const main = readMainContentElement();
  if (!main) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const { left, top, width, height } = main.getBoundingClientRect();
  return { left, top, width, height };
}

function applySidebarInsetParallax(direction: HistoryDirection, offsetPx: number): void {
  if (prefersReducedMotion()) return;
  const main = readMainContentElement();
  if (!main) return;
  const clamped = Math.max(0, Math.min(MAX_PARALLAX_PX, offsetPx));
  if (clamped <= 0.1) {
    main.style.removeProperty("transform");
    return;
  }
  const signed = direction === "back" ? clamped : -clamped;
  main.style.transform = `translate3d(${signed.toFixed(1)}px, 0, 0)`;
}

function clearSidebarInsetParallax(): void {
  const main = readMainContentElement();
  main?.style.removeProperty("transform");
}

function isLinuxWheelSwipeOptedIn(override?: boolean): boolean {
  if (override !== undefined) return override;
  try {
    return window.localStorage.getItem(LINUX_WHEEL_SWIPE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function isBlockedNavigationPath(path: readonly EventTarget[]): boolean {
  return path.some(
    (node) => node instanceof Element && node.matches(BLOCKED_NAVIGATION_TARGET_SELECTOR),
  );
}

function isHiddenOrClosedModal(element: Element): boolean {
  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    element.hasAttribute("inert") ||
    (element.hasAttribute("data-closed") && !element.hasAttribute("data-ending-style"))
  ) {
    return true;
  }
  const style = getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden";
}

function hasOpenModalDialog(): boolean {
  for (const dialog of document.querySelectorAll(OPEN_MODAL_DIALOG_SELECTOR)) {
    if (!isHiddenOrClosedModal(dialog)) {
      return true;
    }
  }
  return false;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(EDITABLE_KEY_TARGET_SELECTOR) !== null;
}

// `event.target` stops at a shadow host; the composed path also reaches scrollers inside it.
function hasHorizontalScroller(path: readonly EventTarget[]): boolean {
  for (const element of path) {
    if (!(element instanceof Element) || element.scrollWidth <= element.clientWidth) continue;
    const { overflowX } = getComputedStyle(element);
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    return true;
  }
  return false;
}

function isVerticalScroll(travelX: number, travelY: number): boolean {
  return (
    travelX + travelY >= SWIPE_DOMINANCE_DISTANCE && travelX <= SWIPE_HORIZONTAL_DOMINANCE * travelY
  );
}

function lockSwipeAxis(
  pending: Extract<SwipeGesture, { kind: "pending" }>,
): Exclude<SwipeGesture, { kind: "pending" }> {
  const { path, sumX, sumY } = pending;
  if (Math.abs(sumX) <= Math.abs(sumY) || isVerticalScroll(Math.abs(sumX), Math.abs(sumY))) {
    return { kind: "ignored" };
  }
  // Preview contents can scroll in another document or on the server, outside this DOM.
  if (isBlockedNavigationPath(path)) {
    return { kind: "ignored" };
  }
  if (hasHorizontalScroller(path)) return { kind: "ignored" };
  const direction = sumX < 0 ? "back" : "forward";
  if (!canNavigateHistory(direction)) return { kind: "ignored" };
  return {
    kind: "tracking",
    direction,
    distance: Math.abs(sumX),
    deltas: [],
    travelX: Math.abs(sumX),
    travelY: Math.abs(sumY),
    y: pending.y,
    bounds: readMainContentBounds(),
  };
}

/**
 * macOS momentum after the fingers lift decays by a near-constant ratio per
 * event; finger movement is noisier. Deltas are signed along the swipe.
 */
export function isMomentumTail(deltas: readonly number[]): boolean {
  if (deltas.length < MOMENTUM_SAMPLE_SIZE) return false;
  const recent = deltas.slice(-MOMENTUM_SAMPLE_SIZE);
  if (recent.some((delta) => delta <= 0)) return false;
  const ratios = recent.slice(1).map((delta, index) => delta / recent[index]!);
  return (
    ratios.every((ratio) => ratio >= 0.7 && ratio < 1) &&
    Math.max(...ratios) - Math.min(...ratios) < 0.1
  );
}

/**
 * Single history navigation owner: preserves macOS trackpad swipes, and handles non-macOS
 * Alt+Arrows, Electron app-command, DOM button=3/4 (deduped), plus opt-in wheel swipes.
 */
export function HistorySwipeNavigation({
  enableLinuxWheelSwipe,
}: {
  readonly enableLinuxWheelSwipe?: boolean;
} = {}) {
  const [swipe, setSwipe] = useState<SwipeIndicatorState | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- coordinates window wheel, discrete keyboard/mouse, and Electron app-command history navigation
  useEffect(() => {
    const isMac = isMacPlatform(navigator.platform);
    let pulseTimerId: number | null = null;
    const clearPulseTimer = () => {
      if (pulseTimerId !== null) {
        window.clearTimeout(pulseTimerId);
        pulseTimerId = null;
      }
    };

    const showEdgePulse = (direction: HistoryDirection) => {
      clearPulseTimer();
      const bounds = readMainContentBounds();
      setSwipe({
        direction,
        progress: 1,
        y: bounds.top + bounds.height / 2,
        bounds,
        tracking: true,
        pulse: true,
      });
      applySidebarInsetParallax(direction, DISCRETE_NUDGE_PX);
      pulseTimerId = window.setTimeout(() => {
        pulseTimerId = null;
        clearSidebarInsetParallax();
        setSwipe((current) => (current?.pulse ? { ...current, tracking: false } : current));
      }, EDGE_PULSE_DURATION_MS);
    };

    if (isMac) {
      let gesture: SwipeGesture | null = null;
      let macQuietTimerId: number | null = null;
      const clearMacQuietTimer = () => {
        if (macQuietTimerId !== null) {
          window.clearTimeout(macQuietTimerId);
          macQuietTimerId = null;
        }
      };
      const hideIndicator = () => {
        clearSidebarInsetParallax();
        setSwipe((current) => (current === null ? null : { ...current, tracking: false }));
      };
      // The fingers lifted: navigate if the swipe went far enough, then ignore its momentum.
      const release = () => {
        if (gesture?.kind === "tracking" && gesture.distance >= SWIPE_TRIGGER_DISTANCE) {
          navigateHistory(gesture.direction);
        }
        gesture = { kind: "ignored" };
        hideIndicator();
      };
      // Chromium brackets each trackpad scroll, momentum included, with these in Electron.
      const unsubscribeScrollBegin = window.desktopBridge?.onTrackpadScrollBegin?.(() => {
        if (gesture?.kind === "ignored") gesture = null;
      });
      const unsubscribeScrollEnd = window.desktopBridge?.onTrackpadScrollEnd?.(() => {
        if (gesture?.kind === "tracking") release();
        gesture = null;
      });
      const hasTrackpadScrollPhases =
        unsubscribeScrollBegin !== undefined && unsubscribeScrollEnd !== undefined;
      const scheduleMacBrowserQuietReset = () => {
        if (hasTrackpadScrollPhases) return;
        clearMacQuietTimer();
        macQuietTimerId = window.setTimeout(() => {
          macQuietTimerId = null;
          if (gesture?.kind === "tracking") release();
          gesture = null;
        }, MAC_BROWSER_WHEEL_QUIET_TIMEOUT_MS);
      };
      const onWheel = (event: WheelEvent) => {
        scheduleMacBrowserQuietReset();
        if (event.shiftKey) {
          if (gesture?.kind === "tracking") hideIndicator();
          gesture = { kind: "ignored" };
          return;
        }
        if (gesture === null) {
          gesture =
            event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
              ? { kind: "ignored" }
              : { kind: "pending", path: event.composedPath(), y: event.clientY, sumX: 0, sumY: 0 };
        }
        if (gesture.kind === "ignored") return;
        if (gesture.kind === "pending") {
          gesture.sumX += event.deltaX;
          gesture.sumY += event.deltaY;
          if (Math.abs(gesture.sumX) + Math.abs(gesture.sumY) < SWIPE_AXIS_LOCK_DISTANCE) return;
          gesture = lockSwipeAxis({ ...gesture, path: [...gesture.path, ...event.composedPath()] });
          if (gesture.kind === "ignored") return;
        } else {
          const delta = gesture.direction === "back" ? -event.deltaX : event.deltaX;
          if (event.deltaX === 0 && event.deltaY === 0) return release();
          gesture.travelX += Math.abs(event.deltaX);
          gesture.travelY += Math.abs(event.deltaY);
          if (isVerticalScroll(gesture.travelX, gesture.travelY)) {
            gesture = { kind: "ignored" };
            return hideIndicator();
          }
          gesture.deltas = [...gesture.deltas.slice(1 - MOMENTUM_SAMPLE_SIZE), delta];
          if (isMomentumTail(gesture.deltas)) return release();
          gesture.distance = Math.max(0, gesture.distance + delta);
        }
        const progress = Math.min(1, gesture.distance / SWIPE_TRIGGER_DISTANCE);
        applySidebarInsetParallax(gesture.direction, progress * MAX_PARALLAX_PX);
        setSwipe({
          direction: gesture.direction,
          progress,
          y: gesture.y,
          bounds: gesture.bounds,
          tracking: true,
        });
      };
      window.addEventListener("wheel", onWheel, { capture: true, passive: true });
      return () => {
        clearPulseTimer();
        clearMacQuietTimer();
        clearSidebarInsetParallax();
        unsubscribeScrollBegin?.();
        unsubscribeScrollEnd?.();
        window.removeEventListener("wheel", onWheel, { capture: true });
      };
    }

    // Non-macOS (Linux / Windows): single navigation owner for discrete inputs + opt-in wheel swipe.
    let lastDiscreteNav: {
      readonly direction: HistoryDirection;
      readonly source: DiscreteNavigationSource;
      readonly timestampMs: number;
    } | null = null;
    let lastBlockedThumbButtonAtMs = -Infinity;

    const triggerDiscreteNavigation = (
      direction: HistoryDirection,
      source: DiscreteNavigationSource,
    ) => {
      const now = performance.now();
      // Electron on Linux can fire both DOM mouseup(button=3/4) and BrowserWindow app-command
      // for the exact same hardware click; coalesce the companion pair into a single step.
      const isCompanionPair =
        lastDiscreteNav !== null &&
        lastDiscreteNav.direction === direction &&
        now - lastDiscreteNav.timestampMs <= DISCRETE_NAV_DEDUPE_WINDOW_MS &&
        ((lastDiscreteNav.source === "mouse-button" && source === "app-command") ||
          (lastDiscreteNav.source === "app-command" && source === "mouse-button"));
      if (isCompanionPair) return;

      if (
        source === "app-command" &&
        now - lastBlockedThumbButtonAtMs <= DISCRETE_NAV_DEDUPE_WINDOW_MS
      ) {
        return;
      }

      if (hasOpenModalDialog()) return;

      if (!canNavigateHistory(direction)) return;
      lastDiscreteNav = { direction, source, timestampMs: now };
      showEdgePulse(direction);
      navigateHistory(direction);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const path = event.composedPath();
      if (isBlockedNavigationPath(path) || isEditableKeyboardTarget(event.target)) return;
      const direction: HistoryDirection = event.key === "ArrowLeft" ? "back" : "forward";
      if (!canNavigateHistory(direction)) return;
      event.preventDefault();
      triggerDiscreteNavigation(direction, "alt-arrow");
    };

    // Capture-phase observer records thumb clicks targeting blocked surfaces (modals, guest
    // previews) so a companion Electron app-command never leaks through to host app history.
    const onMouseUpCapture = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      if (isBlockedNavigationPath(event.composedPath())) {
        lastBlockedThumbButtonAtMs = performance.now();
      }
    };

    // Bubble-phase handler respects ServerBrowserSurface's preventDefault()/stopPropagation()
    // ownership while preventing Chromium's native back/forward from double-navigating.
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      if (event.defaultPrevented) return;
      if (isBlockedNavigationPath(event.composedPath())) return;
      const direction: HistoryDirection = event.button === 3 ? "back" : "forward";
      event.preventDefault();
      triggerDiscreteNavigation(direction, "mouse-button");
    };

    const unsubscribeMenuAction = window.desktopBridge?.onMenuAction((action) => {
      if (action === "history.app-command:back") {
        triggerDiscreteNavigation("back", "app-command");
      } else if (action === "history.app-command:forward") {
        triggerDiscreteNavigation("forward", "app-command");
      }
    });

    // Optional Linux horizontal trackpad swipe heuristic (default OFF; bounded timeout FSM).
    let linuxGesture: LinuxWheelGesture | null = null;
    let linuxQuietTimerId: number | null = null;
    const clearLinuxQuietTimer = () => {
      if (linuxQuietTimerId !== null) {
        window.clearTimeout(linuxQuietTimerId);
        linuxQuietTimerId = null;
      }
    };
    const endLinuxWheelGesture = (commit: boolean) => {
      clearLinuxQuietTimer();
      const active = linuxGesture;
      linuxGesture = null;
      clearSidebarInsetParallax();
      if (
        commit &&
        active?.kind === "tracking" &&
        active.events >= LINUX_WHEEL_MIN_EVENTS &&
        active.distance >= SWIPE_TRIGGER_DISTANCE
      ) {
        navigateHistory(active.direction);
      }
      setSwipe((current) =>
        current === null || current.pulse ? current : { ...current, tracking: false },
      );
    };

    const onLinuxWheel = (event: WheelEvent) => {
      if (!isLinuxWheelSwipeOptedIn(enableLinuxWheelSwipe)) return;
      if (event.shiftKey || event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        if (linuxGesture?.kind === "tracking") endLinuxWheelGesture(false);
        linuxGesture = { kind: "ignored" };
        clearLinuxQuietTimer();
        linuxQuietTimerId = window.setTimeout(() => {
          linuxQuietTimerId = null;
          linuxGesture = null;
        }, LINUX_WHEEL_QUIET_TIMEOUT_MS);
        return;
      }

      if (linuxGesture === null) {
        linuxGesture = {
          kind: "pending",
          path: event.composedPath(),
          y: event.clientY,
          sumX: 0,
          sumY: 0,
          events: 0,
        };
      }

      clearLinuxQuietTimer();
      linuxQuietTimerId = window.setTimeout(() => {
        linuxQuietTimerId = null;
        endLinuxWheelGesture(true);
      }, LINUX_WHEEL_QUIET_TIMEOUT_MS);

      if (linuxGesture.kind === "ignored") return;
      if (linuxGesture.kind === "pending") {
        linuxGesture.sumX += event.deltaX;
        linuxGesture.sumY += event.deltaY;
        linuxGesture.events += 1;
        if (Math.abs(linuxGesture.sumX) + Math.abs(linuxGesture.sumY) < SWIPE_AXIS_LOCK_DISTANCE) {
          return;
        }
        const locked = lockSwipeAxis({
          kind: "pending",
          path: [...linuxGesture.path, ...event.composedPath()],
          y: linuxGesture.y,
          sumX: linuxGesture.sumX,
          sumY: linuxGesture.sumY,
        });
        if (locked.kind === "ignored") {
          linuxGesture = { kind: "ignored" };
          return;
        }
        linuxGesture = {
          kind: "tracking",
          direction: locked.direction,
          distance: locked.distance,
          travelX: locked.travelX,
          travelY: locked.travelY,
          events: linuxGesture.events,
          y: locked.y,
          bounds: locked.bounds,
        };
      } else {
        const delta = linuxGesture.direction === "back" ? -event.deltaX : event.deltaX;
        if (event.deltaX === 0 && event.deltaY === 0) {
          endLinuxWheelGesture(true);
          return;
        }
        linuxGesture.travelX += Math.abs(event.deltaX);
        linuxGesture.travelY += Math.abs(event.deltaY);
        linuxGesture.events += 1;
        if (isVerticalScroll(linuxGesture.travelX, linuxGesture.travelY)) {
          endLinuxWheelGesture(false);
          linuxGesture = { kind: "ignored" };
          return;
        }
        linuxGesture.distance = Math.max(0, linuxGesture.distance + delta);
      }

      const progress = Math.min(1, linuxGesture.distance / SWIPE_TRIGGER_DISTANCE);
      applySidebarInsetParallax(linuxGesture.direction, progress * MAX_PARALLAX_PX);
      setSwipe({
        direction: linuxGesture.direction,
        progress,
        y: linuxGesture.y,
        bounds: linuxGesture.bounds,
        tracking: true,
      });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUpCapture, { capture: true });
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onLinuxWheel, { capture: true, passive: true });
    return () => {
      clearPulseTimer();
      clearLinuxQuietTimer();
      clearSidebarInsetParallax();
      unsubscribeMenuAction?.();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUpCapture, { capture: true });
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onLinuxWheel, { capture: true });
    };
  }, [enableLinuxWheelSwipe]);

  return swipe === null ? null : <SwipeIndicator {...swipe} />;
}

// A circle pinned to the edge of the main content that peeks in up to half its width.
function SwipeIndicator({ direction, progress, y, bounds, tracking, pulse }: SwipeIndicatorState) {
  const armed = progress >= 1;
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  const hidden = 100 - progress * 50;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-100 overflow-hidden"
      data-slot="history-swipe-overlay"
      style={bounds}
    >
      <div
        className={cn(
          "absolute flex size-14 items-center rounded-full bg-muted text-foreground dark:bg-black dark:text-white",
          direction === "back" ? "left-0 justify-end pr-2" : "right-0 justify-start pl-2",
          !tracking && "transition-[opacity,transform] duration-200 ease-out",
        )}
        data-history-edge-pulse={pulse ? direction : undefined}
        data-slot="history-swipe-orb"
        style={{
          top: `clamp(0px, calc(${y - bounds.top}px - 1.75rem), calc(100% - 3.5rem))`,
          opacity: tracking ? 1 : 0,
          transform: `translateX(${direction === "back" ? -hidden : hidden}%)`,
        }}
      >
        <Icon
          className={cn(
            "size-4 transition-opacity duration-100",
            armed ? "opacity-100" : "opacity-40",
          )}
        />
      </div>
    </div>
  );
}

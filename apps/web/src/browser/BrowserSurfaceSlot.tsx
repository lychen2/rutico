import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";
import { observeResize } from "../lib/observeResize";

const geometrySyncListeners = new Set<(durationMs: number) => void>();

/**
 * Coordinates `<webview>` / `BrowserSurfaceSlot` geometry commits across animated
 * layout transitions (double-click reset, maximize/restore, device morph, PiP throw)
 * so guest hit-testing and visual bounds stay locked on every frame (`P1-1`).
 */
export function pulseBrowserSurfaceGeometrySync(durationMs = 280): void {
  const safeDuration = Math.max(32, Math.min(1200, Math.round(durationMs)));
  for (const listener of geometrySyncListeners) {
    listener(safeDuration);
  }
}

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const updateRef = useRef<(() => void) | null>(null);

  // The lease lives as long as this element for one tab, so the ref callback owns it.
  const attachSurface = (element: HTMLDivElement) => {
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    let syncFrameId: number | null = null;
    let syncUntil = 0;

    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.cornerRadius,
        presentation.zIndex,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          presentation.cornerRadius,
          presentation.zIndex,
        );
      }
    };

    const tickSync = () => {
      syncFrameId = null;
      update();
      if (performance.now() < syncUntil) {
        syncFrameId = window.requestAnimationFrame(tickSync);
      }
    };

    const startSyncWindow = (durationMs: number) => {
      const nextUntil = performance.now() + durationMs;
      if (nextUntil > syncUntil) syncUntil = nextUntil;
      if (syncFrameId === null) {
        syncFrameId = window.requestAnimationFrame(tickSync);
      }
    };

    const onTransitionRun = () => startSyncWindow(340);
    const onTransitionDone = () => {
      syncUntil = 0;
      if (syncFrameId !== null) {
        window.cancelAnimationFrame(syncFrameId);
        syncFrameId = null;
      }
      update();
    };

    updateRef.current = update;
    update();
    geometrySyncListeners.add(startSyncWindow);

    const observed: Element[] = [element];
    // Inline shells animate without resizing the slot, so observe the shell too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observed.push(panel);
    // Sidebar width changes move the slot without changing its size or column offset.
    observed.push(...document.querySelectorAll('[data-slot="sidebar-gap"]'));
    const stopObserving = observeResize(observed, update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    element.addEventListener("transitionrun", onTransitionRun);
    element.addEventListener("transitionend", onTransitionDone);
    element.addEventListener("transitioncancel", onTransitionDone);
    panel?.addEventListener("transitionrun", onTransitionRun);
    panel?.addEventListener("transitionend", onTransitionDone);
    panel?.addEventListener("transitioncancel", onTransitionDone);
    return () => {
      geometrySyncListeners.delete(startSyncWindow);
      if (syncFrameId !== null) window.cancelAnimationFrame(syncFrameId);
      stopObserving();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      element.removeEventListener("transitionrun", onTransitionRun);
      element.removeEventListener("transitionend", onTransitionDone);
      element.removeEventListener("transitioncancel", onTransitionDone);
      panel?.removeEventListener("transitionrun", onTransitionRun);
      panel?.removeEventListener("transitionend", onTransitionDone);
      panel?.removeEventListener("transitioncancel", onTransitionDone);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes visibility, radius and stacking to the desktop browser surface after layout
  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    updateRef.current?.();
  }, [
    cornerRadius,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A layoutVersion bump means the slot moved without resizing, so it re-presents at the new position.
    layoutVersion,
    visible,
    zIndex,
  ]);

  return <div ref={attachSurface} className={className} data-browser-surface-slot={tabId} />;
}

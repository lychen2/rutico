import { useEffect, useRef, useState } from "react";

export interface DelayedFlagController {
  getVisible: () => boolean;
  setActive: (active: boolean) => void;
  dispose: () => void;
}

export interface DelayedFlagOptions {
  readonly delayMs?: number;
  readonly minHoldMs?: number;
  readonly now?: () => number;
  readonly setTimeout?: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof globalThis.setTimeout>;
  readonly clearTimeout?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
}

/**
 * Pure timer state machine for anti-flicker loading visibility (Kubai087 Tip 017):
 * - Suppresses flashes shorter than `delayMs` (default 300ms)
 * - Once visible, stays visible for at least `minHoldMs` (default 500ms)
 */
export function createDelayedFlagController(
  onChange: (visible: boolean) => void,
  options?: DelayedFlagOptions,
): DelayedFlagController {
  const delayMs = Math.max(0, options?.delayMs ?? 300);
  const minHoldMs = Math.max(0, options?.minHoldMs ?? 500);
  const now = options?.now ?? (() => Date.now());
  const schedule = options?.setTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
  const cancel = options?.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));

  let visible = false;
  let shownAt: number | null = null;
  let pendingTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const clearPending = () => {
    if (pendingTimer !== null) {
      cancel(pendingTimer);
      pendingTimer = null;
    }
  };

  return {
    getVisible: () => visible,
    setActive: (active: boolean) => {
      clearPending();
      if (active) {
        if (visible) return;
        pendingTimer = schedule(() => {
          pendingTimer = null;
          visible = true;
          shownAt = now();
          onChange(true);
        }, delayMs);
        return;
      }

      if (!visible) return;
      const elapsed = shownAt === null ? minHoldMs : now() - shownAt;
      const remaining = Math.max(0, minHoldMs - elapsed);
      pendingTimer = schedule(() => {
        pendingTimer = null;
        visible = false;
        shownAt = null;
        onChange(false);
      }, remaining);
    },
    dispose: () => {
      clearPending();
    },
  };
}

/**
 * Anti-flicker loading gate (Kubai087 Tip 017).
 *
 * Waits `delayMs` (default 300ms) before revealing a loading indicator and holds it
 * visible for at least `minHoldMs` (default 500ms) once shown.
 */
export function useDelayedFlag(active: boolean, delayMs = 300, minHoldMs = 500): boolean {
  const [visible, setVisible] = useState(false);
  const controllerRef = useRef<DelayedFlagController | null>(null);
  const latestActiveRef = useRef(active);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- manages delayed enter and minimum-hold exit timers for loading indicators
  useEffect(() => {
    const controller = createDelayedFlagController(setVisible, { delayMs, minHoldMs });
    controllerRef.current = controller;
    controller.setActive(latestActiveRef.current);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [delayMs, minHoldMs]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives delayed visibility timers when active toggles
  useEffect(() => {
    latestActiveRef.current = active;
    controllerRef.current?.setActive(active);
  }, [active]);

  return visible;
}

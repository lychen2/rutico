import * as Schema from "effect/Schema";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { pulseBrowserSurfaceGeometrySync } from "~/browser/BrowserSurfaceSlot";
import { prefersReducedMotion } from "~/lib/motion/springs";
import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";
import { useStableCallback } from "./useStableCallback";

const WidthSchema = Schema.Finite;

/** The host must size itself from this custom property. */
export const RESIZABLE_WIDTH_PROPERTY = "--resizable-width";

export const DEFAULT_MAGNETIC_SNAP_RATIOS = [1 / 3, 0.5, 2 / 3] as const;
export const DEFAULT_MAGNETIC_SNAP_THRESHOLD_PX = 10;

interface MagneticSnapConfig {
  readonly ratios?: readonly number[] | undefined;
  readonly thresholdPx?: number | undefined;
}

interface MagneticSnapMatch {
  readonly width: number;
  readonly ratio: number;
  readonly snappedRatio: number | null;
}

/**
 * Resolves magnetic golden-ratio detents (`33% / 50% / 66%` within `±10px`)
 * relative to the parent split row width. Holding `Alt` bypasses snapping.
 */
export function resolveMagneticSnapWidth(options: {
  readonly rawWidth: number;
  readonly containerWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly snapRatios?: readonly number[] | undefined;
  readonly thresholdPx?: number | undefined;
  readonly bypassSnap?: boolean | undefined;
}): MagneticSnapMatch {
  const min = Math.min(options.minWidth, options.maxWidth);
  const max = Math.max(options.minWidth, options.maxWidth);
  const clamped = Math.max(min, Math.min(max, Math.round(options.rawWidth)));
  const containerWidth = options.containerWidth;

  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { width: clamped, ratio: 0, snappedRatio: null };
  }

  const ratios = options.snapRatios;
  const thresholdPx = options.thresholdPx ?? DEFAULT_MAGNETIC_SNAP_THRESHOLD_PX;

  if (!options.bypassSnap && ratios && ratios.length > 0 && thresholdPx > 0) {
    let bestRatio: number | null = null;
    let bestTargetWidth = clamped;
    let bestDistance = thresholdPx + 1;

    for (const ratio of ratios) {
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) continue;
      const targetWidth = Math.round(containerWidth * ratio);
      if (targetWidth < min || targetWidth > max) continue;
      const distance = Math.abs(clamped - targetWidth);
      if (distance <= thresholdPx && distance < bestDistance) {
        bestDistance = distance;
        bestRatio = ratio;
        bestTargetWidth = targetWidth;
      }
    }

    if (bestRatio !== null) {
      return {
        width: bestTargetWidth,
        ratio: bestRatio,
        snappedRatio: bestRatio,
      };
    }
  }

  return {
    width: clamped,
    ratio: clamped / containerWidth,
    snappedRatio: null,
  };
}

export interface UseResizableWidthOptions {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly edge: "left" | "right";
  /** Enables magnetic snap detents (`33% / 50% / 66%` by default). Consumed by split panes & C079. */
  readonly magneticSnap?: boolean | MagneticSnapConfig | undefined;
  /** Optional observer invoked on every drag frame with the live magnetic snap result. */
  readonly onMagneticSnap?: ((match: MagneticSnapMatch) => void) | undefined;
}

export interface ResizableWidthHandlers {
  readonly ref: (node: HTMLElement | null) => (() => void) | undefined;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

function updateDividerHud(
  handle: HTMLElement,
  match: MagneticSnapMatch,
  containerWidth: number,
  clientY: number,
) {
  const snapped = match.snappedRatio !== null;
  handle.dataset.resizing = "true";
  handle.dataset.snapped = snapped ? "true" : "false";

  const hud = handle.querySelector<HTMLElement>("[data-resize-hud]");
  if (!hud) return;
  const handleRect = handle.getBoundingClientRect();
  const clampedLocalY = Math.max(
    24,
    Math.min(Math.max(24, handleRect.height - 24), clientY - handleRect.top),
  );
  hud.dataset.visible = "true";
  hud.dataset.snapped = snapped ? "true" : "false";
  hud.style.transform = `translate3d(0, ${Math.round(clampedLocalY)}px, 0)`;
  hud.textContent =
    containerWidth > 0
      ? `${Math.round(match.ratio * 100)}% · ${Math.round(match.width)}px`
      : `${Math.round(match.width)}px`;
}

function clearDividerHud(handle: HTMLElement) {
  delete handle.dataset.resizing;
  delete handle.dataset.snapped;
  const hud = handle.querySelector<HTMLElement>("[data-resize-hud]");
  if (!hud) return;
  delete hud.dataset.visible;
  delete hud.dataset.snapped;
}

/** Uses the current default until a width is chosen; persists on drag end, not every frame. */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly setWidth: (width: number) => void;
  readonly resetToDefault: () => void;
  readonly resetVersion: number;
  readonly handlers: ResizableWidthHandlers;
} {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge, magneticSnap, onMagneticSnap } =
    options;
  const snapRatios =
    magneticSnap === true
      ? DEFAULT_MAGNETIC_SNAP_RATIOS
      : typeof magneticSnap === "object"
        ? (magneticSnap.ratios ?? DEFAULT_MAGNETIC_SNAP_RATIOS)
        : undefined;
  const snapThresholdPx =
    typeof magneticSnap === "object"
      ? (magneticSnap.thresholdPx ?? DEFAULT_MAGNETIC_SNAP_THRESHOLD_PX)
      : DEFAULT_MAGNETIC_SNAP_THRESHOLD_PX;

  const clamp = (value: number): number => {
    if (!Number.isFinite(value)) return defaultWidth;
    return Math.max(minWidth, Math.min(maxWidth, value));
  };

  const readWidth = (): number | null => {
    if (typeof window === "undefined") return null;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return stored === null ? null : clamp(stored);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return null;
    }
  };
  const [widthState, setWidthState] = useState(() => ({ storageKey, width: readWidth() }));
  const [resetVersion, setResetVersion] = useState(0);
  const resetCleanupRef = useRef<(() => void) | null>(null);
  const handleNodeRef = useRef<HTMLElement | null>(null);

  if (widthState.storageKey !== storageKey) {
    setWidthState({ storageKey, width: readWidth() });
  }

  const clampedWidth = clamp(widthState.width ?? defaultWidth);
  const restoreWidth = useStableCallback((host: HTMLElement | null) => {
    host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${clampedWidth}px`);
  });

  const commitWidth = (nextStorageKey: string, nextWidth: number) => {
    // Resizing remains usable for this session when browser storage is unavailable.
    setWidthState({ storageKey: nextStorageKey, width: nextWidth });
    try {
      setLocalStorageItem(nextStorageKey, nextWidth, WidthSchema);
    } catch (error) {
      console.error("Could not persist panel width.", error);
    }
  };

  const notifySnap = useStableCallback((match: MagneticSnapMatch) => {
    onMagneticSnap?.(match);
  });

  const resetToDefaultWithHost = useStableCallback((explicitHost?: HTMLElement | null) => {
    const targetWidth = clamp(defaultWidth);
    const host = explicitHost ?? handleNodeRef.current?.parentElement ?? null;
    resetCleanupRef.current?.();
    resetCleanupRef.current = null;

    if (host && Math.abs(targetWidth - clampedWidth) >= 1 && !prefersReducedMotion()) {
      const hadInlineTransition = host.style.transition;
      host.style.transition = "width 260ms var(--spring-gentle)";
      host.dataset.resizeResetting = "true";
      pulseBrowserSurfaceGeometrySync(290);

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        host.removeEventListener("transitionend", onDone);
        host.removeEventListener("transitioncancel", onDone);
        window.clearTimeout(fallbackTimer);
        if (hadInlineTransition) {
          host.style.transition = hadInlineTransition;
        } else {
          host.style.removeProperty("transition");
        }
        delete host.dataset.resizeResetting;
      };
      const onDone = (event: TransitionEvent) => {
        if (event.target !== host || event.propertyName !== "width") return;
        cleanup();
      };
      host.addEventListener("transitionend", onDone);
      host.addEventListener("transitioncancel", onDone);
      const fallbackTimer = window.setTimeout(cleanup, 320);
      resetCleanupRef.current = cleanup;
    }

    setResetVersion((version) => version + 1);
    commitWidth(storageKey, targetWidth);
  });

  const drag = useResizeDrag<HTMLElement>((event) => {
    const handle = event.currentTarget;
    const host = handle.parentElement;
    const row = host?.parentElement ?? null;
    resetCleanupRef.current?.();
    resetCleanupRef.current = null;
    // Disable drag transitions through transition-property; the host renders transition-duration.
    host?.style.setProperty("transition-property", "none");
    // The drag commits to the key and width it started from, even if the panel
    // switches keys before the pointer is released.
    const startStorageKey = storageKey;
    const startWidth = clampedWidth;
    const startSnapRatios = snapRatios;
    const startSnapThresholdPx = snapThresholdPx;

    return {
      width: startWidth,
      edge,
      bounds: { min: minWidth, max: maxWidth },
      resize(nextWidth, _rawWidth, meta) {
        const containerWidth = row?.clientWidth ?? 0;
        const match = resolveMagneticSnapWidth({
          rawWidth: nextWidth,
          containerWidth,
          minWidth,
          maxWidth,
          snapRatios: startSnapRatios,
          thresholdPx: startSnapThresholdPx,
          bypassSnap: meta.altKey,
        });
        host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${match.width}px`);
        updateDividerHud(handle, match, containerWidth, meta.clientY);
        notifySnap(match);
        return match.width;
      },
      finish(finalWidth, moved) {
        if (moved) commitWidth(startStorageKey, finalWidth);
        else restoreWidth(host);
      },
      cleanup(committed) {
        clearDividerHud(handle);
        host?.style.removeProperty("transition-property");
        if (!committed) host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${startWidth}px`);
        pulseBrowserSurfaceGeometrySync(64);
      },
    };
  });

  // Bounds can change mid-drag (sidebar opens, window narrows), and the render
  // that carries them rewrites the committed width, so re-apply the live pointer position.
  const { refresh } = drag;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reapplies the live drag pointer position to the DOM before paint when the bounds change
  useLayoutEffect(() => refresh({ min: minWidth, max: maxWidth }), [refresh, minWidth, maxWidth]);

  const attachHandle = useStableCallback((node: HTMLElement | null) => {
    handleNodeRef.current = node;
    const detachDrag = drag.ref(node);
    if (!node && !detachDrag) return undefined;
    return () => {
      if (handleNodeRef.current === node) handleNodeRef.current = null;
      resetCleanupRef.current?.();
      resetCleanupRef.current = null;
      detachDrag?.();
    };
  });

  return {
    width: clampedWidth,
    setWidth: (value) => commitWidth(storageKey, clamp(value)),
    resetToDefault: () => resetToDefaultWithHost(),
    resetVersion,
    handlers: {
      ref: attachHandle,
      onPointerDown: drag.onPointerDown,
      onPointerMove: drag.onPointerMove,
      onPointerUp: drag.onPointerUp,
      onPointerCancel: drag.onPointerCancel,
      onLostPointerCapture: drag.onLostPointerCapture,
      onDoubleClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetToDefaultWithHost(event.currentTarget.parentElement);
      },
    },
  };
}

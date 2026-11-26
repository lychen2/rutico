/**
 * Interruptible WAAPI FLIP coordinator with velocity inheritance, batched read/write
 * phases (zero forced reflow storms), and optional `1/scale` inverse child correction.
 */

import {
  createSpringKeyframes,
  evaluateSpringAt,
  prefersReducedMotion,
  resolveSpringPreset,
  type SpringConfig,
  type SpringParameters,
  type SpringPresetName,
} from "./springs";

export interface FlipRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FlipAnimationOptions {
  readonly preset?: SpringPresetName | SpringConfig;
  readonly scale?: boolean;
  /** Child elements to counter-scale by `(1/sx, 1/sy)` so typography never stretches. */
  readonly inverseScaleChildren?: readonly HTMLElement[];
  readonly samples?: number;
  readonly onFinish?: () => void;
}

interface ActiveFlipState {
  readonly animation: Animation;
  readonly childAnimations: Animation[];
  readonly params: SpringParameters;
  readonly durationMs: number;
  readonly startX: number;
  readonly startY: number;
  readonly initialVx: number;
  readonly initialVy: number;
}

const activeFlips = new WeakMap<HTMLElement, ActiveFlipState>();

function toFlipRect(rect: DOMRectReadOnly): FlipRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function readCurrentTransformVelocity(element: HTMLElement): {
  readonly vx: number;
  readonly vy: number;
} {
  const active = activeFlips.get(element);
  if (!active || active.animation.playState === "finished" || active.durationMs <= 0) {
    return { vx: 0, vy: 0 };
  }
  const currentTime = active.animation.currentTime;
  const elapsedMs = typeof currentTime === "number" ? currentTime : 0;
  if (elapsedMs <= 0 || elapsedMs >= active.durationMs) {
    return { vx: 0, vy: 0 };
  }
  const tSec = elapsedMs / 1000;
  const normVx = Math.abs(active.startX) > 1e-4 ? active.initialVx / -active.startX : 0;
  const normVy = Math.abs(active.startY) > 1e-4 ? active.initialVy / -active.startY : 0;
  const vx =
    Math.abs(active.startX) > 1e-4
      ? -active.startX * evaluateSpringAt(tSec, active.params, normVx).velocity
      : 0;
  const vy =
    Math.abs(active.startY) > 1e-4
      ? -active.startY * evaluateSpringAt(tSec, active.params, normVy).velocity
      : 0;
  return { vx, vy };
}

function readComputedTranslation(element: HTMLElement): {
  readonly tx: number;
  readonly ty: number;
} {
  const win = element.ownerDocument.defaultView;
  if (!win || typeof win.DOMMatrixReadOnly === "undefined") {
    return { tx: 0, ty: 0 };
  }
  const transform = win.getComputedStyle(element).transform;
  if (!transform || transform === "none") return { tx: 0, ty: 0 };
  const matrix = new win.DOMMatrixReadOnly(transform);
  return { tx: matrix.m41, ty: matrix.m42 };
}

export function cancelFlip(element: HTMLElement): void {
  const active = activeFlips.get(element);
  if (!active) return;
  active.animation.cancel();
  for (const childAnim of active.childAnimations) {
    childAnim.cancel();
  }
  activeFlips.delete(element);
}

/**
 * Batch-read initial rectangles for a group of elements BEFORE mutating layout.
 * Avoids interleaved read/write forced reflow storms.
 */
export function captureFlipSnapshots(elements: Iterable<HTMLElement>): Map<HTMLElement, FlipRect> {
  const snapshots = new Map<HTMLElement, FlipRect>();
  for (const element of elements) {
    snapshots.set(element, toFlipRect(element.getBoundingClientRect()));
  }
  return snapshots;
}

export function captureFlipSnapshot(element: HTMLElement): FlipRect {
  return toFlipRect(element.getBoundingClientRect());
}

/**
 * Animate one element from a previously captured `first` rect to its current layout position.
 * Inherits instantaneous velocity when interrupting an in-flight FLIP animation.
 */
export function playFlip(
  element: HTMLElement,
  first: FlipRect,
  options?: FlipAnimationOptions,
): Animation | null {
  const results = playFlipBatch([{ element, first, ...(options ? { options } : {}) }]);
  return results.get(element) ?? null;
}

/**
 * Batch-execute FLIP animations for multiple elements:
 * 1. Read phase: read velocity + final layout rect for EVERY element before writing anything.
 * 2. Write phase: cancel prior animations and launch pre-sampled WAAPI spring keyframes.
 */
export function playFlipBatch(
  entries: ReadonlyArray<{
    readonly element: HTMLElement;
    readonly first: FlipRect;
    readonly options?: FlipAnimationOptions;
  }>,
): Map<HTMLElement, Animation> {
  const started = new Map<HTMLElement, Animation>();
  if (entries.length === 0) return started;

  const firstEl = entries[0]?.element;
  const win = firstEl?.ownerDocument.defaultView ?? globalThis.window;
  if (prefersReducedMotion(win)) {
    for (const entry of entries) {
      cancelFlip(entry.element);
      entry.options?.onFinish?.();
    }
    return started;
  }

  // Phase 1: Pure read pass — collect velocities and final rects before any writes.
  const plans: Array<{
    readonly element: HTMLElement;
    readonly dx: number;
    readonly dy: number;
    readonly sx: number;
    readonly sy: number;
    readonly vx: number;
    readonly vy: number;
    readonly options?: FlipAnimationOptions;
  }> = [];

  for (const entry of entries) {
    const { element, first, options } = entry;
    const { vx, vy } = readCurrentTransformVelocity(element);
    const currentOffset = readComputedTranslation(element);
    const lastRect = element.getBoundingClientRect();
    // Subtract any currently active visual transform from lastRect to recover the true layout destination.
    const layoutLeft = lastRect.left - currentOffset.tx;
    const layoutTop = lastRect.top - currentOffset.ty;
    const dx = first.left - layoutLeft;
    const dy = first.top - layoutTop;
    const useScale = options?.scale ?? false;
    const sx =
      useScale && lastRect.width > 0.5 && first.width > 0.5 ? first.width / lastRect.width : 1;
    const sy =
      useScale && lastRect.height > 0.5 && first.height > 0.5 ? first.height / lastRect.height : 1;

    plans.push({ element, dx, dy, sx, sy, vx, vy, ...(options ? { options } : {}) });
  }

  // Phase 2: Pure write pass — cancel prior animations and start pre-sampled WAAPI animations.
  for (const plan of plans) {
    const { element, dx, dy, sx, sy, vx, vy, options } = plan;
    cancelFlip(element);

    const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    const scaled = Math.abs(sx - 1) > 0.005 || Math.abs(sy - 1) > 0.005;
    if (!moved && !scaled) {
      options?.onFinish?.();
      continue;
    }

    if (typeof element.animate !== "function") {
      options?.onFinish?.();
      continue;
    }

    const preset = options?.preset ?? "spatial";
    const params = resolveSpringPreset(preset);
    const samples = options?.samples ?? 32;

    const xTrack = createSpringKeyframes(dx, 0, preset, {
      initialVelocity: vx,
      samples,
      format: (v) => ({ x: v }) as unknown as Keyframe,
    });
    const yTrack = createSpringKeyframes(dy, 0, preset, {
      initialVelocity: vy,
      samples,
      format: (v) => ({ y: v }) as unknown as Keyframe,
    });
    const durationMs = Math.max(xTrack.durationMs, yTrack.durationMs, params.settlingMs);
    const sxTrack = scaled
      ? createSpringKeyframes(sx, 1, preset, {
          samples,
          format: (v) => ({ s: v }) as unknown as Keyframe,
        })
      : null;
    const syTrack = scaled
      ? createSpringKeyframes(sy, 1, preset, {
          samples,
          format: (v) => ({ s: v }) as unknown as Keyframe,
        })
      : null;

    const keyframes: Keyframe[] = [];
    const childKeyframes: Keyframe[] = [];
    const needsInverseChildren =
      scaled && options?.inverseScaleChildren && options.inverseScaleChildren.length > 0;

    for (let i = 0; i < samples; i += 1) {
      const tx = Number((xTrack.keyframes[i] as unknown as { x: number })?.x ?? 0);
      const ty = Number((yTrack.keyframes[i] as unknown as { y: number })?.y ?? 0);
      const curSx = sxTrack
        ? Number((sxTrack.keyframes[i] as unknown as { s: number })?.s ?? 1)
        : 1;
      const curSy = syTrack
        ? Number((syTrack.keyframes[i] as unknown as { s: number })?.s ?? 1)
        : 1;

      keyframes.push({
        transform: scaled
          ? `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${curSx.toFixed(4)}, ${curSy.toFixed(4)})`
          : `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`,
      });

      if (needsInverseChildren) {
        const invX = Math.abs(curSx) > 0.05 ? 1 / curSx : 1;
        const invY = Math.abs(curSy) > 0.05 ? 1 / curSy : 1;
        childKeyframes.push({
          transform: `scale(${invX.toFixed(4)}, ${invY.toFixed(4)})`,
        });
      }
    }

    const animation = element.animate(keyframes, {
      duration: durationMs,
      easing: "linear",
    });

    const childAnimations: Animation[] = [];
    if (needsInverseChildren && options?.inverseScaleChildren) {
      for (const child of options.inverseScaleChildren) {
        if (typeof child.animate === "function") {
          childAnimations.push(
            child.animate(childKeyframes, {
              duration: durationMs,
              easing: "linear",
            }),
          );
        }
      }
    }

    const state: ActiveFlipState = {
      animation,
      childAnimations,
      params,
      durationMs,
      startX: dx,
      startY: dy,
      initialVx: vx,
      initialVy: vy,
    };
    activeFlips.set(element, state);
    started.set(element, animation);

    animation.addEventListener(
      "finish",
      () => {
        if (activeFlips.get(element)?.animation === animation) {
          activeFlips.delete(element);
        }
        options?.onFinish?.();
      },
      { once: true },
    );
  }

  return started;
}

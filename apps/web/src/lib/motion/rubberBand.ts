/**
 * Logarithmic rubber-band overscroll & gesture momentum projection math
 * (WWDC 2018 *Designing Fluid Interfaces* + Vaul / Sonner gesture physics).
 */

export const RUBBER_BAND_COEFFICIENT = 0.55;
export const DECELERATION_RATE_NORMAL = 0.998;
export const DECELERATION_RATE_FAST = 0.99;

export interface VelocitySample {
  readonly x: number;
  readonly y: number;
  readonly timestampMs: number;
}

export interface VelocityVector {
  /** Horizontal velocity in pixels per second. */
  readonly vx: number;
  /** Vertical velocity in pixels per second. */
  readonly vy: number;
  /** Horizontal velocity in pixels per millisecond. */
  readonly vxPerMs: number;
  /** Vertical velocity in pixels per millisecond. */
  readonly vyPerMs: number;
  /** Scalar speed in pixels per millisecond. */
  readonly speedPerMs: number;
}

/**
 * Logarithmic rubber-band resistance: approaches `dimension` asymptotically as `offset` grows,
 * preserving the sign of `offset`.
 */
export function rubberband(
  offset: number,
  dimension: number,
  coefficient = RUBBER_BAND_COEFFICIENT,
): number {
  if (!Number.isFinite(offset) || !Number.isFinite(dimension) || dimension <= 0 || offset === 0) {
    return 0;
  }
  const c = Math.max(0.01, coefficient);
  const absOffset = Math.abs(offset);
  const resisted = (1 - 1 / ((absOffset * c) / dimension + 1)) * dimension;
  return offset < 0 ? -resisted : resisted;
}

/**
 * Clamp `value` within `[min, max]`, applying smooth rubber-band resistance past either bound.
 */
export function rubberbandClamp(
  value: number,
  min: number,
  max: number,
  dimension: number,
  coefficient = RUBBER_BAND_COEFFICIENT,
): number {
  if (value < min) {
    return min - rubberband(min - value, dimension, coefficient);
  }
  if (value > max) {
    return max + rubberband(value - max, dimension, coefficient);
  }
  return value;
}

/**
 * Project inertial travel distance (in px) from initial velocity `velocityPxPerSec`
 * using exponential deceleration (`0.998` standard scroll, `0.99` quick flick).
 */
export function projectVelocity(
  velocityPxPerSec: number,
  decelerationRate = DECELERATION_RATE_NORMAL,
): number {
  if (!Number.isFinite(velocityPxPerSec) || velocityPxPerSec === 0) return 0;
  const clampedRate = Math.max(0.01, Math.min(0.9999, decelerationRate));
  return ((velocityPxPerSec / 1000) * clampedRate) / (1 - clampedRate);
}

/**
 * Compute velocity from two independent timestamped samples (never a single transform read).
 */
export function computeVelocityBetweenSamples(
  first: VelocitySample,
  second: VelocitySample,
): VelocityVector {
  const dtMs = second.timestampMs - first.timestampMs;
  if (!Number.isFinite(dtMs) || dtMs <= 0.5) {
    return { vx: 0, vy: 0, vxPerMs: 0, vyPerMs: 0, speedPerMs: 0 };
  }
  const vxPerMs = (second.x - first.x) / dtMs;
  const vyPerMs = (second.y - first.y) / dtMs;
  const speedPerMs = Math.hypot(vxPerMs, vyPerMs);
  return {
    vx: vxPerMs * 1000,
    vy: vyPerMs * 1000,
    vxPerMs,
    vyPerMs,
    speedPerMs,
  };
}

export interface VelocityTracker {
  push: (x: number, y: number, timestampMs: number) => void;
  getVelocity: (nowMs?: number) => VelocityVector;
  reset: () => void;
}

/**
 * Rolling time-window pointer velocity tracker (default 90ms window).
 * Uses at least two independent timestamped samples to compute smooth release velocity.
 */
export function createVelocityTracker(windowMs = 90): VelocityTracker {
  const samples: VelocitySample[] = [];
  const safeWindow = Math.max(16, windowMs);

  const prune = (referenceMs: number) => {
    while (samples.length > 2 && referenceMs - samples[0]!.timestampMs > safeWindow) {
      samples.shift();
    }
  };

  return {
    push(x, y, timestampMs) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(timestampMs)) return;
      const last = samples.at(-1);
      if (last && timestampMs <= last.timestampMs) {
        samples[samples.length - 1] = { x, y, timestampMs };
      } else {
        samples.push({ x, y, timestampMs });
      }
      prune(timestampMs);
      if (samples.length > 16) {
        samples.splice(0, samples.length - 16);
      }
    },
    getVelocity(nowMs) {
      if (samples.length < 2) {
        return { vx: 0, vy: 0, vxPerMs: 0, vyPerMs: 0, speedPerMs: 0 };
      }
      const last = samples.at(-1)!;
      if (nowMs !== undefined && nowMs - last.timestampMs > safeWindow * 1.5) {
        return { vx: 0, vy: 0, vxPerMs: 0, vyPerMs: 0, speedPerMs: 0 };
      }
      const first = samples[0]!;
      return computeVelocityBetweenSamples(first, last);
    },
    reset() {
      samples.length = 0;
    },
  };
}

/**
 * Evaluate whether a sheet/drawer drag should dismiss or snap back, combining
 * distance ratio (> 35%), release velocity (> 0.5 px/ms), and inertial projection.
 */
export function shouldDismissByDrag(
  distancePx: number,
  dimensionPx: number,
  velocityPxPerMs: number,
  options?: {
    readonly distanceRatioThreshold?: number;
    readonly velocityThresholdPxPerMs?: number;
    readonly decelerationRate?: number;
  },
): boolean {
  if (distancePx <= 0 || dimensionPx <= 0) return false;
  const ratioThreshold = options?.distanceRatioThreshold ?? 0.35;
  const velocityThreshold = options?.velocityThresholdPxPerMs ?? 0.5;
  const decelerationRate = options?.decelerationRate ?? DECELERATION_RATE_FAST;

  if (velocityPxPerMs >= velocityThreshold) return true;
  if (distancePx / dimensionPx >= ratioThreshold && velocityPxPerMs >= -0.15) return true;

  if (velocityPxPerMs > 0.12) {
    const projected = distancePx + projectVelocity(velocityPxPerMs * 1000, decelerationRate);
    if (projected >= dimensionPx * 0.5) return true;
  }

  return false;
}

/**
 * Analytical second-order damped spring physics engine (WWDC 2023 parameterization).
 *
 * Converts perceptual `(duration, bounce)` into physical `(stiffness, damping)` for unit mass,
 * evaluates closed-form displacement & velocity with initial-velocity inheritance, and generates
 * expanded CSS `linear(...)` timing strings for both CSS tokens and JS WAAPI consumers.
 */

export interface SpringConfig {
  /** Perceptual duration in seconds (> 0). */
  readonly duration: number;
  /**
   * Bounce factor in `(-1, 1)`.
   * - `0`: critically damped (zero overshoot — default for click/tap surfaces)
   * - `> 0`: underdamped spring overshoot (gesture momentum & small <=64px confirmations)
   * - `< 0`: overdamped smooth deceleration
   */
  readonly bounce: number;
}

export interface SpringParameters extends SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  /** Undamped natural angular frequency (rad/s). */
  readonly omega0: number;
  /** Damping ratio (zeta < 1 underdamped, = 1 critical, > 1 overdamped). */
  readonly zeta: number;
  /** Analytical settling duration in milliseconds. */
  readonly settlingMs: number;
}

export interface SpringPreset extends SpringParameters {
  readonly name: SpringPresetName;
  /** Expanded 36-point CSS `linear(...)` easing string safe for WAAPI `easing`. */
  readonly linearEasing: string;
}

export type SpringPresetName = "micro" | "snappy" | "fluid" | "spatial" | "bouncy" | "gentle";

export interface SpringSample {
  readonly value: number;
  readonly velocity: number;
}

export interface SpringKeyframesResult<TKeyframe extends Keyframe = Keyframe> {
  readonly keyframes: TKeyframe[];
  readonly durationMs: number;
  /** Always `"linear"` because spring curvature is baked into pre-sampled keyframes. */
  readonly easing: "linear";
}

const DEFAULT_LINEAR_SAMPLES = 36;
const SETTLE_VALUE_EPSILON = 0.001;
const SETTLE_VELOCITY_EPSILON = 0.005;
const MAX_SETTLE_SECONDS = 2.4;

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(win: Window | undefined = globalThis.window): boolean {
  if (!win || typeof win.matchMedia !== "function") return false;
  return win.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function clampBounce(bounce: number): number {
  if (!Number.isFinite(bounce)) return 0;
  return Math.max(-0.95, Math.min(0.95, bounce));
}

function clampDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0.01) return 0.01;
  return duration;
}

/**
 * Convert perceptual `(duration, bounce)` into unit-mass spring parameters
 * `(stiffness, damping, omega0, zeta)` and analytical settling time.
 */
export function resolveSpringParameters(config: SpringConfig): SpringParameters {
  const duration = clampDuration(config.duration);
  const bounce = clampBounce(config.bounce);

  const omega0 = (2 * Math.PI) / duration;
  const stiffness = omega0 * omega0;
  const zeta = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  const damping = 2 * zeta * omega0;

  const base: Omit<SpringParameters, "settlingMs"> = {
    duration,
    bounce,
    stiffness,
    damping,
    omega0,
    zeta,
  };
  const settlingMs = computeSettlingMs(base, 0);

  return { ...base, settlingMs };
}

/**
 * Evaluate analytical unit-step spring response from `x(0) = 0` to `target = 1`
 * at elapsed time `tSec >= 0` with normalized initial velocity `initialVelocity` (units/s).
 */
export function evaluateSpringAt(
  tSec: number,
  params: Pick<SpringParameters, "omega0" | "zeta">,
  initialVelocity = 0,
): SpringSample {
  if (tSec <= 0) {
    return { value: 0, velocity: initialVelocity };
  }

  const { omega0, zeta } = params;
  const y0 = -1; // error y(t) = x(t) - 1

  if (Math.abs(zeta - 1) < 1e-6) {
    // Critically damped: y(t) = e^(-w0*t) * (A + B*t)
    const exp = Math.exp(-omega0 * tSec);
    const a = y0;
    const b = initialVelocity + omega0 * a;
    const y = exp * (a + b * tSec);
    const dy = exp * (b - omega0 * (a + b * tSec));
    return { value: 1 + y, velocity: dy };
  }

  if (zeta < 1) {
    // Underdamped: y(t) = e^(-zeta*w0*t) * (A*cos(wd*t) + B*sin(wd*t))
    const decay = zeta * omega0;
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const exp = Math.exp(-decay * tSec);
    const a = y0;
    const b = (initialVelocity + decay * a) / omegaD;
    const cos = Math.cos(omegaD * tSec);
    const sin = Math.sin(omegaD * tSec);
    const y = exp * (a * cos + b * sin);
    const dy = exp * ((b * omegaD - a * decay) * cos - (a * omegaD + b * decay) * sin);
    return { value: 1 + y, velocity: dy };
  }

  // Overdamped: y(t) = A*e^(r1*t) + B*e^(r2*t)
  const gamma = omega0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega0 + gamma;
  const r2 = -zeta * omega0 - gamma;
  const a = (initialVelocity - r2 * y0) / (r1 - r2);
  const b = y0 - a;
  const e1 = Math.exp(r1 * tSec);
  const e2 = Math.exp(r2 * tSec);
  const y = a * e1 + b * e2;
  const dy = a * r1 * e1 + b * r2 * e2;
  return { value: 1 + y, velocity: dy };
}

function computeSettlingMs(
  params: Pick<SpringParameters, "duration" | "omega0" | "zeta">,
  initialVelocity: number,
): number {
  const stepSec = 0.004;
  const minTimeSec = Math.max(0.06, params.duration * 0.5);
  const maxTimeSec = Math.min(MAX_SETTLE_SECONDS, Math.max(params.duration * 5, 0.8));
  let settledFor = 0;
  let lastActiveSec = minTimeSec;

  for (let t = stepSec; t <= maxTimeSec; t += stepSec) {
    const sample = evaluateSpringAt(t, params, initialVelocity);
    const withinValue = Math.abs(sample.value - 1) <= SETTLE_VALUE_EPSILON;
    const withinVel = Math.abs(sample.velocity) <= SETTLE_VELOCITY_EPSILON;
    if (withinValue && withinVel) {
      settledFor += stepSec;
      if (t >= minTimeSec && settledFor >= 0.024) {
        return Math.round((t - settledFor + stepSec) * 1000);
      }
    } else {
      settledFor = 0;
      lastActiveSec = t;
    }
  }

  return Math.round(Math.max(minTimeSec, lastActiveSec) * 1000);
}

function formatLinearPoint(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Sample an analytical spring into a CSS `linear(...)` easing function string.
 * Always returns the expanded `linear(...)` value (never a CSS custom property reference),
 * making it directly valid for WAAPI `element.animate(keyframes, { duration, easing })`.
 */
export function buildLinearSpringEasing(
  config: SpringConfig,
  samples = DEFAULT_LINEAR_SAMPLES,
): { readonly easing: string; readonly durationMs: number; readonly params: SpringParameters } {
  const params = resolveSpringParameters(config);
  const count = Math.max(4, Math.floor(samples));
  const durationSec = params.settlingMs / 1000;
  const points: string[] = [];

  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      points.push("0");
      continue;
    }
    if (index === count - 1) {
      points.push("1");
      continue;
    }
    const progress = index / (count - 1);
    const { value } = evaluateSpringAt(progress * durationSec, params, 0);
    points.push(formatLinearPoint(value));
  }

  return {
    easing: `linear(${points.join(", ")})`,
    durationMs: params.settlingMs,
    params,
  };
}

function definePreset(name: SpringPresetName, config: SpringConfig): SpringPreset {
  const built = buildLinearSpringEasing(config, DEFAULT_LINEAR_SAMPLES);
  return {
    name,
    ...built.params,
    linearEasing: built.easing,
  };
}

/**
 * Six-tier physical spring ladder aligned with Kubai087 Tip 011 & WWDC 2023:
 * - `micro` / `snappy` / `gentle`: critically damped (`bounce: 0`) for click/tap surfaces
 * - `fluid` / `spatial`: subtle underdamped momentum for containers and shared indicators
 * - `bouncy`: gesture release & small (<= 64px) confirmations only
 */
export const SPRING_PRESETS: Record<SpringPresetName, SpringPreset> = {
  micro: definePreset("micro", { duration: 0.16, bounce: 0 }),
  snappy: definePreset("snappy", { duration: 0.22, bounce: 0 }),
  fluid: definePreset("fluid", { duration: 0.28, bounce: 0.12 }),
  spatial: definePreset("spatial", { duration: 0.34, bounce: 0.1 }),
  bouncy: definePreset("bouncy", { duration: 0.4, bounce: 0.28 }),
  gentle: definePreset("gentle", { duration: 0.42, bounce: 0 }),
};

export function resolveSpringPreset(
  presetOrConfig: SpringPresetName | SpringConfig,
): SpringParameters {
  if (typeof presetOrConfig === "string") {
    return SPRING_PRESETS[presetOrConfig];
  }
  return resolveSpringParameters(presetOrConfig);
}

/**
 * Return WAAPI `{ duration, easing }` using the expanded `linear(...)` string
 * (never `var(--spring-*)`) for 2-keyframe WAAPI transitions.
 */
export function getSpringWaapiTiming(preset: SpringPresetName): {
  readonly duration: number;
  readonly easing: string;
} {
  const resolved = SPRING_PRESETS[preset];
  return {
    duration: resolved.settlingMs,
    easing: resolved.linearEasing,
  };
}

/**
 * Pre-sample a physical spring trajectory from `from` to `to` with optional velocity inheritance
 * (`initialVelocity` in the same units per second as `from`/`to`).
 *
 * Returns `{ keyframes, durationMs, easing: "linear" }` so callers never double-apply a spring
 * easing curve on top of pre-sampled spring positions.
 */
export function createSpringKeyframes<TKeyframe extends Keyframe = Keyframe>(
  from: number,
  to: number,
  presetOrConfig: SpringPresetName | SpringConfig = "spatial",
  options?: {
    /** Initial velocity in value-units per second (e.g. px/s). */
    readonly initialVelocity?: number;
    readonly samples?: number;
    readonly format?: (value: number, progress: number) => TKeyframe;
  },
): SpringKeyframesResult<TKeyframe> {
  const params = resolveSpringPreset(presetOrConfig);
  const delta = to - from;
  const rawVelocity = options?.initialVelocity ?? 0;
  const normalizedVelocity =
    Math.abs(delta) > 1e-4 ? Math.max(-40, Math.min(40, rawVelocity / delta)) : 0;

  const durationMs =
    normalizedVelocity === 0 ? params.settlingMs : computeSettlingMs(params, normalizedVelocity);
  const durationSec = durationMs / 1000;
  const count = Math.max(8, Math.floor(options?.samples ?? DEFAULT_LINEAR_SAMPLES));
  const format =
    options?.format ??
    ((value: number) =>
      ({ transform: `translate3d(${value.toFixed(3)}px, 0, 0)` }) as unknown as TKeyframe);

  if (Math.abs(delta) <= 1e-4 && Math.abs(rawVelocity) <= 1e-4) {
    return {
      keyframes: [format(to, 0), format(to, 1)],
      durationMs: 0,
      easing: "linear",
    };
  }

  const keyframes: TKeyframe[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    let value: number;
    if (index === 0) {
      value = from;
    } else if (index === count - 1) {
      value = to;
    } else if (Math.abs(delta) <= 1e-4) {
      // Zero displacement with non-zero velocity impulse: damped oscillation around target.
      const t = progress * durationSec;
      const decay = Math.exp(-params.zeta * params.omega0 * t);
      const impulse =
        params.zeta < 1
          ? (rawVelocity / (params.omega0 * Math.sqrt(1 - params.zeta * params.zeta))) *
            Math.sin(params.omega0 * Math.sqrt(1 - params.zeta * params.zeta) * t)
          : rawVelocity * t;
      value = to + decay * impulse;
    } else {
      const sample = evaluateSpringAt(progress * durationSec, params, normalizedVelocity);
      value = from + delta * sample.value;
    }
    keyframes.push(format(value, progress));
  }

  return {
    keyframes,
    durationMs,
    easing: "linear",
  };
}

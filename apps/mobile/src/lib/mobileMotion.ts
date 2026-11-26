import { Animated as RNAnimated, Easing as RNEasing } from "react-native";
import {
  ReduceMotion,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";

/**
 * Material 3 Expressive 120Hz spring presets.
 * Every preset binds `reduceMotion: ReduceMotion.System` inside the config object.
 */
export const SPRING_SPATIAL_SNAPPY = {
  damping: 26,
  stiffness: 380,
  mass: 0.78,
  reduceMotion: ReduceMotion.System,
} as const satisfies WithSpringConfig;

export const SPRING_SPATIAL_GENTLE = {
  damping: 24,
  stiffness: 220,
  mass: 0.9,
  reduceMotion: ReduceMotion.System,
} as const satisfies WithSpringConfig;

export const SPRING_EFFECTS_FAST = {
  damping: 28,
  stiffness: 460,
  mass: 0.65,
  reduceMotion: ReduceMotion.System,
} as const satisfies WithSpringConfig;

export const SPRING_DETENT_SNAP = {
  damping: 22,
  stiffness: 320,
  mass: 0.75,
  reduceMotion: ReduceMotion.System,
} as const satisfies WithSpringConfig;

export const TIMING_QUICK_FADE = {
  duration: 140,
  reduceMotion: ReduceMotion.System,
} as const satisfies WithTimingConfig;

export const TIMING_STANDARD_ENTER = {
  duration: 200,
  reduceMotion: ReduceMotion.System,
} as const satisfies WithTimingConfig;

export const DEFAULT_DECELERATION_RATE = 0.998;
export const DEFAULT_RUBBER_BAND_COEFFICIENT = 0.22;

/**
 * Returns a copy of a spring preset with release velocity injected while preserving
 * `reduceMotion: ReduceMotion.System` inside the config object.
 */
export function withVelocitySpringConfig(
  preset: WithSpringConfig,
  velocity: number,
): WithSpringConfig {
  "worklet";
  return {
    ...preset,
    velocity,
    reduceMotion: preset.reduceMotion ?? ReduceMotion.System,
  };
}

/**
 * Asymptotic logarithmic rubber-band resistance beyond `[min, max]`.
 * Keeps exact 1:1 tracking inside bounds and applies smooth C1 damping outside.
 */
export function rubberBandClamp(
  offset: number,
  min: number,
  max: number,
  dimension = 320,
  coefficient = DEFAULT_RUBBER_BAND_COEFFICIENT,
): number {
  "worklet";
  if (min > max) {
    const mid = (min + max) * 0.5;
    return mid;
  }
  if (offset >= min && offset <= max) {
    return offset;
  }
  const safeDimension = Math.max(1, Math.abs(dimension));
  const safeCoeff = Math.max(0.01, Math.min(1, coefficient));
  if (offset < min) {
    const overscroll = min - offset;
    const damped =
      (overscroll * safeDimension * safeCoeff) / (safeDimension + safeCoeff * overscroll);
    return min - damped;
  }
  const overscroll = offset - max;
  const damped =
    (overscroll * safeDimension * safeCoeff) / (safeDimension + safeCoeff * overscroll);
  return max + damped;
}

/**
 * Projects an element's resting offset from its release position and velocity (dp/s)
 * using standard exponential scroll deceleration (`0.998` default).
 */
export function projectOffset(
  position: number,
  velocity: number,
  decelerationRate = DEFAULT_DECELERATION_RATE,
): number {
  "worklet";
  if (!Number.isFinite(position) || !Number.isFinite(velocity)) {
    return Number.isFinite(position) ? position : 0;
  }
  const clampedRate = Math.max(0.9, Math.min(0.9995, decelerationRate));
  return position + ((velocity / 1000) * clampedRate) / (1 - clampedRate);
}

/**
 * Picks the nearest detent value to a projected offset.
 */
export function snapToNearestDetent(projected: number, detents: ReadonlyArray<number>): number {
  "worklet";
  if (detents.length === 0) return projected;
  let best = detents[0]!;
  let bestDistance = Math.abs(projected - best);
  for (let i = 1; i < detents.length; i += 1) {
    const candidate = detents[i]!;
    const distance = Math.abs(projected - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Computes concentric inner corner radius from outer radius and padding inset.
 */
export function concentricRadius(outerRadius: number, inset: number, minRadius = 4): number {
  "worklet";
  return Math.max(minRadius, outerRadius - inset);
}

export interface NativePulseLoopOptions {
  readonly active: boolean;
  readonly duration?: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly mode?: "expand" | "breathe";
}

/**
 * Drives a continuous pulse via React Native's native `Animated` driver instead of
 * Reanimated `withRepeat`, obeying `DISABLE_COMMIT_PAUSING_MECHANISM: true`.
 * Callers MUST gate `active` on foreground app state, screen focus, and `!reducedMotion`.
 */
export function startNativePulseLoop(
  animatedValue: RNAnimated.Value,
  options: NativePulseLoopOptions,
): () => void {
  const minValue = options.minValue ?? 0;
  const maxValue = options.maxValue ?? 1;
  const duration = options.duration ?? 1600;
  animatedValue.setValue(minValue);
  if (!options.active) {
    return () => {
      animatedValue.setValue(minValue);
    };
  }
  const animation =
    options.mode === "breathe"
      ? RNAnimated.loop(
          RNAnimated.sequence([
            RNAnimated.timing(animatedValue, {
              toValue: maxValue,
              duration: Math.round(duration * 0.5),
              easing: RNEasing.inOut(RNEasing.sin),
              useNativeDriver: true,
            }),
            RNAnimated.timing(animatedValue, {
              toValue: minValue,
              duration: Math.round(duration * 0.5),
              easing: RNEasing.inOut(RNEasing.sin),
              useNativeDriver: true,
            }),
          ]),
        )
      : RNAnimated.loop(
          RNAnimated.timing(animatedValue, {
            toValue: maxValue,
            duration,
            easing: RNEasing.out(RNEasing.quad),
            useNativeDriver: true,
          }),
        );
  animation.start();
  return () => {
    animation.stop();
    animatedValue.setValue(minValue);
  };
}

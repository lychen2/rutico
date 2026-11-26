// @effect-diagnostics globalDate:off - Haptic scrub throttling uses monotonic wall-clock timestamps outside Effect runtime.
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type SemanticHapticIntent =
  | "confirm"
  | "reject"
  | "gestureStart"
  | "gestureEnd"
  | "segmentTick"
  | "segmentFrequentTick"
  | "clockTick"
  | "toggleOn"
  | "toggleOff"
  | "contextClick"
  | "dragStart"
  | "longPress";

/** Minimum interval (ms) between consecutive high-frequency scrub ticks on Android motors. */
export const MIN_SCRUB_HAPTIC_INTERVAL_MS = 28;

const ANDROID_HAPTIC_MAP: Readonly<Record<SemanticHapticIntent, Haptics.AndroidHaptics>> = {
  confirm: Haptics.AndroidHaptics.Confirm,
  reject: Haptics.AndroidHaptics.Reject,
  gestureStart: Haptics.AndroidHaptics.Gesture_Start,
  gestureEnd: Haptics.AndroidHaptics.Gesture_End,
  segmentTick: Haptics.AndroidHaptics.Segment_Tick,
  segmentFrequentTick: Haptics.AndroidHaptics.Segment_Frequent_Tick,
  clockTick: Haptics.AndroidHaptics.Clock_Tick,
  toggleOn: Haptics.AndroidHaptics.Toggle_On,
  toggleOff: Haptics.AndroidHaptics.Toggle_Off,
  contextClick: Haptics.AndroidHaptics.Context_Click,
  dragStart: Haptics.AndroidHaptics.Drag_Start,
  longPress: Haptics.AndroidHaptics.Long_Press,
};

const SCRUB_INTENTS: ReadonlySet<SemanticHapticIntent> = new Set([
  "segmentFrequentTick",
  "clockTick",
  "segmentTick",
]);

let lastScrubTimestampMs = 0;

export function resetHapticThrottleForTesting(): void {
  lastScrubTimestampMs = 0;
}

export function resolveAndroidHapticConstant(intent: SemanticHapticIntent): Haptics.AndroidHaptics {
  return ANDROID_HAPTIC_MAP[intent];
}

function triggerFallbackHaptic(intent: SemanticHapticIntent): void {
  try {
    switch (intent) {
      case "confirm":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        return;
      case "reject":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined,
        );
        return;
      case "dragStart":
      case "longPress":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        return;
      case "gestureStart":
      case "gestureEnd":
      case "toggleOn":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        return;
      case "toggleOff":
        void Haptics.impactAsync(
          Haptics.ImpactFeedbackStyle.Soft ?? Haptics.ImpactFeedbackStyle.Light,
        ).catch(() => undefined);
        return;
      case "segmentTick":
      case "segmentFrequentTick":
      case "clockTick":
      case "contextClick":
        void Haptics.selectionAsync().catch(() => undefined);
        return;
    }
  } catch {
    // Gracefully swallow haptic errors on unsupported hardware or mocked test harnesses.
  }
}

export interface TriggerHapticOptions {
  /** Override wall-clock timestamp for deterministic unit tests. */
  readonly now?: number;
  /** Apply >= 28ms scrub throttling even for non-scrub intents when true. */
  readonly throttle?: boolean;
  /** Minimum interval in ms (clamped to >= 28ms). */
  readonly minIntervalMs?: number;
}

/**
 * Triggers a semantic haptic effect mapped directly to `Haptics.performAndroidHapticsAsync`
 * on Android (`expo-haptics@58.0.7`) with silent device fallback and >=28ms scrub throttling.
 * Call from Reanimated worklets ONLY via `runOnJS(triggerSemanticHaptic)(intent)` at discrete
 * threshold crossings or gesture completion.
 */
export function triggerSemanticHaptic(
  intent: SemanticHapticIntent,
  options?: TriggerHapticOptions,
): boolean {
  const shouldThrottle = options?.throttle ?? SCRUB_INTENTS.has(intent);
  if (shouldThrottle) {
    const now = options?.now ?? Date.now();
    const minInterval = Math.max(
      MIN_SCRUB_HAPTIC_INTERVAL_MS,
      options?.minIntervalMs ?? MIN_SCRUB_HAPTIC_INTERVAL_MS,
    );
    if (now - lastScrubTimestampMs < minInterval) {
      return false;
    }
    lastScrubTimestampMs = now;
  }

  if (Platform.OS === "android") {
    const constant = ANDROID_HAPTIC_MAP[intent];
    const perform = (
      Haptics as {
        readonly performAndroidHapticsAsync?: (type: Haptics.AndroidHaptics) => Promise<void>;
      }
    ).performAndroidHapticsAsync;
    if (typeof perform === "function" && constant !== undefined) {
      try {
        void Promise.resolve(perform(constant)).catch(() => {
          triggerFallbackHaptic(intent);
        });
        return true;
      } catch {
        triggerFallbackHaptic(intent);
        return true;
      }
    }
  }

  triggerFallbackHaptic(intent);
  return true;
}

/**
 * Creates a stateful, per-control scrub haptic gate that guarantees at least 28ms between
 * consecutive ticks and deduplicates identical discrete step indices.
 */
export function createScrubHapticController(
  intent: SemanticHapticIntent = "segmentFrequentTick",
  minIntervalMs = MIN_SCRUB_HAPTIC_INTERVAL_MS,
) {
  let lastStep: number | string | null = null;
  let lastFiredAt = -Infinity;
  const interval = Math.max(MIN_SCRUB_HAPTIC_INTERVAL_MS, minIntervalMs);

  return {
    reset() {
      lastStep = null;
    },
    tick(step: number | string, now = Date.now()): boolean {
      if (step === lastStep) return false;
      lastStep = step;
      if (now - lastFiredAt < interval) return false;
      lastFiredAt = now;
      return triggerSemanticHaptic(intent, { now, throttle: false });
    },
  };
}

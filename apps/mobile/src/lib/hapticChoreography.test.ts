import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  os: "android" as "android" | "ios",
  performAndroidHapticsAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return harness.os;
    },
  },
}));

vi.mock("expo-haptics", () => ({
  AndroidHaptics: {
    Confirm: "confirm",
    Reject: "reject",
    Gesture_Start: "gesture-start",
    Gesture_End: "gesture-end",
    Segment_Tick: "segment-tick",
    Segment_Frequent_Tick: "segment-frequent-tick",
    Clock_Tick: "clock-tick",
    Toggle_On: "toggle-on",
    Toggle_Off: "toggle-off",
    Context_Click: "context-click",
    Drag_Start: "drag-start",
    Long_Press: "long-press",
  },
  ImpactFeedbackStyle: {
    Light: "light",
    Medium: "medium",
    Heavy: "heavy",
    Soft: "soft",
    Rigid: "rigid",
  },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
  performAndroidHapticsAsync: harness.performAndroidHapticsAsync,
  selectionAsync: harness.selectionAsync,
  impactAsync: harness.impactAsync,
  notificationAsync: harness.notificationAsync,
}));

import {
  MIN_SCRUB_HAPTIC_INTERVAL_MS,
  createScrubHapticController,
  resetHapticThrottleForTesting,
  resolveAndroidHapticConstant,
  triggerSemanticHaptic,
  type SemanticHapticIntent,
} from "./hapticChoreography";

describe("hapticChoreography", () => {
  beforeEach(() => {
    harness.os = "android";
    harness.performAndroidHapticsAsync.mockClear();
    harness.selectionAsync.mockClear();
    harness.impactAsync.mockClear();
    harness.notificationAsync.mockClear();
    resetHapticThrottleForTesting();
  });

  it("maps all 12 semantic intents to AndroidHaptics on Android", () => {
    const intents: ReadonlyArray<SemanticHapticIntent> = [
      "confirm",
      "reject",
      "gestureStart",
      "gestureEnd",
      "segmentTick",
      "segmentFrequentTick",
      "clockTick",
      "toggleOn",
      "toggleOff",
      "contextClick",
      "dragStart",
      "longPress",
    ];
    let now = 1_000;
    for (const intent of intents) {
      now += 50;
      const fired = triggerSemanticHaptic(intent, { now });
      expect(fired).toBe(true);
      expect(harness.performAndroidHapticsAsync).toHaveBeenLastCalledWith(
        resolveAndroidHapticConstant(intent),
      );
    }
    expect(harness.performAndroidHapticsAsync).toHaveBeenCalledTimes(12);
  });

  it("enforces >= 28ms throttle for high-frequency scrub ticks", () => {
    expect(triggerSemanticHaptic("segmentFrequentTick", { now: 1_000 })).toBe(true);
    expect(
      triggerSemanticHaptic("segmentFrequentTick", {
        now: 1_000 + MIN_SCRUB_HAPTIC_INTERVAL_MS - 1,
      }),
    ).toBe(false);
    expect(
      triggerSemanticHaptic("segmentFrequentTick", {
        now: 1_000 + MIN_SCRUB_HAPTIC_INTERVAL_MS,
      }),
    ).toBe(true);
    expect(harness.performAndroidHapticsAsync).toHaveBeenCalledTimes(2);
  });

  it("deduplicates identical steps in createScrubHapticController", () => {
    const scrub = createScrubHapticController("segmentFrequentTick");
    expect(scrub.tick(0, 1_000)).toBe(true);
    expect(scrub.tick(0, 1_050)).toBe(false);
    expect(scrub.tick(1, 1_060)).toBe(true);
    expect(scrub.tick(2, 1_070)).toBe(false);
    expect(scrub.tick(3, 1_100)).toBe(true);
    scrub.reset();
    expect(scrub.tick(3, 1_140)).toBe(true);
    expect(harness.performAndroidHapticsAsync).toHaveBeenCalledTimes(4);
  });

  it("falls back cleanly to standard expo-haptics on non-Android platforms", () => {
    harness.os = "ios";
    triggerSemanticHaptic("confirm");
    expect(harness.performAndroidHapticsAsync).not.toHaveBeenCalled();
    expect(harness.notificationAsync).toHaveBeenCalledWith("success");

    triggerSemanticHaptic("contextClick");
    expect(harness.selectionAsync).toHaveBeenCalledTimes(1);

    triggerSemanticHaptic("longPress");
    expect(harness.impactAsync).toHaveBeenCalledWith("medium");
  });

  it("falls back silently when performAndroidHapticsAsync rejects on older Android devices", async () => {
    harness.performAndroidHapticsAsync.mockRejectedValueOnce(new Error("unsupported"));
    expect(triggerSemanticHaptic("confirm")).toBe(true);
    await Promise.resolve();
    expect(harness.notificationAsync).toHaveBeenCalledWith("success");
  });
});

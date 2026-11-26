import { describe, expect, it, vi } from "vite-plus/test";

const rnAnimatedHarness = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setValue: vi.fn(),
}));

vi.mock("react-native", () => ({
  Animated: {
    Value: class MockValue {
      setValue = rnAnimatedHarness.setValue;
    },
    loop: () => ({ start: rnAnimatedHarness.start, stop: rnAnimatedHarness.stop }),
    sequence: (items: unknown[]) => items,
    timing: () => ({}),
  },
  Easing: {
    inOut: (fn: unknown) => fn,
    out: (fn: unknown) => fn,
    quad: (v: number) => v,
    sin: (v: number) => v,
  },
}));

vi.mock("react-native-reanimated", () => ({
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
}));

import { Animated as RNAnimated } from "react-native";
import { ReduceMotion } from "react-native-reanimated";
import {
  SPRING_DETENT_SNAP,
  SPRING_EFFECTS_FAST,
  SPRING_SPATIAL_GENTLE,
  SPRING_SPATIAL_SNAPPY,
  concentricRadius,
  projectOffset,
  rubberBandClamp,
  snapToNearestDetent,
  startNativePulseLoop,
  withVelocitySpringConfig,
} from "./mobileMotion";

describe("mobileMotion presets", () => {
  it("binds ReduceMotion.System inside every Material 3 spring preset", () => {
    for (const preset of [
      SPRING_SPATIAL_SNAPPY,
      SPRING_SPATIAL_GENTLE,
      SPRING_EFFECTS_FAST,
      SPRING_DETENT_SNAP,
    ]) {
      expect(preset.reduceMotion).toBe(ReduceMotion.System);
      expect(preset.damping).toBeGreaterThan(0);
      expect(preset.stiffness).toBeGreaterThan(0);
      expect(preset.mass).toBeGreaterThan(0);
    }
  });

  it("injects velocity while preserving ReduceMotion.System", () => {
    const config = withVelocitySpringConfig(SPRING_SPATIAL_SNAPPY, 1250);
    expect(config.velocity).toBe(1250);
    expect(config.reduceMotion).toBe(ReduceMotion.System);
    expect(config.stiffness).toBe(SPRING_SPATIAL_SNAPPY.stiffness);
  });
});

describe("rubberBandClamp", () => {
  it("returns exact identity values inside [min, max]", () => {
    expect(rubberBandClamp(0, -100, 100)).toBe(0);
    expect(rubberBandClamp(-100, -100, 100)).toBe(-100);
    expect(rubberBandClamp(100, -100, 100)).toBe(100);
    expect(rubberBandClamp(42.5, -100, 100)).toBe(42.5);
  });

  it("applies monotonic asymptotic damping beyond upper and lower bounds", () => {
    const overSmall = rubberBandClamp(120, 0, 100, 320, 0.22);
    const overLarge = rubberBandClamp(500, 0, 100, 320, 0.22);
    expect(overSmall).toBeGreaterThan(100);
    expect(overSmall).toBeLessThan(120);
    expect(overLarge).toBeGreaterThan(overSmall);
    expect(overLarge).toBeLessThan(100 + 320);

    const underSmall = rubberBandClamp(-20, 0, 100, 320, 0.22);
    const underLarge = rubberBandClamp(-400, 0, 100, 320, 0.22);
    expect(underSmall).toBeLessThan(0);
    expect(underSmall).toBeGreaterThan(-20);
    expect(underLarge).toBeLessThan(underSmall);
    expect(underLarge).toBeGreaterThan(-320);
  });
});

describe("projectOffset and detents", () => {
  it("projects resting offset using 0.998 exponential deceleration", () => {
    expect(projectOffset(100, 0)).toBe(100);
    // (1000 / 1000) * 0.998 / 0.002 = 499
    expect(projectOffset(100, 1000, 0.998)).toBeCloseTo(599, 2);
    expect(projectOffset(100, -1000, 0.998)).toBeCloseTo(-399, 2);
  });

  it("snaps projected offsets to the nearest detent", () => {
    expect(snapToNearestDetent(130, [0, 160, 320])).toBe(160);
    expect(snapToNearestDetent(45, [0, 160, 320])).toBe(0);
    expect(snapToNearestDetent(290, [0, 160, 320])).toBe(320);
  });

  it("computes concentric inner corner radius with a safe floor", () => {
    expect(concentricRadius(16, 6)).toBe(10);
    expect(concentricRadius(10, 12)).toBe(4);
  });
});

describe("startNativePulseLoop", () => {
  it("starts and stops RN Animated loop only when active", () => {
    rnAnimatedHarness.start.mockClear();
    rnAnimatedHarness.stop.mockClear();
    rnAnimatedHarness.setValue.mockClear();

    const value = new RNAnimated.Value(0);
    const stopInactive = startNativePulseLoop(value, { active: false });
    expect(rnAnimatedHarness.start).not.toHaveBeenCalled();
    stopInactive();

    const stopActive = startNativePulseLoop(value, { active: true, mode: "breathe" });
    expect(rnAnimatedHarness.start).toHaveBeenCalledTimes(1);
    stopActive();
    expect(rnAnimatedHarness.stop).toHaveBeenCalledTimes(1);
  });
});

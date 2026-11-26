import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  StyleSheet: {
    absoluteFill: {},
    create: <T extends Record<string, unknown>>(styles: T) => styles,
  },
  View: () => null,
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: () => null },
  ReduceMotion: { System: "system" },
  useAnimatedStyle: () => ({}),
  useSharedValue: (initial: number) => ({
    get: () => initial,
    set: () => {},
  }),
  withSpring: (value: number) => value,
}));
vi.mock("react-native-svg", () => ({
  default: () => null,
  Defs: () => null,
  Path: () => null,
  RadialGradient: () => null,
  Rect: () => null,
  Stop: () => null,
}));

import { computeReticleCornerTargets } from "./FrostedCutout.android";

describe("computeReticleCornerTargets", () => {
  const base = {
    containerWidth: 340,
    containerHeight: 250,
    cutoutTop: 36,
    cutoutWidth: 150,
    cutoutHeight: 150,
  };

  it("frames the centered cutout cleanly when unlocked", () => {
    const targets = computeReticleCornerTargets({
      ...base,
      locked: false,
      lockRect: null,
    });

    expect(targets.mode).toBe("resting");
    expect(targets.topLeft).toEqual({ x: 95, y: 36 });
    expect(targets.topRight).toEqual({ x: 95 + 150 - 24, y: 36 });
    expect(targets.bottomLeft).toEqual({ x: 95, y: 36 + 150 - 24 });
    expect(targets.bottomRight).toEqual({ x: 95 + 150 - 24, y: 36 + 150 - 24 });
  });

  it("spring-locks the 4 L-brackets onto BarcodeScanningResult.bounds when valid", () => {
    const targets = computeReticleCornerTargets({
      ...base,
      locked: true,
      lockRect: { x: 112, y: 54, width: 110, height: 108 },
    });

    expect(targets.mode).toBe("bounds-lock");
    expect(targets.topLeft).toEqual({ x: 112, y: 54 });
    expect(targets.topRight).toEqual({ x: 112 + 110 - 24, y: 54 });
    expect(targets.bottomLeft).toEqual({ x: 112, y: 54 + 108 - 24 });
    expect(targets.bottomRight).toEqual({ x: 112 + 110 - 24, y: 54 + 108 - 24 });
  });

  it("falls back to a centered squeeze contraction when Android returns empty bounds", () => {
    const resting = computeReticleCornerTargets({ ...base, locked: false, lockRect: null });
    const emptyBounds = computeReticleCornerTargets({
      ...base,
      locked: true,
      lockRect: { x: 0, y: 0, width: 0, height: 0 },
    });
    const nullBounds = computeReticleCornerTargets({
      ...base,
      locked: true,
      lockRect: null,
    });

    expect(emptyBounds.mode).toBe("centered-squeeze");
    expect(nullBounds).toEqual(emptyBounds);
    expect(emptyBounds.topLeft.x).toBeGreaterThan(resting.topLeft.x);
    expect(emptyBounds.topLeft.y).toBeGreaterThan(resting.topLeft.y);
    expect(emptyBounds.bottomRight.x).toBeLessThan(resting.bottomRight.x);
    expect(emptyBounds.bottomRight.y).toBeLessThan(resting.bottomRight.y);
  });
});

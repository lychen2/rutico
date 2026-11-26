import { describe, expect, it } from "vite-plus/test";

import {
  REDUCED_MOTION_QUERY,
  SPRING_PRESETS,
  buildLinearSpringEasing,
  createSpringKeyframes,
  evaluateSpringAt,
  getSpringWaapiTiming,
  resolveSpringParameters,
  resolveSpringPreset,
} from "./springs";

describe("analytical spring physics solver", () => {
  it("resolves critically damped, underdamped, and overdamped parameters", () => {
    const critical = resolveSpringParameters({ duration: 0.25, bounce: 0 });
    expect(critical.zeta).toBeCloseTo(1, 5);
    expect(critical.stiffness).toBeCloseTo((2 * Math.PI * 4) ** 2, 3);
    expect(critical.damping).toBeCloseTo(2 * critical.omega0, 5);

    const under = resolveSpringParameters({ duration: 0.35, bounce: 0.25 });
    expect(under.zeta).toBeCloseTo(0.75, 5);
    expect(under.settlingMs).toBeGreaterThan(200);

    const over = resolveSpringParameters({ duration: 0.35, bounce: -0.25 });
    expect(over.zeta).toBeCloseTo(1 / 0.75, 5);
    expect(resolveSpringPreset("snappy")).toBe(SPRING_PRESETS.snappy);
    expect(resolveSpringPreset({ duration: 0.25, bounce: 0 }).zeta).toBeCloseTo(1, 5);
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });

  it("keeps critically damped presets strictly zero-overshoot and bouncy presets visibly underdamped", () => {
    for (const name of ["micro", "snappy", "gentle"] as const) {
      const preset = SPRING_PRESETS[name];
      let max = 0;
      for (let i = 0; i <= 100; i += 1) {
        const t = (i / 100) * (preset.settlingMs / 1000);
        max = Math.max(max, evaluateSpringAt(t, preset).value);
      }
      expect(max).toBeLessThanOrEqual(1.0005);
    }

    const bouncy = SPRING_PRESETS.bouncy;
    let peak = 0;
    for (let i = 0; i <= 100; i += 1) {
      const t = (i / 100) * (bouncy.settlingMs / 1000);
      peak = Math.max(peak, evaluateSpringAt(t, bouncy).value);
    }
    expect(peak).toBeGreaterThan(1.02);
  });

  it("generates expanded 36-point CSS linear() strings safe for WAAPI", () => {
    const { easing, durationMs } = buildLinearSpringEasing({ duration: 0.3, bounce: 0.1 });
    expect(easing.startsWith("linear(0, ")).toBe(true);
    expect(easing.endsWith(", 1)")).toBe(true);
    expect(easing.includes("var(")).toBe(false);
    const pointCount = easing.slice("linear(".length, -1).split(",").length;
    expect(pointCount).toBe(36);
    expect(durationMs).toBeGreaterThan(150);

    for (const preset of Object.keys(SPRING_PRESETS) as Array<keyof typeof SPRING_PRESETS>) {
      const timing = getSpringWaapiTiming(preset);
      expect(timing.easing.startsWith("linear(0,")).toBe(true);
      expect(timing.easing.endsWith(", 1)")).toBe(true);
      expect(timing.duration).toBeGreaterThan(80);
    }
  });

  it("pre-samples keyframes with linear easing and honors initial velocity inheritance", () => {
    const still = createSpringKeyframes(0, 100, "snappy", {
      samples: 24,
      format: (value) => ({ opacity: value }),
    });
    const fast = createSpringKeyframes(0, 100, "snappy", {
      initialVelocity: 1800,
      samples: 24,
      format: (value) => ({ opacity: value }),
    });

    expect(still.easing).toBe("linear");
    expect(fast.easing).toBe("linear");
    expect(still.keyframes).toHaveLength(24);
    expect(still.keyframes[0]?.opacity).toBe(0);
    expect(still.keyframes.at(-1)?.opacity).toBe(100);
    // Positive initial velocity moves faster early on than starting from rest.
    expect(Number(fast.keyframes[3]?.opacity)).toBeGreaterThan(Number(still.keyframes[3]?.opacity));
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  DECELERATION_RATE_FAST,
  DECELERATION_RATE_NORMAL,
  RUBBER_BAND_COEFFICIENT,
  computeVelocityBetweenSamples,
  createVelocityTracker,
  projectVelocity,
  rubberband,
  rubberbandClamp,
  shouldDismissByDrag,
} from "./rubberBand";

describe("rubberBand & momentum projection math", () => {
  it("applies asymptotic logarithmic rubber-band resistance while preserving sign", () => {
    expect(RUBBER_BAND_COEFFICIENT).toBe(0.55);
    expect(rubberband(0, 400)).toBe(0);
    expect(rubberband(100, 0)).toBe(0);

    const small = rubberband(20, 400);
    const medium = rubberband(200, 400);
    const huge = rubberband(10_000, 400);

    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(20);
    expect(medium).toBeGreaterThan(small);
    expect(medium).toBeLessThan(200);
    expect(huge).toBeLessThan(400);
    expect(rubberband(-120, 400)).toBeCloseTo(-rubberband(120, 400), 6);
  });

  it("clamps smoothly inside bounds and resists past either boundary", () => {
    expect(rubberbandClamp(50, 0, 100, 300)).toBe(50);
    expect(rubberbandClamp(-60, 0, 100, 300)).toBeLessThan(0);
    expect(rubberbandClamp(-60, 0, 100, 300)).toBeGreaterThan(-60);
    expect(rubberbandClamp(180, 0, 100, 300)).toBeGreaterThan(100);
    expect(rubberbandClamp(180, 0, 100, 300)).toBeLessThan(180);
  });

  it("projects velocity using WWDC deceleration formula", () => {
    expect(projectVelocity(0)).toBe(0);
    // 1000 px/s at 0.998 -> 1 * 0.998 / 0.002 = 499 px
    expect(projectVelocity(1000, DECELERATION_RATE_NORMAL)).toBeCloseTo(499, 4);
    // 1000 px/s at 0.99 -> 1 * 0.99 / 0.01 = 99 px
    expect(projectVelocity(1000, DECELERATION_RATE_FAST)).toBeCloseTo(99, 4);
    expect(projectVelocity(-1000, DECELERATION_RATE_FAST)).toBeCloseTo(-99, 4);
  });

  it("computes velocity from two independent timestamped samples and prunes stale history", () => {
    const vector = computeVelocityBetweenSamples(
      { x: 10, y: 20, timestampMs: 100 },
      { x: 60, y: 45, timestampMs: 150 },
    );
    expect(vector.vxPerMs).toBeCloseTo(1, 5);
    expect(vector.vyPerMs).toBeCloseTo(0.5, 5);
    expect(vector.vx).toBeCloseTo(1000, 3);
    expect(vector.vy).toBeCloseTo(500, 3);

    const tracker = createVelocityTracker(80);
    tracker.push(0, 0, 0);
    tracker.push(10, 0, 50);
    tracker.push(70, 0, 110);
    // Window keeps [50ms..110ms]: dx=60 over dt=60ms -> 1 px/ms
    expect(tracker.getVelocity(120).vxPerMs).toBeCloseTo(1, 3);
    // Stale read well past window decays to 0
    expect(tracker.getVelocity(500).vxPerMs).toBe(0);
  });

  it("decides sheet drag dismiss by distance threshold, flick velocity, and projection", () => {
    expect(shouldDismissByDrag(150, 400, 0)).toBe(true); // 37.5% > 35%
    expect(shouldDismissByDrag(40, 400, 0.6)).toBe(true); // fast flick > 0.5 px/ms
    expect(shouldDismissByDrag(60, 400, 0.05)).toBe(false); // short & slow
    expect(shouldDismissByDrag(-20, 400, 0.9)).toBe(false); // dragged wrong direction
    expect(shouldDismissByDrag(160, 400, -0.4)).toBe(false); // pulled past threshold then flicked back
  });
});

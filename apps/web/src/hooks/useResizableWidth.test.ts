import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_MAGNETIC_SNAP_RATIOS,
  DEFAULT_MAGNETIC_SNAP_THRESHOLD_PX,
  resolveMagneticSnapWidth,
} from "./useResizableWidth";

describe("resolveMagneticSnapWidth", () => {
  it("snaps within ±10px to 33%, 50%, and 66% golden detents", () => {
    const containerWidth = 1200;

    // 33.33% => 400px
    const third = resolveMagneticSnapWidth({
      rawWidth: 408,
      containerWidth,
      minWidth: 200,
      maxWidth: 900,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
      thresholdPx: DEFAULT_MAGNETIC_SNAP_THRESHOLD_PX,
    });
    expect(third.width).toBe(400);
    expect(third.snappedRatio).toBeCloseTo(1 / 3, 5);

    // 50% => 600px
    const half = resolveMagneticSnapWidth({
      rawWidth: 591,
      containerWidth,
      minWidth: 200,
      maxWidth: 900,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
    });
    expect(half.width).toBe(600);
    expect(half.snappedRatio).toBe(0.5);

    // 66.67% => 800px
    const twoThirds = resolveMagneticSnapWidth({
      rawWidth: 810,
      containerWidth,
      minWidth: 200,
      maxWidth: 900,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
    });
    expect(twoThirds.width).toBe(800);
    expect(twoThirds.snappedRatio).toBeCloseTo(2 / 3, 5);
  });

  it("does not snap outside the ±10px window", () => {
    const result = resolveMagneticSnapWidth({
      rawWidth: 615,
      containerWidth: 1200,
      minWidth: 200,
      maxWidth: 900,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
    });
    expect(result.width).toBe(615);
    expect(result.snappedRatio).toBeNull();
    expect(result.ratio).toBeCloseTo(615 / 1200, 5);
  });

  it("bypasses magnetic detents when Alt key bypass is active", () => {
    const result = resolveMagneticSnapWidth({
      rawWidth: 602,
      containerWidth: 1200,
      minWidth: 200,
      maxWidth: 900,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
      bypassSnap: true,
    });
    expect(result.width).toBe(602);
    expect(result.snappedRatio).toBeNull();
  });

  it("clamps to [minWidth, maxWidth] and ignores out-of-bounds detents", () => {
    const result = resolveMagneticSnapWidth({
      rawWidth: 350,
      containerWidth: 1200,
      minWidth: 420,
      maxWidth: 700,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
    });
    // 400px (33%) is below minWidth=420, so clamp wins with no snap.
    expect(result.width).toBe(420);
    expect(result.snappedRatio).toBeNull();
  });

  it("handles zero or non-finite container widths gracefully", () => {
    const result = resolveMagneticSnapWidth({
      rawWidth: 480,
      containerWidth: 0,
      minWidth: 300,
      maxWidth: 800,
      snapRatios: DEFAULT_MAGNETIC_SNAP_RATIOS,
    });
    expect(result.width).toBe(480);
    expect(result.ratio).toBe(0);
    expect(result.snappedRatio).toBeNull();
  });
});

import { describe, expect, it } from "vite-plus/test";
import { computeViewedProgressRing } from "./reviewNavigatorHud";

describe("computeViewedProgressRing", () => {
  it("computes clamped progress ring geometry for partial, complete, and empty diffs", () => {
    const empty = computeViewedProgressRing(0, 0, 10);
    expect(empty.ratio).toBe(0);
    expect(empty.isComplete).toBe(false);
    expect(empty.strokeDashoffset).toBeCloseTo(empty.circumference, 5);

    const half = computeViewedProgressRing(2, 4, 10);
    expect(half.viewed).toBe(2);
    expect(half.total).toBe(4);
    expect(half.ratio).toBe(0.5);
    expect(half.isComplete).toBe(false);
    expect(half.strokeDashoffset).toBeCloseTo(half.circumference / 2, 5);

    const overflow = computeViewedProgressRing(9, 4, 10);
    expect(overflow.viewed).toBe(4);
    expect(overflow.ratio).toBe(1);
    expect(overflow.isComplete).toBe(true);
    expect(overflow.strokeDashoffset).toBeCloseTo(0, 5);
  });
});

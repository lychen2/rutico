import { describe, expect, it } from "vite-plus/test";

import {
  clampChartPointerFraction,
  computeEdgeAwarePopoverPosition,
  fractionToPeriodIndex,
  normalizeBrushRange,
  summarizeBrushRange,
} from "./usageChartBrush.logic";

describe("usageChartBrush.logic", () => {
  it("clamps pointer fractions and maps them to valid period indices", () => {
    expect(clampChartPointerFraction(150, 100, 200)).toBeCloseTo(0.25);
    expect(clampChartPointerFraction(20, 100, 200)).toBe(0);
    expect(clampChartPointerFraction(500, 100, 200)).toBe(1);
    expect(clampChartPointerFraction(100, 100, 0)).toBe(0);

    expect(fractionToPeriodIndex(0, 7)).toBe(0);
    expect(fractionToPeriodIndex(0.5, 7)).toBe(3);
    expect(fractionToPeriodIndex(1, 7)).toBe(6);
    expect(fractionToPeriodIndex(0.5, 1)).toBe(0);
  });

  it("normalizes forward and reverse brush drags into ordered inclusive bounds", () => {
    expect(normalizeBrushRange(5, 2, 7)).toEqual({ startIndex: 2, endIndex: 5 });
    expect(normalizeBrushRange(-3, 99, 7)).toEqual({ startIndex: 0, endIndex: 6 });
    expect(normalizeBrushRange(0, 1, 0)).toBeNull();
  });

  it("computes brushed range sum, average, and prior-period delta percent", () => {
    const current = [10, 20, 30, 40, 50];
    const previous = [10, 10, 20, 20, 40];

    const summary = summarizeBrushRange(current, previous, 3, 1);
    expect(summary).toEqual({
      startIndex: 1,
      endIndex: 3,
      count: 3,
      total: 90,
      average: 30,
      previousTotal: 50,
      deltaPercent: 80,
    });
  });

  it("returns null delta when prior range has zero total or mismatched length", () => {
    expect(summarizeBrushRange([5, 15, 25], [0, 0, 0], 0, 2)).toEqual({
      startIndex: 0,
      endIndex: 2,
      count: 3,
      total: 45,
      average: 15,
      previousTotal: 0,
      deltaPercent: null,
    });
    expect(summarizeBrushRange([5, 15, 25], [1, 2], 0, 1)?.previousTotal).toBeNull();
  });

  it("flips floating popover to the left near the right edge and clamps within container", () => {
    expect(computeEdgeAwarePopoverPosition(120, 600, 160)).toEqual({ x: 132, align: "right" });
    expect(computeEdgeAwarePopoverPosition(520, 600, 160)).toEqual({ x: 348, align: "left" });
    expect(computeEdgeAwarePopoverPosition(10, 120, 160)).toEqual({ x: 8, align: "left" });
  });
});

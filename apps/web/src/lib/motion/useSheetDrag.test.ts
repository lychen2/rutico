import { describe, expect, it } from "vite-plus/test";

import { shouldDismissByDrag } from "./rubberBand";
import {
  computeSheetDragOffset,
  isWithinSheetScrollCooldown,
  resolveAxisDismissVelocity,
  SHEET_SCROLL_COOLDOWN_MS,
} from "./useSheetDrag";

describe("useSheetDrag physics helpers", () => {
  it("tracks 1:1 follow along dismiss direction and applies rubber-band resistance on overscroll", () => {
    const rightDismiss = computeSheetDragOffset("right", 120, 0, 300);
    expect(rightDismiss.dismissDelta).toBe(120);
    expect(rightDismiss.tx).toBe(120);
    expect(rightDismiss.ty).toBe(0);
    expect(rightDismiss.backdropOpacity).toBeCloseTo(0.6, 3);

    const rightOverdrag = computeSheetDragOffset("right", -120, 0, 300);
    expect(rightOverdrag.dismissDelta).toBe(-120);
    expect(rightOverdrag.tx).toBeLessThan(0);
    expect(Math.abs(rightOverdrag.tx)).toBeLessThan(120);
    expect(rightOverdrag.backdropOpacity).toBe(1);

    const leftDismiss = computeSheetDragOffset("left", -90, 0, 300);
    expect(leftDismiss.dismissDelta).toBe(90);
    expect(leftDismiss.tx).toBe(-90);
    expect(leftDismiss.backdropOpacity).toBeCloseTo(0.7, 3);

    const bottomDismiss = computeSheetDragOffset("bottom", 0, 150, 400);
    expect(bottomDismiss.dismissDelta).toBe(150);
    expect(bottomDismiss.ty).toBe(150);

    const topDismiss = computeSheetDragOffset("top", 0, -100, 400);
    expect(topDismiss.dismissDelta).toBe(100);
    expect(topDismiss.ty).toBe(-100);
  });

  it("enforces the Vaul 100ms scroll-edge cooldown window", () => {
    expect(SHEET_SCROLL_COOLDOWN_MS).toBe(100);
    expect(isWithinSheetScrollCooldown(1050, 1000)).toBe(true);
    expect(isWithinSheetScrollCooldown(1099, 1000)).toBe(true);
    expect(isWithinSheetScrollCooldown(1100, 1000)).toBe(false);
    expect(isWithinSheetScrollCooldown(50, 0)).toBe(false);
  });

  it("maps axis velocity sign correctly for all four sides and integrates with dismiss thresholds", () => {
    expect(resolveAxisDismissVelocity("right", 0.8, 0)).toBe(0.8);
    expect(resolveAxisDismissVelocity("left", -0.8, 0)).toBe(0.8);
    expect(resolveAxisDismissVelocity("bottom", 0, 0.7)).toBe(0.7);
    expect(resolveAxisDismissVelocity("top", 0, -0.7)).toBe(0.7);

    // Fast flick on a left sheet dismisses even with short travel distance.
    const leftFlickVel = resolveAxisDismissVelocity("left", -0.65, 0);
    expect(shouldDismissByDrag(28, 300, leftFlickVel)).toBe(true);
    // Slow small drag snaps back.
    const slowPullVel = resolveAxisDismissVelocity("left", -0.05, 0);
    expect(shouldDismissByDrag(40, 300, slowPullVel)).toBe(false);
  });
});

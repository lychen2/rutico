import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Animated: {},
  Easing: {
    inOut: (fn: unknown) => fn,
    out: (fn: unknown) => fn,
    quad: (v: number) => v,
    sin: (v: number) => v,
  },
}));
vi.mock("react-native-reanimated", () => ({
  Easing: { out: () => () => 0, cubic: () => 0 },
  ReduceMotion: { System: "system" },
}));

import {
  computePullToCreateDistance,
  PULL_CREATE_DETENT_DP,
  PULL_MAX_OVERSCROLL_DP,
  PULL_REFRESH_DETENT_DP,
  resolvePullToCreateOverscroll,
  resolvePullToCreateStage,
} from "./pullToCreateOverscroll";

describe("pullToCreateOverscroll", () => {
  it("clamps non-positive or non-finite drags to 0 and stage 0", () => {
    expect(computePullToCreateDistance(0)).toBe(0);
    expect(computePullToCreateDistance(-40)).toBe(0);
    expect(computePullToCreateDistance(Number.NaN)).toBe(0);
    expect(resolvePullToCreateStage(0)).toBe(0);
  });

  it("tracks 1:1 up to the refresh detent (64dp) and reaches stage 1 cleanly", () => {
    const mid = computePullToCreateDistance(32);
    expect(mid).toBe(32);
    expect(resolvePullToCreateStage(mid)).toBe(0);

    const refresh = computePullToCreateDistance(PULL_REFRESH_DETENT_DP);
    expect(refresh).toBe(PULL_REFRESH_DETENT_DP);
    expect(resolvePullToCreateStage(refresh)).toBe(1);
  });

  it("applies rubber-band damping past 64dp while cleanly reaching create detent (104dp)", () => {
    const dampedMid = computePullToCreateDistance(140);
    expect(dampedMid).toBeGreaterThan(PULL_REFRESH_DETENT_DP);
    expect(dampedMid).toBeLessThan(PULL_CREATE_DETENT_DP);
    expect(dampedMid).toBeLessThan(140);
    expect(resolvePullToCreateStage(dampedMid)).toBe(1);

    const createArmed = computePullToCreateDistance(210);
    expect(createArmed).toBeGreaterThanOrEqual(PULL_CREATE_DETENT_DP);
    expect(createArmed).toBeLessThan(PULL_MAX_OVERSCROLL_DP);
    expect(resolvePullToCreateStage(createArmed)).toBe(2);
  });

  it("remains strictly monotonic and asymptotically bounded below max overscroll", () => {
    const samples = [0, 16, 48, 64, 100, 160, 210, 400, 2000].map((y) =>
      computePullToCreateDistance(y),
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!).toBeGreaterThan(samples[index - 1]!);
    }
    expect(samples[samples.length - 1]!).toBeLessThan(PULL_MAX_OVERSCROLL_DP);
  });

  it("measures only true overscroll past scrollOffset <= 0 (200dp down + 210dp pull = 10dp)", () => {
    // Gesture starts 200dp down the list; scrolling back to top consumes 200dp.
    const midScroll = resolvePullToCreateOverscroll({
      scrollOffsetY: 100,
      translationY: 100,
      overscrollOriginY: 200,
    });
    expect(midScroll).toEqual({ overscrollOriginY: 200, overscrollY: 0 });

    // Reached top at 200dp and pulled 10dp past top -> only 10dp true overscroll.
    const justPastTop = resolvePullToCreateOverscroll({
      scrollOffsetY: 0,
      translationY: 210,
      overscrollOriginY: midScroll.overscrollOriginY,
    });
    expect(justPastTop).toEqual({ overscrollOriginY: 200, overscrollY: 10 });
    const dampedMidList = computePullToCreateDistance(justPastTop.overscrollY);
    expect(dampedMidList).toBe(10);
    expect(resolvePullToCreateStage(dampedMidList)).toBe(0);

    // Starting at top (0dp) and pulling 210dp counts the full 210dp as true overscroll.
    const fromTop = resolvePullToCreateOverscroll({
      scrollOffsetY: 0,
      translationY: 210,
      overscrollOriginY: 0,
    });
    expect(fromTop).toEqual({ overscrollOriginY: 0, overscrollY: 210 });
    expect(resolvePullToCreateStage(computePullToCreateDistance(fromTop.overscrollY))).toBe(2);
  });
});

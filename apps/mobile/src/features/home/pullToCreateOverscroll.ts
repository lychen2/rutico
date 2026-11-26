import { rubberBandClamp } from "../../lib/mobileMotion";

export const PULL_REFRESH_DETENT_DP = 64;
export const PULL_CREATE_DETENT_DP = 104;
export const PULL_MAX_OVERSCROLL_DP = 148;
const PULL_OVERSCROLL_DIMENSION_DP = PULL_MAX_OVERSCROLL_DP - PULL_REFRESH_DETENT_DP;
const PULL_OVERSCROLL_COEFFICIENT = 0.55;

export type PullToCreateStage = 0 | 1 | 2;

/** Maps downward overscroll (dp) 1:1 through `64dp`, then rubber-band damps across `104dp` toward `148dp`. */
export function computePullToCreateDistance(translationY: number): number {
  "worklet";
  if (!Number.isFinite(translationY) || translationY <= 0) {
    return 0;
  }
  return rubberBandClamp(
    translationY,
    0,
    PULL_REFRESH_DETENT_DP,
    PULL_OVERSCROLL_DIMENSION_DP,
    PULL_OVERSCROLL_COEFFICIENT,
  );
}

export function resolvePullToCreateStage(distance: number): PullToCreateStage {
  "worklet";
  if (distance >= PULL_CREATE_DETENT_DP) return 2;
  if (distance >= PULL_REFRESH_DETENT_DP) return 1;
  return 0;
}

/**
 * Computes true overscroll past `scrollOffsetY <= 0` for a downward pan gesture so distance
 * consumed scrolling back from mid-list never counts toward pull-to-create.
 */
export function resolvePullToCreateOverscroll(input: {
  readonly scrollOffsetY: number;
  readonly translationY: number;
  readonly overscrollOriginY: number | null;
}): {
  readonly overscrollOriginY: number;
  readonly overscrollY: number;
} {
  "worklet";
  const clampedScrollOffset =
    Number.isFinite(input.scrollOffsetY) && input.scrollOffsetY > 0 ? input.scrollOffsetY : 0;
  const translationY = Number.isFinite(input.translationY) ? input.translationY : 0;
  const previousOrigin =
    input.overscrollOriginY !== null && Number.isFinite(input.overscrollOriginY)
      ? input.overscrollOriginY
      : clampedScrollOffset;

  if (clampedScrollOffset > 0) {
    return {
      overscrollOriginY: Math.max(previousOrigin, translationY + clampedScrollOffset),
      overscrollY: 0,
    };
  }

  if (translationY <= 0) {
    return { overscrollOriginY: previousOrigin, overscrollY: 0 };
  }

  return {
    overscrollOriginY: previousOrigin,
    overscrollY: Math.max(0, translationY - previousOrigin),
  };
}

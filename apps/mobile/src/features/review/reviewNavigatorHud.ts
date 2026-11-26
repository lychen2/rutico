export interface ViewedProgressRingMetrics {
  readonly viewed: number;
  readonly total: number;
  readonly ratio: number;
  readonly circumference: number;
  readonly strokeDashoffset: number;
  readonly isComplete: boolean;
}

export function computeViewedProgressRing(
  viewedCount: number,
  totalCount: number,
  radius: number,
): ViewedProgressRingMetrics {
  const total = Math.max(0, Math.floor(totalCount));
  const viewed = Math.max(0, Math.min(total, Math.floor(viewedCount)));
  const ratio = total > 0 ? viewed / total : 0;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - ratio);
  return {
    viewed,
    total,
    ratio,
    circumference,
    strokeDashoffset,
    isComplete: total > 0 && viewed === total,
  };
}

export interface BrushIndexRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface BrushRangeSummary extends BrushIndexRange {
  readonly count: number;
  readonly total: number;
  readonly average: number;
  readonly previousTotal: number | null;
  readonly deltaPercent: number | null;
}

export interface EdgeAwarePopoverPosition {
  readonly x: number;
  readonly align: "left" | "right";
}

/** Clamps a clientX coordinate into a normalized [0, 1] fraction across a plot box. */
export function clampChartPointerFraction(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
): number {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return 0;
  const fraction = (clientX - rectLeft) / rectWidth;
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

/** Converts a normalized [0, 1] fraction into a clamped period index. */
export function fractionToPeriodIndex(fraction: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(count - 1, Math.max(0, Math.round(clamped * (count - 1))));
}

/** Normalizes any two anchor/focus indices into an ordered inclusive [startIndex, endIndex] span. */
export function normalizeBrushRange(
  anchorIndex: number,
  focusIndex: number,
  count: number,
): BrushIndexRange | null {
  if (count <= 0) return null;
  const last = count - 1;
  const a = Math.min(last, Math.max(0, Math.trunc(anchorIndex)));
  const b = Math.min(last, Math.max(0, Math.trunc(focusIndex)));
  return a <= b ? { startIndex: a, endIndex: b } : { startIndex: b, endIndex: a };
}

/** Aggregates values (and optional prior-period values) across an inclusive brushed index span. */
export function summarizeBrushRange(
  values: readonly number[],
  previousValues: readonly number[] | undefined,
  anchorIndex: number,
  focusIndex: number,
): BrushRangeSummary | null {
  const range = normalizeBrushRange(anchorIndex, focusIndex, values.length);
  if (range === null) return null;

  let total = 0;
  let previousTotal = 0;
  const hasPrevious = previousValues !== undefined && previousValues.length === values.length;

  for (let index = range.startIndex; index <= range.endIndex; index += 1) {
    total += values[index] ?? 0;
    if (hasPrevious) {
      previousTotal += previousValues[index] ?? 0;
    }
  }

  const count = range.endIndex - range.startIndex + 1;
  const average = count > 0 ? total / count : 0;
  const deltaPercent =
    hasPrevious && previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null;

  return {
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    count,
    total,
    average,
    previousTotal: hasPrevious ? previousTotal : null,
    deltaPercent,
  };
}

/**
 * Computes an edge-aware horizontal translate3d offset for a floating chart popover.
 * Prefers placing the popover to the right of the cursor and flips cleanly to the left
 * when approaching the container's right edge.
 */
export function computeEdgeAwarePopoverPosition(
  pointerX: number,
  containerWidth: number,
  popoverWidth: number,
  gap = 12,
  margin = 8,
): EdgeAwarePopoverPosition {
  if (containerWidth <= 0 || popoverWidth <= 0) {
    return { x: margin, align: "right" };
  }
  const maxRightX = containerWidth - popoverWidth - margin;
  const rightCandidate = pointerX + gap;
  if (rightCandidate <= maxRightX) {
    return { x: Math.max(margin, rightCandidate), align: "right" };
  }
  const leftCandidate = pointerX - gap - popoverWidth;
  return {
    x: Math.min(Math.max(margin, leftCandidate), Math.max(margin, maxRightX)),
    align: "left",
  };
}

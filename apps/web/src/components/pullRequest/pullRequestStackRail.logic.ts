import type { PullRequestCheck, PullRequestStack } from "@t3tools/contracts";

export type StackRailNodeTone = "merged" | "closed" | "draft" | "open";

export interface StackRailNode {
  readonly layer: PullRequestStack["layers"][number];
  readonly index: number;
  readonly positionFromBase: number;
  readonly totalLayers: number;
  readonly isCurrent: boolean;
  readonly isBelowCurrent: boolean;
  readonly isTop: boolean;
  readonly isBottom: boolean;
  readonly tone: StackRailNodeTone;
}

/**
 * Projects a stacked PR's layers (ordered base->tip in the contract) into a
 * top-to-bottom metro rail with active spine metadata anchored at `currentNumber`.
 */
export function buildStackRailNodes(
  stack: PullRequestStack,
  currentNumber: number,
): ReadonlyArray<StackRailNode> {
  const totalLayers = stack.layers.length;
  const topDown = stack.layers.toReversed();
  const currentTopIndex = topDown.findIndex((layer) => layer.number === currentNumber);

  return topDown.map((layer, index) => {
    const tone: StackRailNodeTone =
      layer.state === "merged"
        ? "merged"
        : layer.state === "closed"
          ? "closed"
          : layer.isDraft
            ? "draft"
            : "open";
    return {
      layer,
      index,
      positionFromBase: totalLayers - index,
      totalLayers,
      isCurrent: layer.number === currentNumber,
      isBelowCurrent: currentTopIndex >= 0 && index > currentTopIndex,
      isTop: index === 0,
      isBottom: index === totalLayers - 1,
      tone,
    };
  });
}

export interface ChecksRingSegment {
  readonly kind: "passed" | "running" | "failed" | "neutral";
  readonly count: number;
  readonly fraction: number;
  readonly dashLength: number;
  readonly dashOffset: number;
}

export interface ChecksRingSummary {
  readonly total: number;
  readonly passed: number;
  readonly running: number;
  readonly failed: number;
  readonly neutral: number;
  readonly segments: ReadonlyArray<ChecksRingSegment>;
}

/**
 * Classifies pull request checks into multi-segment SVG ring geometry for the
 * 36px summary ring in PullRequestChecksPopover.
 */
export function summarizeChecksRing(
  checks: ReadonlyArray<Pick<PullRequestCheck, "status">>,
  circumference: number,
): ChecksRingSummary {
  let passed = 0;
  let running = 0;
  let failed = 0;
  let neutral = 0;

  for (const check of checks) {
    switch (check.status) {
      case "success":
        passed += 1;
        break;
      case "pending":
        running += 1;
        break;
      case "failure":
      case "action-required":
        failed += 1;
        break;
      default:
        neutral += 1;
        break;
    }
  }

  const total = checks.length;
  const ordered: ReadonlyArray<{
    readonly kind: ChecksRingSegment["kind"];
    readonly count: number;
  }> = [
    { kind: "passed", count: passed },
    { kind: "running", count: running },
    { kind: "failed", count: failed },
    { kind: "neutral", count: neutral },
  ];

  const segments: ChecksRingSegment[] = [];
  let cursor = 0;
  if (total > 0 && circumference > 0) {
    for (const entry of ordered) {
      if (entry.count <= 0) continue;
      const fraction = entry.count / total;
      const dashLength = fraction * circumference;
      segments.push({
        kind: entry.kind,
        count: entry.count,
        fraction,
        dashLength,
        dashOffset: -cursor,
      });
      cursor += dashLength;
    }
  }

  return { total, passed, running, failed, neutral, segments };
}

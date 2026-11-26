import type { PullRequestStack } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildStackRailNodes, summarizeChecksRing } from "./pullRequestStackRail.logic";

describe("buildStackRailNodes", () => {
  it("orders layers top-down and marks the spine below the current PR", () => {
    const stack: PullRequestStack = {
      id: "stack-1",
      number: 7,
      url: "https://github.com/org/repo/stack/7",
      base: "main",
      layers: [
        { number: 101, headBranch: "feat/base", headSha: "aaa", state: "merged" },
        { number: 102, headBranch: "feat/mid", headSha: "bbb", state: "open" },
        { number: 103, headBranch: "feat/tip", headSha: "ccc", state: "open", isDraft: true },
      ],
    };

    const nodes = buildStackRailNodes(stack, 102);
    expect(nodes.map((n) => n.layer.number)).toEqual([103, 102, 101]);
    expect(nodes.map((n) => n.positionFromBase)).toEqual([3, 2, 1]);
    expect(nodes[0]).toMatchObject({
      isTop: true,
      isBottom: false,
      isCurrent: false,
      isBelowCurrent: false,
      tone: "draft",
    });
    expect(nodes[1]).toMatchObject({
      isTop: false,
      isBottom: false,
      isCurrent: true,
      isBelowCurrent: false,
      tone: "open",
    });
    expect(nodes[2]).toMatchObject({
      isTop: false,
      isBottom: true,
      isCurrent: false,
      isBelowCurrent: true,
      tone: "merged",
    });
  });

  it("handles single-layer stacks without active spine leaks", () => {
    const stack: PullRequestStack = {
      id: "stack-2",
      number: 1,
      url: "https://github.com/org/repo/stack/1",
      base: "main",
      layers: [{ number: 50, headBranch: "fix/one", headSha: "111", state: "closed" }],
    };

    const nodes = buildStackRailNodes(stack, 50);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      positionFromBase: 1,
      totalLayers: 1,
      isTop: true,
      isBottom: true,
      isCurrent: true,
      isBelowCurrent: false,
      tone: "closed",
    });
  });
});

describe("summarizeChecksRing", () => {
  it("computes contiguous SVG dash segments summing to the full circumference", () => {
    const circumference = 100;
    const summary = summarizeChecksRing(
      [
        { status: "success" },
        { status: "success" },
        { status: "pending" },
        { status: "failure" },
        { status: "neutral" },
      ],
      circumference,
    );

    expect(summary.total).toBe(5);
    expect(summary.passed).toBe(2);
    expect(summary.running).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.neutral).toBe(1);
    expect(summary.segments).toEqual([
      { kind: "passed", count: 2, fraction: 0.4, dashLength: 40, dashOffset: -0 },
      { kind: "running", count: 1, fraction: 0.2, dashLength: 20, dashOffset: -40 },
      { kind: "failed", count: 1, fraction: 0.2, dashLength: 20, dashOffset: -60 },
      { kind: "neutral", count: 1, fraction: 0.2, dashLength: 20, dashOffset: -80 },
    ]);
    const totalLength = summary.segments.reduce((acc, seg) => acc + seg.dashLength, 0);
    expect(totalLength).toBeCloseTo(circumference, 6);
  });

  it("returns empty segments for zero checks", () => {
    const summary = summarizeChecksRing([], 88);
    expect(summary.total).toBe(0);
    expect(summary.segments).toEqual([]);
  });
});

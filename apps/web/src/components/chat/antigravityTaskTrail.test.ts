import { describe, expect, it } from "vite-plus/test";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { PlanId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { antigravityTaskTrail } from "./antigravityTaskTrail";
import { capsuleMode, deriveMilestones } from "./taskMilestones";

const gt = ((text: string, vars?: Record<string, string | number>) => {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}) as Parameters<typeof antigravityTaskTrail>[2];

function makeProjection(input: {
  readonly runs: ThreadStructure["runs"];
  readonly plans: ThreadStructure["plans"];
  readonly turnItems: ThreadStructure["turnItems"];
}): ThreadStructure {
  const threadId = ThreadId.make("thread-omp-1");
  return {
    thread: {
      id: threadId,
    },
    runs: input.runs,
    plans: input.plans,
    turnItems: input.turnItems,
  } as unknown as ThreadStructure;
}

describe("antigravityTaskTrail (OMP task card regressions)", () => {
  it("does not attach a new run's running tools to a previous run's completed OMP plan", () => {
    const threadId = ThreadId.make("thread-omp-1");
    const run1 = RunId.make("run-1");
    const run2 = RunId.make("run-2");
    const t1 = DateTime.makeUnsafe("2026-11-26T10:00:00.000Z");
    const t2 = DateTime.makeUnsafe("2026-11-26T10:01:00.000Z");

    const projection = makeProjection({
      runs: [
        { id: run1, status: "completed", startedAt: t1, completedAt: t2 },
        { id: run2, status: "running", startedAt: t2, completedAt: null },
      ] as unknown as ThreadStructure["runs"],
      plans: [
        {
          id: PlanId.make(`omp-todo:${threadId}`),
          threadId,
          runId: run1,
          kind: "todo_list",
          status: "completed",
          steps: [
            { id: "step-1", text: "Old step 1", status: "completed" },
            { id: "step-2", text: "Old step 2", status: "completed" },
          ],
        },
      ] as unknown as ThreadStructure["plans"],
      turnItems: [
        {
          id: TurnItemId.make("item-new-1"),
          runId: run2,
          parentItemId: null,
          ordinal: 1,
          type: "command_execution",
          input: "vp test run",
          status: "running",
          toolPurpose: "Run regression suite",
          startedAt: t2,
        },
      ] as unknown as ThreadStructure["turnItems"],
    });

    const trail = antigravityTaskTrail(projection, run2, gt);
    expect(trail).not.toBeNull();
    expect(trail?.planId).toBeUndefined();
    expect(trail?.complete).toBe(false);
    expect(trail?.waiting).toBe(false);
    expect(trail?.steps).toHaveLength(1);
    expect(trail?.steps[0]?.text).toBe("Run regression suite");
    expect(trail?.steps[0]?.status).toBe("running");
  });

  it("preserves every external [blocked] step reason and never reports Needs confirmation without a pending approval", () => {
    const threadId = ThreadId.make("thread-omp-1");
    const run1 = RunId.make("run-1");
    const t1 = DateTime.makeUnsafe("2026-11-26T10:00:00.000Z");

    const projection = makeProjection({
      runs: [
        { id: run1, status: "running", startedAt: t1, completedAt: null },
      ] as unknown as ThreadStructure["runs"],
      plans: [
        {
          id: PlanId.make(`omp-todo:${threadId}`),
          threadId,
          runId: run1,
          kind: "todo_list",
          status: "in_progress",
          steps: [
            { id: "s1", text: "Build image\n[blocked] waiting for CI", status: "pending" },
            {
              id: "s2",
              text: "Deploy canary\n[blocked] waiting for security scan",
              status: "pending",
            },
            { id: "s3", text: "Verify metrics", status: "pending" },
          ],
        },
      ] as unknown as ThreadStructure["plans"],
      turnItems: [],
    });

    const trail = antigravityTaskTrail(projection, run1, gt);
    expect(trail).not.toBeNull();
    expect(trail?.waiting).toBe(false);
    expect(trail?.complete).toBe(false);
    expect(trail?.blockedReasons).toEqual({
      s1: "waiting for CI",
      s2: "waiting for security scan",
    });

    const milestones = deriveMilestones({
      steps: trail!.steps,
      activities: trail!.activities,
      waitingStepId: undefined,
      blockedReasons: trail!.blockedReasons,
    });
    expect(milestones[0]?.status).toBe("blocked");
    expect(milestones[0]?.blockedReasons).toEqual(["waiting for CI"]);
    expect(milestones[1]?.status).toBe("blocked");
    expect(milestones[1]?.blockedReasons).toEqual(["waiting for security scan"]);
    expect(
      capsuleMode(milestones, {
        waiting: trail!.waiting,
        complete: trail!.complete,
        failed: trail!.failed,
      }),
    ).toBe("blocked");
  });
});

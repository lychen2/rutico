import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, NodeId, PlanId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { makeThreadFixture, makeThreadProjectionFixture } from "../../test-fixtures";
import {
  buildSidebarOverview,
  previewActiveWork,
  selectOverviewProgress,
} from "./SidebarOverview.logic";

const start = "2026-01-01T00:00:00.000Z";
const end = "2026-01-01T00:01:00.000Z";
const now = "2026-01-01T00:02:00.000Z";

it("keeps actionable requests after visiting, but removes read results and excludes them from the badge", () => {
  const completed = makeThreadFixture({
    id: ThreadId.make("completed"),
    latestRun: {
      runId: RunId.make("result"),
      status: "completed",
      requestedAt: start,
      startedAt: start,
      completedAt: end,
      assistantMessageId: null,
    },
  });
  const approval = makeThreadFixture({
    id: ThreadId.make("approval"),
    hasPendingApprovals: true,
    lastVisitedAt: now,
    updatedAt: now,
  });
  const input = makeThreadFixture({
    id: ThreadId.make("input"),
    hasPendingUserInput: true,
    lastVisitedAt: now,
    updatedAt: end,
  });
  const key = scopedThreadKey(scopeThreadRef(completed.environmentId, completed.id));
  const threads = [completed, approval, input];
  const first = buildSidebarOverview(threads, now, { [key]: start });
  expect(first.attention.map((row) => row.status)).toEqual(["input", "approval", "unread"]);
  expect(first.attentionCount).toBe(2);
  expect(
    buildSidebarOverview(threads, now, { [key]: now }).attention.map((row) => row.ref.threadId),
  ).toEqual([input.id, approval.id]);
});

it("retains failed work until settlement and does not surface a previous failure during an active retry", () => {
  const failed = makeThreadFixture({
    id: ThreadId.make("failure"),
    lastVisitedAt: now,
    latestRun: {
      runId: RunId.make("failure"),
      status: "failed",
      requestedAt: start,
      startedAt: start,
      completedAt: end,
      assistantMessageId: null,
    },
  });
  expect(buildSidebarOverview([failed], now, {}).attention.map((row) => row.status)).toEqual([
    "failed",
  ]);
  expect(buildSidebarOverview([{ ...failed, settledAt: now }], now, {}).attention).toEqual([]);
  const retry = {
    ...failed,
    runtime: {
      status: "running" as const,
      activeRunId: RunId.make("retry"),
      providerInstanceId: failed.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: now,
    },
  };
  const overview = buildSidebarOverview([retry], now, {});
  expect(overview.attention).toEqual([]);
  expect(overview.active.map(({ root }) => root.status)).toEqual(["working"]);
});

it("preserves a cross-environment child's route and keeps the running preview within five rows", () => {
  const home = EnvironmentId.make("home");
  const remote = EnvironmentId.make("remote");
  const root = makeThreadFixture({ environmentId: home, id: ThreadId.make("root"), createdAt: start });
  const remoteRoot = makeThreadFixture({
    environmentId: remote,
    id: root.id,
    createdAt: end,
    hasPendingApprovals: true,
  });
  const request = makeThreadFixture({
    environmentId: remote,
    id: ThreadId.make("part-1"),
    delegatedFrom: { environmentId: home, threadId: root.id, title: root.title },
    hasPendingUserInput: true,
  });
  const otherChildren = [2, 3].map((index) =>
    makeThreadFixture({
      environmentId: home,
      id: ThreadId.make(`part-${index}`),
      lineage: { rootThreadId: root.id, parentThreadId: root.id, relationshipToParent: "subagent" },
      hasPendingApprovals: true,
    }),
  );
  const otherRoots = ["a", "b"].map((id) =>
    makeThreadFixture({ id: ThreadId.make(id), createdAt: now, hasPendingApprovals: true }),
  );
  const { active, attention } = buildSidebarOverview(
    [...otherRoots, ...otherChildren, remoteRoot, request, root],
    now,
    {},
  );
  expect(active[0]?.root.ref).toEqual(scopeThreadRef(home, root.id));
  expect(active[0]?.root.status).toBe("children");
  expect(active[0]?.children.map((row) => row.ref)).toContainEqual(
    scopeThreadRef(remote, request.id),
  );
  expect(attention.find((row) => row.status === "input")?.ref).toEqual(
    scopeThreadRef(remote, request.id),
  );
  expect(previewActiveWork(active).map((group) => group.children.length)).toEqual([2, 0, 0]);
  expect(active[0]?.children).toHaveLength(3);
});

it("counts progress from the live OMP checklist and respects a cleared snapshot", () => {
  const projection = makeThreadProjectionFixture();
  const thread = makeThreadFixture({ id: projection.thread.id });
  const plan = {
    id: PlanId.make(`omp-todo:${thread.id}`),
    threadId: thread.id,
    nodeId: NodeId.make("work"),
    runId: null,
    status: "active",
    kind: "todo_list",
    steps: [
      { id: "done", text: "Done", status: "completed" },
      { id: "next", text: "Next", status: "running" },
      { id: "dropped", text: "Dropped\n[abandoned]", status: "pending" },
    ],
  } as const;
  expect(selectOverviewProgress({ ...projection, plans: [plan] }, thread)).toEqual({
    done: 1,
    total: 2,
  });
  expect(selectOverviewProgress({ ...projection, plans: [{ ...plan, steps: [] }] }, thread)).toBeNull();
});

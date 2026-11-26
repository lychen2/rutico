import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, NodeId, PlanId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { makeThreadFixture, makeThreadProjectionFixture } from "../../test-fixtures";
import {
  buildSidebarOverview,
  collectActiveOverviewKeys,
  failedRunToken,
  logicalDayStartMs,
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
  const root = makeThreadFixture({
    environmentId: home,
    id: ThreadId.make("root"),
    createdAt: start,
  });
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
  expect(
    selectOverviewProgress({ ...projection, plans: [{ ...plan, steps: [] }] }, thread),
  ).toBeNull();
});

it("dismisses an acknowledged failed run while resurfacing a newer failed run", () => {
  const failed = makeThreadFixture({
    id: ThreadId.make("failed-dismiss"),
    lastVisitedAt: now,
    latestRun: {
      runId: RunId.make("run-fail-1"),
      status: "failed",
      requestedAt: start,
      startedAt: start,
      completedAt: end,
      assistantMessageId: null,
    },
  });
  const key = scopedThreadKey(scopeThreadRef(failed.environmentId, failed.id));
  const token = failedRunToken(failed)!;
  expect(buildSidebarOverview([failed], now, {}, { [key]: token }).attention).toEqual([]);

  const failedAgain = {
    ...failed,
    latestRun: {
      ...failed.latestRun!,
      runId: RunId.make("run-fail-2"),
      completedAt: now,
    },
  };
  expect(
    buildSidebarOverview([failedAgain], now, {}, { [key]: token }).attention.map(
      (row) => row.status,
    ),
  ).toEqual(["failed"]);
});

it("collects today's tasks with a 04:00 local rollover and excludes running and attention rows", () => {
  const localTime = (year: number, month: number, day: number, hour: number, minute = 0) =>
    new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();

  // At 03:30 local time on Jan 2, the logical day still starts at Jan 1 04:00.
  const beforeRolloverNow = localTime(2026, 1, 2, 3, 30);
  expect(logicalDayStartMs(Date.parse(beforeRolloverNow))).toBe(
    new Date(2026, 0, 1, 4, 0, 0, 0).getTime(),
  );

  // At 04:00 local time on Jan 2, the logical day rolls over to Jan 2 04:00.
  const afterRolloverNow = localTime(2026, 1, 2, 4, 0);
  expect(logicalDayStartMs(Date.parse(afterRolloverNow))).toBe(
    new Date(2026, 0, 2, 4, 0, 0, 0).getTime(),
  );

  const beforeBoundary = makeThreadFixture({
    id: ThreadId.make("before-4am"),
    createdAt: localTime(2026, 1, 1, 3, 0),
    updatedAt: localTime(2026, 1, 1, 3, 59),
  });
  const activeToday = makeThreadFixture({
    id: ThreadId.make("active-today"),
    createdAt: localTime(2026, 1, 1, 10, 0),
    updatedAt: localTime(2026, 1, 2, 1, 15),
  });
  const settledToday = makeThreadFixture({
    id: ThreadId.make("settled-today"),
    createdAt: localTime(2026, 1, 1, 9, 0),
    updatedAt: localTime(2026, 1, 1, 20, 0),
    settledOverride: "settled",
    settledAt: localTime(2026, 1, 2, 2, 0),
  });
  const runningToday = makeThreadFixture({
    id: ThreadId.make("running-today"),
    createdAt: localTime(2026, 1, 2, 2, 30),
    updatedAt: localTime(2026, 1, 2, 2, 30),
    runtime: {
      status: "running",
      activeRunId: RunId.make("live-run"),
      providerInstanceId: settledToday.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: localTime(2026, 1, 2, 2, 30),
    },
  });
  const attentionToday = makeThreadFixture({
    id: ThreadId.make("attention-today"),
    createdAt: localTime(2026, 1, 2, 2, 40),
    updatedAt: localTime(2026, 1, 2, 2, 40),
    latestRun: {
      runId: RunId.make("fail-today"),
      status: "failed",
      requestedAt: localTime(2026, 1, 2, 2, 35),
      startedAt: localTime(2026, 1, 2, 2, 35),
      completedAt: localTime(2026, 1, 2, 2, 40),
      assistantMessageId: null,
    },
  });

  const threads = [beforeBoundary, activeToday, settledToday, runningToday, attentionToday];
  const overviewBeforeRollover = buildSidebarOverview(threads, beforeRolloverNow, {});
  expect(overviewBeforeRollover.todayTasks.map((row) => [row.ref.threadId, row.status])).toEqual([
    [settledToday.id, "done"],
    [activeToday.id, "today"],
  ]);
  expect(
    collectActiveOverviewKeys(threads).has(
      scopedThreadKey(scopeThreadRef(runningToday.environmentId, runningToday.id)),
    ),
  ).toBe(true);

  const overviewAfterRollover = buildSidebarOverview(threads, afterRolloverNow, {});
  expect(overviewAfterRollover.todayTasks).toEqual([]);
});

it("excludes finished cross-environment delegated tasks from attention and today's tasks unless orphaned", () => {
  const home = EnvironmentId.make("home");
  const remote = EnvironmentId.make("remote");
  const root = makeThreadFixture({
    environmentId: home,
    id: ThreadId.make("root"),
    createdAt: start,
    updatedAt: start,
  });
  const archivedRoot = makeThreadFixture({
    environmentId: home,
    id: ThreadId.make("archived-root"),
    createdAt: start,
    updatedAt: start,
    archivedAt: now,
  });
  const finishedRemoteChild = makeThreadFixture({
    environmentId: remote,
    id: ThreadId.make("remote-done"),
    delegatedFrom: { environmentId: home, threadId: root.id, title: root.title },
    createdAt: end,
    updatedAt: end,
    lastVisitedAt: start,
    latestRun: {
      runId: RunId.make("run-done"),
      status: "completed",
      requestedAt: start,
      startedAt: start,
      completedAt: end,
      assistantMessageId: null,
    },
  });
  const failedRemoteChild = makeThreadFixture({
    environmentId: remote,
    id: ThreadId.make("remote-fail"),
    delegatedFrom: { environmentId: home, threadId: root.id, title: root.title },
    createdAt: end,
    updatedAt: end,
    lastVisitedAt: start,
    latestRun: {
      runId: RunId.make("run-fail"),
      status: "failed",
      requestedAt: start,
      startedAt: start,
      completedAt: end,
      assistantMessageId: null,
    },
  });
  const orphanedRemoteChild = makeThreadFixture({
    environmentId: remote,
    id: ThreadId.make("remote-orphan"),
    delegatedFrom: {
      environmentId: home,
      threadId: archivedRoot.id,
      title: archivedRoot.title,
    },
    createdAt: end,
    updatedAt: end,
    lastVisitedAt: start,
    latestRun: {
      runId: RunId.make("run-orphan"),
      status: "completed",
      requestedAt: start,
      startedAt: start,
      completedAt: end,
      assistantMessageId: null,
    },
  });

  const overview = buildSidebarOverview(
    [root, archivedRoot, finishedRemoteChild, failedRemoteChild, orphanedRemoteChild],
    now,
    {},
  );
  expect(overview.attention.map((row) => [row.ref.threadId, row.status])).toEqual([
    [orphanedRemoteChild.id, "unread"],
  ]);
  expect(overview.attentionCount).toBe(0);
  expect(overview.todayTasks.map((row) => row.ref.threadId)).toEqual([root.id]);
});

it("suppresses stale running and approval states for disconnected environments until they reconnect", () => {
  const home = EnvironmentId.make("home");
  const remote = EnvironmentId.make("remote");
  const root = makeThreadFixture({
    environmentId: home,
    id: ThreadId.make("home-root"),
    createdAt: start,
  });
  const cachedRunningChild = makeThreadFixture({
    environmentId: remote,
    id: ThreadId.make("remote-running"),
    delegatedFrom: { environmentId: home, threadId: root.id, title: root.title },
    createdAt: end,
    updatedAt: end,
    hasPendingApprovals: true,
    runtime: {
      status: "running",
      activeRunId: RunId.make("remote-run"),
      providerInstanceId: root.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: end,
    },
  });
  const disconnected = new Set([remote]);
  const threads = [root, cachedRunningChild];

  const offlineOverview = buildSidebarOverview(threads, now, {}, {}, disconnected);
  expect(offlineOverview.active).toEqual([]);
  expect(offlineOverview.attention).toEqual([]);
  expect(collectActiveOverviewKeys(threads, disconnected).size).toBe(0);

  const reconnectedOverview = buildSidebarOverview(threads, now, {}, {}, undefined);
  expect(reconnectedOverview.active).toHaveLength(1);
  expect(reconnectedOverview.active[0]?.children.map((row) => row.ref.threadId)).toEqual([
    cachedRunningChild.id,
  ]);
  expect(
    collectActiveOverviewKeys(threads).has(
      scopedThreadKey(scopeThreadRef(remote, cachedRunningChild.id)),
    ),
  ).toBe(true);
});

it("classifies many finished delegated threads without duplicating them under todayTasks", () => {
  const home = EnvironmentId.make("home");
  const remote = EnvironmentId.make("remote");
  const root = makeThreadFixture({
    environmentId: home,
    id: ThreadId.make("home-root-many"),
    createdAt: start,
    updatedAt: end,
  });
  const delegates = Array.from({ length: 200 }, (_, index) =>
    makeThreadFixture({
      environmentId: remote,
      id: ThreadId.make(`remote-delegate-${index}`),
      delegatedFrom: { environmentId: home, threadId: root.id, title: root.title },
      createdAt: end,
      updatedAt: end,
      lastVisitedAt: end,
      latestRun: {
        runId: RunId.make(`run-delegate-${index}`),
        status: "completed",
        requestedAt: start,
        startedAt: start,
        completedAt: end,
        assistantMessageId: null,
      },
    }),
  );

  const overview = buildSidebarOverview([root, ...delegates], now, {});
  expect(overview.active).toEqual([]);
  expect(overview.attention).toEqual([]);
  expect(overview.todayTasks.map((row) => row.ref.threadId)).toEqual([root.id]);
});

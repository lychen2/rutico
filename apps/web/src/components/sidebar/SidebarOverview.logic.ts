import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  resolveThreadWorkingStartedAt,
  type EnvironmentThreadShell,
  type ThreadStructure,
} from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { resolveListedAncestorThreadRef } from "@t3tools/client-runtime/state/threads";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "../Sidebar.logic";

type RequestStatus = "approval" | "input";
export type OverviewStatus =
  | RequestStatus
  | "starting"
  | "queued"
  | "working"
  | "waiting"
  | "background"
  | "children"
  | "failed"
  | "unread";

type OverviewRow<S extends OverviewStatus = OverviewStatus> = {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly thread: EnvironmentThreadShell;
  readonly timestamp: number | null;
  readonly status: S;
};

type AttentionStatus = RequestStatus | "failed" | "unread";
type ActiveStatus = Exclude<OverviewStatus, "failed" | "unread">;

type ActiveGroup = {
  readonly root: OverviewRow<ActiveStatus>;
  readonly children: readonly OverviewRow<ActiveStatus>[];
  readonly childCount: number;
};

export const ATTENTION_PREVIEW_LIMIT = 5;

function activeStatus(
  thread: EnvironmentThreadShell,
  request: RequestStatus | null,
  waitsForBackground: boolean,
): ActiveStatus | null {
  if (request === "approval" || thread.pendingSubagentRequest === "approval") return "approval";
  if (request === "input" || thread.pendingSubagentRequest === "user_input") return "input";
  switch (thread.runtime?.status ?? thread.source.activityRunStatus ?? thread.source.status) {
    case "queued":
      return "queued";
    case "preparing":
    case "starting":
      return "starting";
    case "running":
      return thread.blockedOnThreadWait ? "waiting" : "working";
    case "waiting":
      return "waiting";
    default:
      return waitsForBackground ? "background" : null;
  }
}

const attentionRank: Record<AttentionStatus, number> = { approval: 0, input: 0, failed: 1, unread: 2 };

export function buildSidebarOverview(
  threads: readonly EnvironmentThreadShell[],
  now: string,
  localVisits: Readonly<Record<string, string | undefined>>,
) {
  const liveThreads = threads.filter((thread) => thread.deletedAt === null);
  const byKey = new Map<string, EnvironmentThreadShell>();
  const running = new Map<string, OverviewRow<ActiveStatus>>();
  const attention: OverviewRow<AttentionStatus>[] = [];
  let attentionCount = 0;
  for (const thread of liveThreads) {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const key = scopedThreadKey(ref);
    byKey.set(key, thread);
    const request = thread.hasPendingApprovals
      ? "approval"
      : thread.hasPendingUserInput
        ? "input"
        : null;
    const waitsForBackground = backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);
    const status = activeStatus(thread, request, waitsForBackground);
    const run = thread.latestRun;
    if (status !== null) {
      const started = resolveThreadWorkingStartedAt(thread);
      const shellStarted = thread.source.activityRunStartedAt;
      running.set(key, {
        key,
        ref,
        thread,
        status,
        timestamp:
          started !== null
            ? Date.parse(started)
            : shellStarted == null
              ? null
              : DateTime.toEpochMillis(shellStarted),
      });
    }
    if (effectiveSnoozed(thread, { now })) continue;
    const pendingAt = thread.source.pendingRuntimeRequest?.createdAt;
    if (request !== null) {
      attentionCount += 1;
      attention.push({
        key,
        ref,
        thread,
        status: request,
        timestamp:
          pendingAt === undefined
            ? Date.parse(run?.requestedAt ?? run?.startedAt ?? thread.updatedAt)
            : DateTime.toEpochMillis(pendingAt),
      });
      continue;
    }
    if (
      status !== null ||
      thread.archivedAt !== null ||
      thread.lineage.relationshipToParent === "subagent" ||
      thread.pendingBackgroundTasks.some((task) => task.kind === "monitor")
    ) {
      continue;
    }
    const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisits[key]);
    const timestamp = Date.parse(run?.completedAt ?? thread.updatedAt);
    if (
      run?.status === "failed" &&
      (thread.settledAt === null ||
        (run.completedAt !== null && timestamp > Date.parse(thread.settledAt)))
    ) {
      attentionCount += 1;
      attention.push({ key, ref, thread, status: "failed", timestamp });
    } else if (run?.status === "completed" && hasUnseenCompletion({ ...thread, lastVisitedAt })) {
      attention.push({ key, ref, thread, status: "unread", timestamp });
    }
  }

  const groups = new Map<
    string,
    { root: OverviewRow<ActiveStatus>; children: OverviewRow<ActiveStatus>[] }
  >();
  for (const row of running.values()) {
    const { thread } = row;
    const rootRef =
      thread.lineage.parentThreadId === null && thread.delegatedFrom === null
        ? row.ref
        : resolveListedAncestorThreadRef(row.ref, liveThreads);
    const rootKey = scopedThreadKey(rootRef);
    let group = groups.get(rootKey);
    if (group === undefined) {
      const root = running.get(rootKey) ?? {
        key: rootKey,
        ref: rootRef,
        thread: byKey.get(rootKey) ?? thread,
        status: "children",
        timestamp: null,
      };
      group = { root, children: [] };
      groups.set(rootKey, group);
    }
    if (rootKey !== row.key) group.children.push(row);
  }

  const creationOrder = (a: OverviewRow, b: OverviewRow) =>
    a.thread.createdAt.localeCompare(b.thread.createdAt) || a.key.localeCompare(b.key);
  const active = Array.from(groups.values(), ({ root, children }) => ({
    root,
    children: children.sort(creationOrder),
    childCount: children.length,
  })).sort((a, b) => creationOrder(a.root, b.root));
  attention.sort(
    (a, b) =>
      attentionRank[a.status] - attentionRank[b.status] ||
      (a.timestamp ?? 0) - (b.timestamp ?? 0) ||
      a.key.localeCompare(b.key),
  );
  return { active, attention, attentionCount };
}

export function previewActiveWork(groups: readonly ActiveGroup[]) {
  const roots = groups.slice(0, 3);
  let childSlots = 5 - roots.length;
  return roots.map((group) => {
    const children = group.children.slice(0, Math.min(2, childSlots));
    childSlots -= children.length;
    return { ...group, children };
  });
}

export function selectOverviewProgress(
  projection: ThreadStructure,
  thread: EnvironmentThreadShell,
) {
  const runId = thread.runtime?.activeRunId ?? thread.latestRun?.runId ?? null;
  if (thread.latestRun?.status === "queued" && thread.latestRun.runId === runId) return null;
  if (runId !== null) {
    const run = projection.runs.find((candidate) => candidate.id === runId);
    if (run === undefined || run.status === "rolled_back") return null;
  }

  // OMP publishes one mutable checklist per thread, not one artifact per run.
  const ompPlan = projection.plans.find((plan) => plan.id === `omp-todo:${thread.id}`);
  let steps =
    ompPlan?.kind === "todo_list" && ompPlan.status !== "superseded" ? ompPlan.steps : undefined;
  if (steps === undefined) {
    const root =
      runId === null
        ? projection.nodes.findLast((node) => node.kind === "root_turn" && node.runId === null)
        : undefined;
    if (runId === null && (root === undefined || root.status === "rolled_back")) return null;
    const todoOrdinals = new Map<string, number>();
    for (const item of projection.turnItems) {
      if (item.type === "todo_list") {
        todoOrdinals.set(item.planId, Math.max(item.ordinal, todoOrdinals.get(item.planId) ?? -1));
      }
    }

    let ordinal = -1;
    for (const plan of projection.plans) {
      if (
        plan.kind !== "todo_list" ||
        plan.runId !== runId ||
        plan.status === "superseded" ||
        plan.status === "draft" ||
        (root !== undefined &&
          plan.nodeId !== root.id &&
          !projection.nodes.some((node) => node.id === plan.nodeId && node.rootNodeId === root.id))
      ) {
        continue;
      }
      const planOrdinal = todoOrdinals.get(plan.id) ?? -1;
      if (planOrdinal < ordinal) continue;
      ordinal = planOrdinal;
      steps = plan.steps;
    }
  }

  if (steps === undefined) return null;
  let total = 0;
  let done = 0;
  for (const step of steps) {
    if (step.status === "pending" && step.text.split("\n", 2)[1] === "[abandoned]") continue;
    total += 1;
    if (step.status === "completed") done += 1;
  }
  return total === 0 ? null : { done, total };
}

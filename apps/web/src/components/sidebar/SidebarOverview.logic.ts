import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  resolveThreadWorkingStartedAt,
  type EnvironmentThreadShell,
  type ThreadStructure,
} from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  indexThreadsForAncestorLookup,
  resolveListedAncestorThreadRef,
} from "@t3tools/client-runtime/state/threads";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import {
  isListedThreadLineage,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
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
  | "unread"
  | "done"
  | "today";

type OverviewRow<S extends OverviewStatus = OverviewStatus> = {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly thread: EnvironmentThreadShell;
  readonly timestamp: number | null;
  readonly status: S;
};

type AttentionStatus = RequestStatus | "failed" | "unread";
type TodayStatus = "done" | "today";
type ActiveStatus = Exclude<OverviewStatus, "failed" | "unread" | TodayStatus>;

type ActiveGroup = {
  readonly root: OverviewRow<ActiveStatus>;
  readonly children: readonly OverviewRow<ActiveStatus>[];
  readonly childCount: number;
};

export const ATTENTION_PREVIEW_LIMIT = 5;
const TODAY_TASKS_ROLLOVER_HOUR = 4;

export function failedRunToken(thread: EnvironmentThreadShell): string | null {
  const run = thread.latestRun;
  if (run?.status !== "failed") return null;
  return run.runId || run.completedAt || thread.updatedAt;
}

/**
 * Start of the current logical day in local time, rolling over at `rolloverHour` (default 04:00).
 * Before 04:00 local time, the logical day starts at yesterday's 04:00.
 */
export function logicalDayStartMs(nowMs: number, rolloverHour = TODAY_TASKS_ROLLOVER_HOUR): number {
  const start = new Date(nowMs);
  if (start.getHours() < rolloverHour) {
    start.setDate(start.getDate() - 1);
  }
  start.setHours(rolloverHour, 0, 0, 0);
  return start.getTime();
}

function resolveTodayTaskTimestamp(thread: EnvironmentThreadShell): number | null {
  const candidates = [
    thread.settledAt,
    thread.latestRun?.completedAt ?? null,
    thread.latestRun?.startedAt ?? null,
    thread.updatedAt,
    thread.createdAt,
  ];
  let latest: number | null = null;
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const ms = Date.parse(candidate);
    if (!Number.isFinite(ms)) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

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

const attentionRank: Record<AttentionStatus, number> = {
  approval: 0,
  input: 0,
  failed: 1,
  unread: 2,
};

export function collectDisconnectedEnvironmentIds(
  isReady: boolean,
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly entry: { readonly enabled: boolean };
    readonly connection: { readonly phase: string };
  }>,
): ReadonlySet<EnvironmentId> | undefined {
  if (!isReady || environments.length === 0) return undefined;
  const disconnected = new Set<EnvironmentId>();
  for (const environment of environments) {
    if (environment.entry.enabled && environment.connection.phase !== "connected") {
      disconnected.add(environment.environmentId);
    }
  }
  return disconnected.size > 0 ? disconnected : undefined;
}

function isDelegatedUnderListedParent(
  thread: EnvironmentThreadShell,
  ref: ScopedThreadRef,
  key: string,
  liveThreads: readonly EnvironmentThreadShell[],
  ancestorIndex: ReadonlyMap<string, EnvironmentThreadShell>,
): boolean {
  return (
    thread.delegatedFrom !== null &&
    scopedThreadKey(resolveListedAncestorThreadRef(ref, liveThreads, ancestorIndex)) !== key
  );
}

export function buildSidebarOverview(
  threads: readonly EnvironmentThreadShell[],
  now: string,
  localVisits: Readonly<Record<string, string | undefined>>,
  acknowledgedErrors: Readonly<Record<string, string | undefined>> = {},
  disconnectedEnvironmentIds?: ReadonlySet<EnvironmentId>,
  options?: { readonly includeTodayRows?: boolean },
) {
  const liveThreads = threads.filter((thread) => thread.deletedAt === null);
  const ancestorIndex = indexThreadsForAncestorLookup(liveThreads);
  const byKey = new Map<string, EnvironmentThreadShell>();
  const running = new Map<string, OverviewRow<ActiveStatus>>();
  const attention: OverviewRow<AttentionStatus>[] = [];
  let attentionCount = 0;
  for (const thread of liveThreads) {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const key = scopedThreadKey(ref);
    byKey.set(key, thread);
    const isDisconnectedEnvironment =
      disconnectedEnvironmentIds?.has(thread.environmentId) === true;
    const request = isDisconnectedEnvironment
      ? null
      : thread.hasPendingApprovals
        ? "approval"
        : thread.hasPendingUserInput
          ? "input"
          : null;
    const waitsForBackground = backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);
    const status = isDisconnectedEnvironment
      ? null
      : activeStatus(thread, request, waitsForBackground);
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
      isDelegatedUnderListedParent(thread, ref, key, liveThreads, ancestorIndex) ||
      thread.pendingBackgroundTasks.some((task) => task.kind === "monitor")
    ) {
      continue;
    }
    const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisits[key]);
    const timestamp = Date.parse(run?.completedAt ?? thread.updatedAt);
    const errorToken = failedRunToken(thread);
    const errorAcknowledged = errorToken !== null && acknowledgedErrors[key] === errorToken;
    const failureUnsettled =
      thread.settledAt === null
        ? thread.settledOverride !== "settled"
        : run?.completedAt != null && timestamp > Date.parse(thread.settledAt);
    if (run?.status === "failed" && !errorAcknowledged && failureUnsettled) {
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
        : resolveListedAncestorThreadRef(row.ref, liveThreads, ancestorIndex);
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

  const activeKeys = new Set<string>();
  for (const group of active) {
    activeKeys.add(group.root.key);
    for (const child of group.children) activeKeys.add(child.key);
  }
  const shownTopKeys = new Set<string>(activeKeys);
  for (const row of attention) shownTopKeys.add(row.key);

  const nowMs = Date.parse(now);
  const todayStartMs = Number.isFinite(nowMs) ? logicalDayStartMs(nowMs) : null;
  const includeTodayRows = options?.includeTodayRows !== false;
  const todayTasks: OverviewRow<TodayStatus>[] = [];
  let todayTasksCount = 0;
  if (todayStartMs !== null) {
    for (const thread of liveThreads) {
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      const key = scopedThreadKey(ref);
      if (
        thread.archivedAt !== null ||
        !isListedThreadLineage(thread.lineage) ||
        isDelegatedUnderListedParent(thread, ref, key, liveThreads, ancestorIndex) ||
        effectiveSnoozed(thread, { now })
      ) {
        continue;
      }
      if (shownTopKeys.has(key)) continue;
      const timestamp = resolveTodayTaskTimestamp(thread);
      if (timestamp === null || timestamp < todayStartMs) continue;
      todayTasksCount += 1;
      if (includeTodayRows) {
        const status: TodayStatus =
          thread.settledOverride === "settled" || thread.settledAt !== null ? "done" : "today";
        todayTasks.push({ key, ref, thread, status, timestamp });
      }
    }
    if (includeTodayRows) {
      todayTasks.sort(
        (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.key.localeCompare(b.key),
      );
    }
  }

  return { active, activeKeys, attention, attentionCount, todayTasks, todayTasksCount };
}

export function collectActiveOverviewKeys(
  threads: readonly EnvironmentThreadShell[],
  disconnectedEnvironmentIds?: ReadonlySet<EnvironmentId>,
): ReadonlySet<string> {
  const liveThreads = threads.filter((thread) => thread.deletedAt === null);
  let ancestorIndex: ReadonlyMap<string, EnvironmentThreadShell> | undefined;
  const keys = new Set<string>();
  for (const thread of liveThreads) {
    if (disconnectedEnvironmentIds?.has(thread.environmentId) === true) continue;
    const request = thread.hasPendingApprovals
      ? "approval"
      : thread.hasPendingUserInput
        ? "input"
        : null;
    const waitsForBackground = backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);
    if (activeStatus(thread, request, waitsForBackground) === null) continue;
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    keys.add(scopedThreadKey(ref));
    if (thread.lineage.parentThreadId !== null || thread.delegatedFrom !== null) {
      ancestorIndex ??= indexThreadsForAncestorLookup(liveThreads);
      keys.add(scopedThreadKey(resolveListedAncestorThreadRef(ref, liveThreads, ancestorIndex)));
    }
  }
  return keys;
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

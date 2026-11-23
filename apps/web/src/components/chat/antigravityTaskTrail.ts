import type { ThreadStructure, ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2PlanStep, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { useGT } from "gt-react";

export type TrailTool = "read" | "write" | "command" | "image" | "search" | "delegate";
export interface TrailActivity {
  id: string;
  kind: TrailTool;
  label: string;
  purpose?: string;
  path?: string;
  command?: string;
  status?: "completed" | "running" | "failed" | "stopped" | "waiting" | "no_matches";
}

export interface AntigravityTaskTrail {
  key: string;
  steps: readonly OrchestrationV2PlanStep[];
  activities: Record<string, TrailActivity[]>;
  planId?: string;
  liveIntent?: string;
  blockedStepId?: string;
  waiting: boolean;
  failed: boolean;
  complete: boolean;
  durationMs?: number;
}

function normalizeTodoStep(step: OrchestrationV2PlanStep): {
  readonly step: OrchestrationV2PlanStep;
  readonly blocked: boolean;
} | null {
  const [title = step.text, note] = step.text.split("\n");
  if (step.status === "pending" && note === "[abandoned]") return null;
  const blocked = step.status === "pending" && /^\[blocked\](?: |$)/.test(note ?? "");
  return {
    step: title === step.text ? step : { ...step, text: title },
    blocked,
  };
}

function activeSnapshotStepId(steps: readonly OrchestrationV2PlanStep[]): string | undefined {
  const normalized = steps.flatMap((step) => {
    const entry = normalizeTodoStep(step);
    return entry ? [entry.step] : [];
  });
  return (
    normalized.find((step) => step.status === "running")?.id ??
    normalized.find((step) => step.status === "pending")?.id ??
    normalized.at(-1)?.id
  );
}

function trailActivity(
  item: ThreadStructureTurnItem,
  gt: ReturnType<typeof useGT>,
): TrailActivity | undefined {
  const status: TrailActivity["status"] =
    item.status === "cancelled" || item.status === "interrupted"
      ? "stopped"
      : item.status === "idle" || item.status === "pending"
        ? undefined
        : item.status;
  const purpose = item.toolPurpose?.trim() || undefined;
  const base = {
    id: item.id,
    ...(status === undefined ? {} : { status }),
    ...(purpose === undefined ? {} : { purpose }),
  };
  switch (item.type) {
    case "command_execution":
      return {
        ...base,
        kind: "command",
        label: purpose ?? item.title ?? item.input,
        command: item.input,
      };
    case "file_change":
      return { ...base, kind: "write", label: purpose ?? gt("Write."), path: item.fileName };
    case "file_search":
      return {
        ...base,
        kind: "search",
        label: purpose ?? item.pattern ?? item.title ?? gt("Search"),
      };
    case "web_search":
      return {
        ...base,
        kind: "search",
        label: purpose ?? (item.patterns?.join(" · ") || item.title || gt("Search")),
      };
    case "subagent":
      return { ...base, kind: "delegate", label: purpose ?? item.title ?? item.driver };
    case "dynamic_tool": {
      const name = (item.toolName ?? "").toLowerCase();
      const kind = /search|grep|find_by_name|\bfind\b|ast_grep|fetch/.test(name)
        ? "search"
        : /read|view_file|list_dir|\bls\b/.test(name)
          ? "read"
          : /write|edit|replace|ast_edit|notebook/.test(name)
            ? "write"
            : /imagegen|generate_image/.test(name)
              ? "image"
              : /subagent|delegate|\btask\b/.test(name)
                ? "delegate"
                : "command";
      const input = item.input;
      const path =
        typeof input === "object" && input !== null
          ? "path" in input && typeof input.path === "string"
            ? input.path
            : "file_path" in input && typeof input.file_path === "string"
              ? input.file_path
              : "Path" in input && typeof input.Path === "string"
                ? input.Path
                : undefined
          : undefined;
      const label = purpose ?? item.title ?? item.toolName;
      return label ? { ...base, kind, label, ...(path === undefined ? {} : { path }) } : undefined;
    }
    default:
      return undefined;
  }
}

export function antigravityTaskTrail(
  projection: ThreadStructure,
  runId: RunId | null,
  gt: ReturnType<typeof useGT>,
): AntigravityTaskTrail | null {
  const run = projection.runs.find((candidate) => candidate.id === runId);
  if (!run || run.status === "rolled_back") return null;
  const items = projection.turnItems
    .filter((item) => item.runId === run.id && item.parentItemId === null)
    .toSorted((a, b) => a.ordinal - b.ordinal);
  const planMirror = items.findLast((item) => item.type === "todo_list");
  const ompPlanId = `omp-todo:${projection.thread.id}`;
  const plan =
    projection.plans.findLast(
      (entry) =>
        entry.threadId === projection.thread.id &&
        entry.runId === run.id &&
        entry.kind === "todo_list" &&
        (!entry.id.startsWith("omp-todo:") || entry.id === ompPlanId) &&
        (planMirror === undefined || entry.id === planMirror.planId),
    ) ??
    projection.plans.findLast(
      (entry) =>
        entry.threadId === projection.thread.id &&
        entry.id === ompPlanId &&
        entry.kind === "todo_list" &&
        entry.status !== "superseded",
    );
  const active =
    run.status === "running" ||
    run.status === "waiting" ||
    run.status === "starting" ||
    run.status === "preparing";
  const waiting = items.some(
    (item) =>
      (item.type === "approval_request" ||
        item.type === "user_input_request" ||
        item.type === "secret_request") &&
      (item.status === "waiting" || item.status === "running" || item.status === "pending"),
  );
  const failed = run.status === "failed";
  const durationMs =
    run.startedAt && run.completedAt
      ? DateTime.toEpochMillis(run.completedAt) - DateTime.toEpochMillis(run.startedAt)
      : undefined;
  const liveIntentItem =
    items.findLast(
      (item) =>
        item.type !== "todo_list" &&
        item.toolPurpose?.trim() &&
        (item.status === "running" || item.status === "waiting"),
    ) ??
    (active
      ? items.findLast((item) => item.type !== "todo_list" && item.toolPurpose?.trim())
      : undefined);
  const liveIntent = liveIntentItem?.toolPurpose?.trim() || undefined;
  const common = {
    waiting,
    failed,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(liveIntent === undefined ? {} : { liveIntent }),
  };
  const activities: Record<string, TrailActivity[]> = {};
  if (plan?.kind === "todo_list" && plan.status !== "superseded" && plan.steps.length > 0) {
    const normalizedEntries = plan.steps.flatMap((step) => {
      const entry = normalizeTodoStep(step);
      return entry ? [entry] : [];
    });
    if (normalizedEntries.length > 0) {
      const normalizedSteps = normalizedEntries.map((entry) => entry.step);
      const blockedStepId = normalizedEntries.find((entry) => entry.blocked)?.step.id;
      const validStepIds = new Set(normalizedSteps.map((step) => step.id));
      // Assign calls to the step active at their start, not the most recent step at render time.
      const anchors = normalizedSteps
        .flatMap((step) =>
          step.durationAnchorAt ? [{ step, start: Date.parse(step.durationAnchorAt) }] : [],
        )
        .sort((a, b) => a.start - b.start);
      if (anchors.length > 0) {
        for (const item of items) {
          if (item.startedAt === null) continue;
          const start = DateTime.toEpochMillis(item.startedAt);
          const owner = anchors.findLast((anchor) => anchor.start <= start)?.step;
          if (!owner) continue;
          const operation = trailActivity(item, gt);
          if (operation) (activities[owner.id] ??= []).push(operation);
        }
      } else {
        // OMP todo snapshots omit durationAnchorAt; fold tool calls into the step active in the latest snapshot.
        const firstSnapshot = items.find((item) => item.type === "todo_list");
        const fallbackStepId =
          (firstSnapshot && firstSnapshot.type === "todo_list"
            ? activeSnapshotStepId(firstSnapshot.steps)
            : undefined) ??
          normalizedSteps.find((step) => step.status === "running")?.id ??
          normalizedSteps.find((step) => step.status === "pending")?.id ??
          normalizedSteps.at(-1)?.id;
        let currentStepId = fallbackStepId;
        for (const item of items) {
          if (item.type === "todo_list") {
            const nextStepId = activeSnapshotStepId(item.steps);
            if (nextStepId !== undefined) currentStepId = nextStepId;
            continue;
          }
          const operation = trailActivity(item, gt);
          if (!operation) continue;
          const ownerId =
            currentStepId !== undefined && validStepIds.has(currentStepId)
              ? currentStepId
              : fallbackStepId !== undefined && validStepIds.has(fallbackStepId)
                ? fallbackStepId
                : normalizedSteps.at(-1)?.id;
          if (ownerId !== undefined) (activities[ownerId] ??= []).push(operation);
        }
      }
      const planComplete =
        plan.status === "completed" &&
        !waiting &&
        blockedStepId === undefined &&
        normalizedSteps.every((step) => step.status === "completed");
      return {
        ...common,
        waiting: waiting || blockedStepId !== undefined,
        ...(blockedStepId === undefined ? {} : { blockedStepId }),
        key: plan.id,
        planId: plan.id,
        steps: normalizedSteps,
        activities,
        complete: planComplete,
      } satisfies AntigravityTaskTrail;
    }
  }

  // Group consecutive calls by explicit intent (OMP `toolPurpose`) or execution phase.
  const groups: { key: string; phase: string; purpose?: string; calls: TrailActivity[] }[] = [];
  for (const item of items) {
    const operation = trailActivity(item, gt);
    if (!operation) continue;
    const phase =
      operation.kind === "read" ||
      operation.kind === "search" ||
      (operation.command !== undefined &&
        /^(?:rg|grep|git grep|fd|find|ls|cat|head|tail|sed)\b/.test(operation.command))
        ? "explore"
        : operation.kind === "write" || operation.kind === "image"
          ? "edit"
          : operation.kind === "delegate"
            ? "delegate"
            : "verify";
    const groupKey = operation.purpose ? `purpose:${operation.purpose}` : `phase:${phase}`;
    const previous = groups.at(-1);
    if (previous?.key === groupKey) previous.calls.push(operation);
    else {
      groups.push({
        key: groupKey,
        phase,
        ...(operation.purpose === undefined ? {} : { purpose: operation.purpose }),
        calls: [operation],
      });
    }
  }
  if (
    groups.length === 0 ||
    (!active && !failed && groups.reduce((count, group) => count + group.calls.length, 0) < 2)
  )
    return null;
  const steps = groups.slice(-6).map(({ phase, purpose, calls }, index, visible) => {
    const latest = calls.at(-1)!;
    const id = calls[0]!.id;
    activities[id] = calls;
    const text =
      purpose ??
      (calls.length > 1 && phase === "explore"
        ? gt("Inspect & search workspace ({count})", { count: calls.length })
        : (latest.path ?? latest.label));
    const status =
      calls.some((call) => call.status === "running" || call.status === "waiting") ||
      (active && index === visible.length - 1)
        ? "running"
        : "completed";
    return { id, text, status } satisfies OrchestrationV2PlanStep;
  });
  return {
    ...common,
    key: run.id,
    steps,
    activities,
    complete: run.status === "completed" && steps.every((step) => step.status === "completed"),
  } satisfies AntigravityTaskTrail;
}

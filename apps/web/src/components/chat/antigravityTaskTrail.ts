import type { ThreadStructure, ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2PlanStep, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { useGT } from "gt-react";

export type TrailTool = "read" | "write" | "command" | "image" | "search" | "delegate";
export interface TrailActivity {
  id: string;
  kind: TrailTool;
  label: string;
  path?: string;
  command?: string;
  status?: "completed" | "running" | "failed" | "stopped" | "waiting" | "no_matches";
}

export interface AntigravityTaskTrail {
  key: string;
  steps: readonly OrchestrationV2PlanStep[];
  activities: Record<string, TrailActivity[]>;
  planId?: string;
  waiting: boolean;
  failed: boolean;
  complete: boolean;
  durationMs?: number;
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
  const base = { id: item.id, ...(status === undefined ? {} : { status }) };
  switch (item.type) {
    case "command_execution":
      return { ...base, kind: "command", label: item.title ?? item.input, command: item.input };
    case "file_change":
      return { ...base, kind: "write", label: gt("Write."), path: item.fileName };
    case "file_search":
      return { ...base, kind: "search", label: item.pattern ?? item.title ?? gt("Search") };
    case "web_search":
      return {
        ...base,
        kind: "search",
        label: item.patterns?.join(" · ") || item.title || gt("Search"),
      };
    case "subagent":
      return { ...base, kind: "delegate", label: item.title ?? item.driver };
    case "dynamic_tool": {
      const name = (item.toolName ?? "").toLowerCase();
      const kind = /search|grep|find_by_name/.test(name)
        ? "search"
        : /read|view_file|list_dir/.test(name)
          ? "read"
          : /write|edit|replace/.test(name)
            ? "write"
            : /imagegen|generate_image/.test(name)
              ? "image"
              : /subagent|delegate/.test(name)
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
      const label = item.title ?? item.toolName;
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
  const plan = projection.plans.findLast(
    (entry) =>
      entry.threadId === projection.thread.id &&
      entry.runId === run.id &&
      entry.kind === "todo_list" &&
      (planMirror === undefined || entry.id === planMirror.planId),
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
  const common = { waiting, failed, ...(durationMs === undefined ? {} : { durationMs }) };
  const activities: Record<string, TrailActivity[]> = {};
  if (plan?.kind === "todo_list" && plan.status !== "superseded" && plan.steps.length > 0) {
    // Assign calls to the step active at their start, not the most recent step at render time.
    const anchors = plan.steps
      .flatMap((step) =>
        step.durationAnchorAt ? [{ step, start: Date.parse(step.durationAnchorAt) }] : [],
      )
      .sort((a, b) => a.start - b.start);
    for (const item of items) {
      if (item.startedAt === null) continue;
      const start = DateTime.toEpochMillis(item.startedAt);
      const owner = anchors.findLast((anchor) => anchor.start <= start)?.step;
      if (!owner) continue;
      const operation = trailActivity(item, gt);
      if (operation) (activities[owner.id] ??= []).push(operation);
    }
    return {
      ...common,
      key: plan.id,
      planId: plan.id,
      steps: plan.steps,
      activities,
      complete: plan.status === "completed" && !waiting,
    } satisfies AntigravityTaskTrail;
  }

  // Stardust groups consecutive calls by phase, and does not present them as a reported plan.
  const groups: { phase: string; calls: TrailActivity[] }[] = [];
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
    const previous = groups.at(-1);
    if (previous?.phase === phase) previous.calls.push(operation);
    else groups.push({ phase, calls: [operation] });
  }
  if (
    groups.length === 0 ||
    (!active && !failed && groups.reduce((count, group) => count + group.calls.length, 0) < 2)
  )
    return null;
  const steps = groups.slice(-6).map(({ phase, calls }, index, visible) => {
    const latest = calls.at(-1)!;
    const id = calls[0]!.id;
    activities[id] = calls;
    const text =
      calls.length > 1 && phase === "explore"
        ? gt("Inspect & search workspace ({count})", { count: calls.length })
        : (latest.path ?? latest.label);
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

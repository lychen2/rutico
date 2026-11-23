import { useId, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { msg, useGT, useMessages } from "gt-react";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { trailFailureKind } from "./taskTrailFailures";
import type { Milestone } from "./taskMilestones";
import type { TrailActivity, TrailTool } from "./antigravityTaskTrail";
import styles from "./taskPlanCapsule.module.css";

type UiText = ReturnType<typeof useGT>;

export interface GroupedOperationBucket {
  readonly kind: TrailTool;
  readonly items: readonly TrailActivity[];
}

const TOOL_KIND_LABELS: Record<TrailTool, string> = {
  search: msg("Search"),
  read: msg("Read"),
  write: msg("Write."),
  command: msg("Command"),
  image: msg("Image"),
  delegate: msg("Delegate"),
};

/** Merge operations of the same tool kind in first-seen order for V9 compact tool chips (e.g. 搜索 ×4). */
function groupStageOperations(
  operations: readonly TrailActivity[],
): readonly GroupedOperationBucket[] {
  const buckets: Array<{ kind: TrailTool; items: TrailActivity[] }> = [];
  const byKind = new Map<TrailTool, { kind: TrailTool; items: TrailActivity[] }>();
  for (const operation of operations) {
    const existing = byKind.get(operation.kind);
    if (existing) {
      existing.items.push(operation);
    } else {
      const bucket = { kind: operation.kind, items: [operation] };
      byKind.set(operation.kind, bucket);
      buckets.push(bucket);
    }
  }
  return buckets;
}

/** "Completed · 4 stages · Took 6m 00s", shared by the finished capsule and its history row. */
export function completedTitle(count: number, durationMs: number | undefined, gt: UiText) {
  return [
    gt("{count, plural, one {Completed · {count} stage} other {Completed · {count} stages}}", {
      count,
    }),
    ...(durationMs === undefined
      ? []
      : [gt("Took {duration}", { duration: formatDuration(durationMs) })]),
  ].join(" · ");
}

function operationSummary(milestone: Milestone, gt: UiText): string {
  const count = milestone.operations.length;
  if (count === 0) return "";
  return [
    gt("{count, plural, one {{count} operation} other {{count} operations}}", { count }),
    ...(milestone.retries > 0
      ? [
          gt("{count, plural, one {{count} retry} other {{count} retries}}", {
            count: milestone.retries,
          }),
        ]
      : []),
  ].join(" · ");
}

function stageSummary(milestone: Milestone, gt: UiText) {
  const operations = operationSummary(milestone, gt);
  switch (milestone.status) {
    case "need":
      return { text: gt("Needs confirmation"), tone: "need" };
    case "problem":
      return { text: [gt("Problem"), operations].filter(Boolean).join(" · "), tone: "problem" };
    case "run":
      return { text: [gt("In progress"), operations].filter(Boolean).join(" · "), tone: "run" };
    case "done":
      return { text: operations || gt("Completed"), tone: "done" };
    default:
      return { text: gt("Not started"), tone: "todo" };
  }
}

function StageMark({ status }: { status: Milestone["status"] }) {
  return (
    <span className={styles["plan-stage-mark"]} data-status={status} aria-hidden>
      {status === "done" ? (
        <svg viewBox="0 0 16 16">
          <path d="M3.6 8.4l3 3 5.8-6.2" />
        </svg>
      ) : null}
    </span>
  );
}

function GroupedToolChips({
  groups,
  onOpenFile,
}: {
  readonly groups: readonly GroupedOperationBucket[];
  readonly onOpenFile?: ((path: string) => void) | undefined;
}) {
  const resolve = useMessages();
  return (
    <div className={styles["plan-step-sub"]}>
      {groups.map((group) => {
        const kindLabel = resolve(TOOL_KIND_LABELS[group.kind]);
        const tag = group.items.length > 1 ? `${kindLabel} ×${group.items.length}` : kindLabel;
        const separator = group.kind === "search" ? " / " : " · ";
        return (
          <div className={styles["plan-tool-chip"]} key={group.kind} data-tool-kind={group.kind}>
            <span className={styles["plan-tool-tag"]}>{tag}</span>
            <span className={styles["plan-tool-items"]}>
              {group.items.map((activity, idx) => {
                const failure = trailFailureKind(activity);
                const display = activity.path
                  ? activity.path.split(/[\\/]/).at(-1) || activity.path
                  : (activity.command ?? activity.label);
                return (
                  <span
                    key={activity.id}
                    className={`${styles["task-command-row"]} ${styles["plan-tool-item"]}`}
                    data-status={activity.status}
                    data-failure={failure ?? undefined}
                    data-activity-id={activity.id}
                  >
                    {idx > 0 ? (
                      <span className={styles["plan-tool-sep"]} aria-hidden>
                        {separator}
                      </span>
                    ) : null}
                    {activity.path && onOpenFile ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<button type="button" />}
                          className={styles["plan-tool-file"]}
                          onClick={() => onOpenFile?.(activity.path!)}
                        >
                          {display}
                        </TooltipTrigger>
                        <TooltipPopup>{activity.path}</TooltipPopup>
                      </Tooltip>
                    ) : (
                      <span>{display}</span>
                    )}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The milestone list. Operations stay out of sight: a stage shows one summary line, and a click
 * opens its grouped tool chips, which mount on first open and then stays so closing can animate.
 */
export function TaskPlanStages({
  milestones,
  currentIndex,
  openId,
  onToggle,
  onOpenFile,
  label,
  liveFallback = false,
}: {
  readonly milestones: readonly Milestone[];
  readonly currentIndex: number;
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly label: string;
  readonly liveFallback?: boolean;
}) {
  const gt = useGT();
  const idPrefix = useId();
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  if (openId !== null && !mounted.has(openId)) setMounted(new Set(mounted).add(openId));
  return (
    <ol className={styles["plan-stages"]} aria-label={label}>
      {milestones.map((milestone, index) => {
        const summary = stageSummary(milestone, gt);
        const groups = groupStageOperations(milestone.operations);
        const hasDetail = milestone.operations.length > 0;
        const open = openId === milestone.id;
        const detailId = `${idPrefix}-${index}`;
        const badgeText = liveFallback
          ? milestone.status === "run"
            ? gt("In progress")
            : milestone.operations.length > 1
              ? gt("{count} calls folded", { count: milestone.operations.length })
              : milestone.operations.length === 1
                ? gt("{count} item", { count: 1 })
                : gt("Completed")
          : groups.length > 0
            ? `${gt("{count, plural, one {{count} item} other {{count} items}}", { count: groups.length })} ${open ? "▴" : "▾"}`
            : milestone.status === "need"
              ? gt("Needs confirmation")
              : milestone.status === "problem"
                ? gt("Problem")
                : milestone.status === "run"
                  ? gt("In progress")
                  : milestone.status === "todo"
                    ? gt("Not started")
                    : gt("Completed");
        const content = (
          <>
            <StageMark status={milestone.status} />
            <span className={styles["plan-stage-name"]}>{milestone.name}</span>
            <span className={styles["plan-stage-summary"]} data-tone={summary.tone}>
              {summary.text}
            </span>
            <span className={styles["plan-stage-badge"]} data-tone={milestone.status}>
              {badgeText}
            </span>
            {hasDetail ? (
              <ChevronRightIcon className={styles["plan-stage-chevron"]} aria-hidden />
            ) : null}
          </>
        );
        return (
          <li
            key={milestone.id}
            className={styles["plan-stage"]}
            data-status={milestone.status}
            data-open={open}
            data-current={index === currentIndex}
            data-stage-id={milestone.id}
          >
            {hasDetail ? (
              <button
                type="button"
                className={styles["plan-stage-row"]}
                aria-expanded={open}
                aria-controls={detailId}
                aria-current={index === currentIndex ? "step" : undefined}
                onClick={() => onToggle(milestone.id)}
              >
                {content}
              </button>
            ) : (
              <div
                className={styles["plan-stage-row"]}
                aria-current={index === currentIndex ? "step" : undefined}
              >
                {content}
              </div>
            )}
            {hasDetail ? (
              <div id={detailId} className={styles["plan-detail"]} inert={!open}>
                <div className={styles["plan-detail-clip"]}>
                  {mounted.has(milestone.id) ? (
                    <div className={styles["plan-detail-body"]}>
                      {groups.length > 0 ? (
                        <div
                          className={styles["plan-operations"]}
                          data-stage-operations={milestone.id}
                        >
                          <GroupedToolChips groups={groups} onOpenFile={onOpenFile} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

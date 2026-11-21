import { toServerClock } from "@t3tools/client-runtime/clock";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { THREAD_STATUS_TEXT } from "@t3tools/client-runtime/state/thread-activity-announcement";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useAllEnvironmentShellsBootstrapped, useQuietThreadProjection } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { formatRelativeElapsed } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import type { SidebarProviderEntry } from "./SidebarThreadRow";
import {
  ATTENTION_PREVIEW_LIMIT,
  buildSidebarOverview,
  previewActiveWork,
  selectOverviewProgress,
  type OverviewStatus,
} from "./SidebarOverview.logic";

const statusMessages = {
  approval: THREAD_STATUS_TEXT.approval,
  input: THREAD_STATUS_TEXT.input,
  starting: msg("Starting"),
  queued: msg("Queued"),
  working: THREAD_STATUS_TEXT.working,
  waiting: msg("Waiting"),
  background: msg("Waiting on a background task"),
  failed: THREAD_STATUS_TEXT.failed,
  unread: msg("New result"),
};

type Overview = ReturnType<typeof buildSidebarOverview>;
type OverviewRow = Overview["active"][number]["root"] | Overview["attention"][number];

function OverviewProgress({ row }: { row: OverviewRow }) {
  const gt = useGT();
  const projection = useQuietThreadProjection(row.ref)?.projection;
  const progress = projection === undefined ? null : selectOverviewProgress(projection, row.thread);
  if (progress === null) return null;
  return (
    <>
      <span aria-hidden className="h-0.75 w-8 shrink-0 overflow-hidden rounded-full bg-sidebar-border">
        <span
          className="block h-full origin-left rounded-full bg-current rtl:origin-right"
          style={{ transform: `scaleX(${progress.done / progress.total})` }}
        />
      </span>
      <span className="shrink-0 tabular-nums">{gt("Tasks {done}/{total}", progress)}</span>
      <span aria-hidden>·</span>
    </>
  );
}

function OverviewThreadButton({
  row,
  title,
  statusLabel,
  context,
  active,
  showProgress,
  onOpen,
}: {
  row: OverviewRow;
  title: string;
  statusLabel: string;
  context: string | null;
  active: boolean;
  showProgress: boolean;
  onOpen: () => void;
}) {
  const messages = useMessages();
  const minute = useNowMinute();
  const timestamp = row.timestamp;
  const time =
    timestamp === null || !Number.isFinite(timestamp)
      ? null
      : formatRelativeElapsed(
          Math.max(0, toServerClock(row.ref.environmentId, Date.parse(`${minute}:00Z`)) - timestamp),
          messages,
        );
  const indicator: Record<OverviewStatus, string> = {
    approval: "bg-amber-500 dark:bg-amber-300/90",
    input: "bg-amber-500 dark:bg-amber-300/90",
    starting: "bg-primary",
    queued: "bg-primary",
    working: "bg-primary",
    waiting: "bg-primary",
    background: "bg-primary",
    children: "bg-primary",
    failed: "bg-destructive",
    unread: "bg-sidebar-muted-foreground/65",
  };
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={context === null ? title : `${title} · ${context}`}
      onClick={onOpen}
      className="block min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1.5 text-start text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-sidebar-row-active"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", indicator[row.status])} />
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
        {time === null ? null : (
          <span className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums">
            <span className="sr-only">{time.label}</span>
            <span aria-hidden>{time.value}</span>
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 ps-3.5 text-2xs text-sidebar-muted-foreground">
        {showProgress && row.status !== "children" ? <OverviewProgress row={row} /> : null}
        <span className="truncate">
          {statusLabel}
          {context === null ? null : ` · ${context}`}
        </span>
      </span>
    </button>
  );
}

export function SidebarOverview({
  threads,
  activeKey,
  now,
  providers,
  projectNames,
  onNavigate,
}: {
  threads: readonly EnvironmentThreadShell[];
  activeKey: string | null;
  now: string;
  providers: ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>;
  projectNames: ReadonlyMap<string, string>;
  onNavigate: (ref: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { environments, isReady } = useEnvironments();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const incomplete =
    !isReady ||
    !bootstrapped ||
    environments.length === 0 ||
    environments.some(
      (environment) => environment.entry.enabled && environment.connection.phase !== "connected",
    );
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const { active, attention, attentionCount } = buildSidebarOverview(threads, now, localVisits);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [showAllRunning, setShowAllRunning] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const preview = previewActiveWork(active);
  const childCount = active.reduce((sum, group) => sum + group.childCount, 0);
  const hiddenActive =
    active.length > preview.length || preview.some((group) => group.children.length < group.childCount);
  const activeLabel = gt("Running now");
  const attentionLabel = gt("Needs my attention");
  const shownAttention = showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW_LIMIT);
  const headingClass =
    "flex min-w-0 items-center gap-2 px-2 pt-2 pb-1 text-2xs text-sidebar-muted-foreground";

  const renderRow = (row: OverviewRow, mode: "preview" | "all" | "attention", count = 0) => {
    const thread = row.thread;
    const title = thread.title || gt("Untitled thread");
    const statusLabel =
      row.status === "children"
        ? gt("{count, plural, =1 {Waiting on a subagent} other {Waiting on {count} subagents}}", {
            count,
          })
        : messages(statusMessages[row.status]);
    const providerId = thread.runtime?.providerInstanceId ?? thread.providerInstanceId;
    const provider = providers.get(thread.environmentId)?.get(providerId)?.displayName;
    const project = projectNames.get(`${thread.environmentId}:${thread.projectId}`);
    const context = mode === "attention" ? (project ?? provider) : (provider ?? project);
    return (
      <OverviewThreadButton
        row={row}
        title={title}
        statusLabel={statusLabel}
        context={context ?? null}
        active={activeKey === row.key}
        showProgress={mode === "attention" || activeKey === row.key}
        onOpen={() => {
          if (mode === "all") setShowAllRunning(false);
          onNavigate(row.ref);
        }}
      />
    );
  };
  const renderActive = (groups: Overview["active"], all: boolean) => (
    <ul aria-label={activeLabel} className="space-y-px">
      {groups.map(({ root, children, childCount: count }) => {
        const expanded = all || !collapsedGroups.has(root.key);
        const title = root.thread.title || gt("Untitled thread");
        return (
          <li key={root.key}>
            <div className="flex min-w-0 items-center">
              {children.length > 0 && !all ? (
                <button
                  type="button"
                  aria-label={gt("Subtasks of {thread}", { thread: title })}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsedGroups((previous) => {
                      const next = new Set(previous);
                      if (next.has(root.key)) next.delete(root.key);
                      else next.add(root.key);
                      return next;
                    })
                  }
                  className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {expanded ? (
                    <ChevronDownIcon aria-hidden className="size-3" />
                  ) : (
                    <ChevronRightIcon aria-hidden className="size-3 rtl:rotate-180" />
                  )}
                </button>
              ) : null}
              {renderRow(root, all ? "all" : "preview", count)}
            </div>
            {expanded && children.length > 0 ? (
              <ul className="ms-3 space-y-px border-s border-sidebar-border ps-1">
                {children.map((child) => (
                  <li key={child.key} className="flex min-w-0">
                    {renderRow(child, all ? "all" : "preview")}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="mb-2 space-y-1.5 border-b border-sidebar-border pb-2" data-thread-selection-safe>
      <section aria-label={activeLabel}>
        <h2 className={headingClass}>
          <span>{activeLabel}</span>
          {active.length === 0 && !incomplete ? (
            <span className="truncate">
              <span aria-hidden>· </span>
              {gt("No running tasks")}
            </span>
          ) : null}
          {childCount > 0 ? (
            <span className="truncate">
              {gt(
                "{count, plural, one {Includes {count} subtask} other {Includes {count} subtasks}}",
                { count: childCount },
              )}
            </span>
          ) : null}
          <span className="ms-auto shrink-0 tabular-nums">{active.length}</span>
        </h2>
        {incomplete ? (
          <p role="status" className="px-2 text-2xs text-sidebar-muted-foreground">
            {gt("Some connections are still syncing. Status may be out of date.")}
          </p>
        ) : null}
        {active.length > 0 ? renderActive(preview, false) : null}
        {hiddenActive ? (
          <Popover open={showAllRunning} onOpenChange={setShowAllRunning}>
            <PopoverTrigger render={<Button variant="ghost" size="compact" />}>
              {gt(
                "{count, plural, one {Show all {count} running task} other {Show all {count} running tasks}}",
                { count: active.length + childCount },
              )}
            </PopoverTrigger>
            <PopoverPopup side="right" align="start" width="lg" padding="compact">
              <PopoverTitle>{activeLabel}</PopoverTitle>
              <div className="mt-2 max-h-[min(65vh,40rem)] overflow-y-auto">
                {showAllRunning ? renderActive(active, true) : null}
              </div>
            </PopoverPopup>
          </Popover>
        ) : null}
      </section>
      {attention.length > 0 ? (
        <section aria-label={attentionLabel}>
          <h2 className={headingClass}>
            <span>{attentionLabel}</span>
            <span
              className={cn(
                "ms-auto rounded-full px-1.5 font-medium tabular-nums",
                attentionCount > 0 && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              )}
            >
              {attentionCount}
            </span>
          </h2>
          <ul aria-label={attentionLabel} className="space-y-px">
            {shownAttention.map((row) => (
              <li key={row.key} className="flex min-w-0">
                {renderRow(row, "attention")}
              </li>
            ))}
          </ul>
          {attention.length > ATTENTION_PREVIEW_LIMIT ? (
            <Button
              variant="ghost"
              size="compact"
              aria-expanded={showAllAttention}
              onClick={() => setShowAllAttention(!showAllAttention)}
            >
              {showAllAttention
                ? gt("Collapse")
                : gt("{count, plural, one {Show {count} more} other {Show {count} more}}", {
                    count: attention.length - ATTENTION_PREVIEW_LIMIT,
                  })}
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

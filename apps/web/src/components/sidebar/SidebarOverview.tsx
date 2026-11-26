import { toServerClock } from "@t3tools/client-runtime/clock";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { THREAD_STATUS_TEXT } from "@t3tools/client-runtime/state/thread-activity-announcement";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuSource,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { msg, useGT, useMessages } from "gt-react";
import {
  AlarmClockIcon,
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  EyeOffIcon,
  MailIcon,
  SquareIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { cn } from "~/lib/utils";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { useNowMinute } from "../../hooks/useNowMinute";
import {
  useAllEnvironmentShellsBootstrapped,
  useQuietThreadProjection,
} from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { threadTriagePermitted } from "../../state/use-orchestration-command";
import { formatRelativeElapsed } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import {
  createSidebarListMotion,
  SIDEBAR_REDUCED_MOTION,
  sidebarWorkbenchEase,
} from "../Sidebar.motion";
import { pickSnoozePreset, resolveSnoozePresets, type SnoozePreset } from "../Sidebar.snooze";
import { AnimatedNumber } from "../ui/animated-number";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SidebarProviderEntry } from "./SidebarThreadRow";
import {
  ATTENTION_PREVIEW_LIMIT,
  buildSidebarOverview,
  collectDisconnectedEnvironmentIds,
  failedRunToken,
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
  done: msg("Settled"),
  today: msg("Active today"),
};

type Overview = ReturnType<typeof buildSidebarOverview>;
type OverviewRow =
  | Overview["active"][number]["root"]
  | Overview["attention"][number]
  | Overview["todayTasks"][number];
type OverviewRowMode = "running" | "attention" | "today";

export interface SidebarOverviewActions {
  readonly onStop?: (ref: ScopedThreadRef) => void;
  readonly onMarkRead?: (ref: ScopedThreadRef) => void;
  readonly onSettle?: (ref: ScopedThreadRef) => void;
  readonly onUnsettle?: (ref: ScopedThreadRef) => void;
  readonly onArchive?: (ref: ScopedThreadRef) => void;
  readonly onSnooze?: (ref: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  readonly onMarkUnread?: (ref: ScopedThreadRef) => void;
  readonly onDelete?: (ref: ScopedThreadRef) => void;
  readonly onContextMenu?: (
    ref: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
}

function useOverviewListMotion(layoutKey: string, attentionExit = false) {
  const controller = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const previousLayoutKey = useRef(layoutKey);
  const attach = (node: HTMLElement | null) => {
    if (!node) return;
    const motion = createSidebarListMotion(node, attentionExit);
    controller.current = motion;
    motion.update(false);
    return () => {
      motion.dispose();
      controller.current = null;
    };
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Only row order and disclosure changes need layout measurements.
  useLayoutEffect(() => {
    if (previousLayoutKey.current === layoutKey) return;
    previousLayoutKey.current = layoutKey;
    controller.current?.update(true);
  }, [layoutKey]);
  return attach;
}

function useActiveRunningOverviewButton(activeKey: string | null, isRunningActive: boolean) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveKey = useRef<string | null>(activeKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronizes DOM scroll/focus with route changes targeting a running overview row.
  useLayoutEffect(() => {
    const changed = previousActiveKey.current !== activeKey;
    previousActiveKey.current = activeKey;
    if (!changed || !isRunningActive) return;
    const button = buttonRef.current;
    if (!button || button.getClientRects().length === 0) return;
    if (!button.matches(":hover")) {
      button.scrollIntoView({ block: "nearest" });
    }
    const activeEl = document.activeElement;
    if (activeEl !== button && activeEl?.closest('[data-slot="sidebar"]') !== null) {
      button.focus({ preventScroll: true });
    }
  }, [activeKey, isRunningActive]);
  return buttonRef;
}

function OverviewCount({ count, className }: { count: number; className: string }) {
  const badge = useRef<HTMLSpanElement>(null);
  const previousCount = useRef(count);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Bounce the badge once for a committed count change.
  useLayoutEffect(() => {
    const changed = previousCount.current !== count;
    previousCount.current = count;
    const node = badge.current;
    if (!changed || !node) return;
    const preference = window.matchMedia(SIDEBAR_REDUCED_MOTION);
    if (preference.matches) return;
    const animation = node.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
      { duration: 300, easing: sidebarWorkbenchEase },
    );
    const stop = () => {
      preference.removeEventListener("change", stop);
      animation.cancel();
    };
    preference.addEventListener("change", stop);
    animation.addEventListener("finish", stop, { once: true });
    return stop;
  }, [count]);
  return (
    <span ref={badge} className={className}>
      <AnimatedNumber value={count} />
    </span>
  );
}

function RunningSubtaskList({ layoutKey, children }: { layoutKey: string; children: ReactNode }) {
  const attach = useOverviewListMotion(layoutKey);
  return (
    <ul
      ref={attach}
      aria-hidden={children === null || undefined}
      className="relative ms-3 flex flex-col gap-px border-s border-sidebar-border ps-1"
    >
      {children}
    </ul>
  );
}

function OverviewProgress({ row }: { row: OverviewRow }) {
  const gt = useGT();
  const projection = useQuietThreadProjection(row.ref)?.projection;
  const progress = projection === undefined ? null : selectOverviewProgress(projection, row.thread);
  if (progress === null) return null;
  return (
    <>
      <span
        aria-hidden
        className="h-0.75 w-8 shrink-0 overflow-hidden rounded-full bg-sidebar-border"
      >
        <span
          className="block h-full origin-left rounded-full bg-current transition-transform duration-300 ease-(--ease-drawer) motion-reduce:transition-none rtl:origin-right"
          style={{ transform: `scaleX(${progress.done / progress.total})` }}
        />
      </span>
      <span className="shrink-0 tabular-nums">{gt("Tasks {done}/{total}", progress)}</span>
      <span aria-hidden>·</span>
    </>
  );
}

function OverviewActionIconButton({
  actionKey,
  label,
  icon,
  tone,
  onClick,
}: {
  actionKey: string;
  label: string;
  icon: ReactNode;
  tone?: "done" | "stop" | undefined;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-overview-quick-action={actionKey}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
            className={cn(
              "inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100",
              tone === "done" && "hover:text-success-foreground",
              tone === "stop" && "hover:text-error-foreground",
            )}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function OverviewRowQuickActions({
  row,
  mode,
  now,
  timestampFormat,
  actions,
  onDismissError,
}: {
  row: OverviewRow;
  mode: OverviewRowMode;
  now: string;
  timestampFormat: TimestampFormat;
  actions: SidebarOverviewActions | undefined;
  onDismissError: (key: string, token: string) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [menuOpen, setMenuOpen] = useState(false);
  const canOperate = useEnvironmentScope(row.ref.environmentId, AuthOrchestrationOperateScope);
  const canTriage = threadTriagePermitted(row.ref.environmentId);
  const errorToken = row.status === "failed" ? failedRunToken(row.thread) : null;
  const canArchive =
    canOperate && actions?.onArchive !== undefined && threadRuntimeCanArchive(row.thread.runtime);
  const canSnoozeRow =
    canTriage && actions?.onSnooze !== undefined && canSnooze(row.thread, { now });
  const hasCompletedRun = row.thread.latestRun?.completedAt != null;
  const snoozePresets =
    menuOpen && canSnoozeRow
      ? // oxlint-disable-next-line react/purity -- Presets are resolved only while the menu is open, so each opening reads a fresh time.
        resolveSnoozePresets(new Date(), timestampFormat, row.ref.environmentId, messages)
      : [];

  const dismissFailure =
    errorToken !== null ? () => onDismissError(row.key, errorToken) : undefined;
  const handleSettle =
    canTriage && actions?.onSettle !== undefined
      ? () => {
          if (errorToken !== null) onDismissError(row.key, errorToken);
          if (row.status === "unread") actions.onMarkRead?.(row.ref);
          actions.onSettle?.(row.ref);
        }
      : undefined;
  const handleArchive = canArchive
    ? () => {
        actions?.onArchive?.(row.ref);
      }
    : undefined;
  const handleUnsettle =
    canTriage && actions?.onUnsettle !== undefined
      ? () => actions.onUnsettle?.(row.ref)
      : undefined;
  const handleStop =
    canOperate && mode === "running" && row.status !== "children" && actions?.onStop !== undefined
      ? () => actions.onStop?.(row.ref)
      : undefined;
  const handleMarkRead =
    row.status === "unread" && actions?.onMarkRead !== undefined
      ? () => actions.onMarkRead?.(row.ref)
      : undefined;
  const handleMarkUnread =
    mode !== "attention" && hasCompletedRun && actions?.onMarkUnread !== undefined
      ? () => actions.onMarkUnread?.(row.ref)
      : undefined;
  const handleDelete =
    canOperate && actions?.onDelete !== undefined
      ? () => {
          actions.onDelete?.(row.ref);
        }
      : undefined;

  const hasMenuItems =
    dismissFailure !== undefined ||
    handleMarkRead !== undefined ||
    handleSettle !== undefined ||
    handleUnsettle !== undefined ||
    handleArchive !== undefined ||
    handleMarkUnread !== undefined ||
    canSnoozeRow ||
    handleDelete !== undefined;

  if (
    !handleStop &&
    !dismissFailure &&
    !handleSettle &&
    !handleUnsettle &&
    !handleArchive &&
    !hasMenuItems
  ) {
    return null;
  }

  return (
    <span
      data-overview-quick-actions={mode}
      className={cn(
        "pointer-events-none absolute top-1 end-1 flex items-center gap-px rounded-md bg-sidebar/96 p-0.5 opacity-0 shadow-xs ring-1 ring-inset ring-sidebar-border/70 transition-[opacity,transform] duration-150 ease-(--ease-drawer) ltr:translate-x-1 rtl:-translate-x-1 motion-reduce:translate-x-0 motion-reduce:transition-none dark:ring-white/8",
        "group-hover/overview-row:pointer-events-auto group-hover/overview-row:translate-x-0 group-hover/overview-row:opacity-100 group-focus-within/overview-row:pointer-events-auto group-focus-within/overview-row:translate-x-0 group-focus-within/overview-row:opacity-100",
        menuOpen && "pointer-events-auto translate-x-0 opacity-100",
      )}
    >
      {handleStop ? (
        <OverviewActionIconButton
          actionKey="stop"
          label={gt("Stop")}
          icon={<SquareIcon className="size-3 fill-current" />}
          tone="stop"
          onClick={handleStop}
        />
      ) : null}
      {row.status === "failed" && dismissFailure ? (
        <OverviewActionIconButton
          actionKey="dismiss"
          label={gt("Dismiss")}
          icon={<XIcon className="size-3.5" />}
          onClick={dismissFailure}
        />
      ) : null}
      {row.status === "unread" && handleSettle ? (
        <OverviewActionIconButton
          actionKey="settle"
          label={gt("Settle")}
          icon={<CheckIcon className="size-3.5" />}
          tone="done"
          onClick={handleSettle}
        />
      ) : null}
      {mode === "today" && row.status === "done" && handleUnsettle ? (
        <OverviewActionIconButton
          actionKey="unsettle"
          label={gt("Un-settle")}
          icon={<Undo2Icon className="size-3.5" />}
          onClick={handleUnsettle}
        />
      ) : null}
      {mode === "today" && row.status === "today" && handleSettle ? (
        <OverviewActionIconButton
          actionKey="settle"
          label={gt("Settle")}
          icon={<CheckIcon className="size-3.5" />}
          tone="done"
          onClick={handleSettle}
        />
      ) : null}
      {(row.status === "failed" || row.status === "unread" || mode === "today") && handleArchive ? (
        <OverviewActionIconButton
          actionKey="archive"
          label={gt("Archive")}
          icon={<ArchiveIcon className="size-3.5" />}
          onClick={handleArchive}
        />
      ) : null}
      {hasMenuItems ? (
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={gt("More actions")}
                      data-overview-quick-action="more"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100"
                    />
                  }
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">{gt("More actions")}</TooltipPopup>
          </Tooltip>
          <MenuPopup side="bottom" align="end">
            {dismissFailure ? (
              <MenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  dismissFailure();
                }}
              >
                <EyeOffIcon />
                {gt("Dismiss")}
              </MenuItem>
            ) : null}
            {handleMarkRead ? (
              <MenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  handleMarkRead();
                }}
              >
                <CheckIcon />
                {gt("Mark as read")}
              </MenuItem>
            ) : null}
            {row.status !== "done" &&
            row.status !== "approval" &&
            row.status !== "input" &&
            handleSettle ? (
              <MenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  handleSettle();
                }}
              >
                <CheckIcon />
                {gt("Settle")}
              </MenuItem>
            ) : null}
            {row.status === "done" && handleUnsettle ? (
              <MenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  handleUnsettle();
                }}
              >
                <Undo2Icon />
                {gt("Un-settle")}
              </MenuItem>
            ) : null}
            {handleMarkUnread ? (
              <MenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  handleMarkUnread();
                }}
              >
                <MailIcon />
                {gt("Mark unread")}
              </MenuItem>
            ) : null}
            {snoozePresets.length > 0 ? <MenuSeparator /> : null}
            {snoozePresets.map((preset) => (
              <MenuItem
                key={preset.id}
                onClick={(event) => {
                  event.stopPropagation();
                  const picked = pickSnoozePreset(
                    snoozePresets,
                    preset.id,
                    timestampFormat,
                    row.ref.environmentId,
                  );
                  if (picked) actions?.onSnooze?.(row.ref, picked);
                }}
              >
                <AlarmClockIcon />
                {preset.label}
                <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
              </MenuItem>
            ))}
            {handleArchive ? (
              <>
                <MenuSeparator />
                <MenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    handleArchive();
                  }}
                >
                  <ArchiveIcon />
                  {gt("Archive")}
                </MenuItem>
              </>
            ) : null}
            {handleDelete ? (
              <>
                <MenuSeparator />
                <MenuItem
                  variant="destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete();
                  }}
                >
                  <Trash2Icon />
                  {gt("Delete")}
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
    </span>
  );
}

function OverviewThreadButton({
  row,
  mode,
  title,
  statusLabel,
  context,
  active,
  showProgress,
  now,
  timestampFormat,
  actions,
  buttonRef,
  onDismissError,
  onOpen,
}: {
  row: OverviewRow;
  mode: OverviewRowMode;
  title: string;
  statusLabel: string;
  context: string | null;
  active: boolean;
  showProgress: boolean;
  now: string;
  timestampFormat: TimestampFormat;
  actions: SidebarOverviewActions | undefined;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  onDismissError: (key: string, token: string) => void;
  onOpen: () => void;
}) {
  const messages = useMessages();
  const minute = useNowMinute();
  const timestamp = row.timestamp;
  const time =
    timestamp === null || !Number.isFinite(timestamp)
      ? null
      : formatRelativeElapsed(
          Math.max(
            0,
            toServerClock(row.ref.environmentId, Date.parse(`${minute}:00Z`)) - timestamp,
          ),
          messages,
        );
  const indicator: Record<OverviewStatus, string> = {
    approval: "bg-orange-600 dark:bg-orange-400",
    input: "bg-orange-600 dark:bg-orange-400",
    starting: "bg-amber-600 dark:bg-amber-400",
    queued: "bg-amber-600 dark:bg-amber-400",
    working: "bg-amber-600 dark:bg-amber-400",
    waiting: "bg-sky-600 dark:bg-sky-400",
    background: "bg-sky-600 dark:bg-sky-400",
    children: "bg-sky-600 dark:bg-sky-400",
    failed: "bg-red-600 dark:bg-red-400",
    unread: "bg-emerald-600 dark:bg-emerald-400",
    done: "bg-emerald-600/75 dark:bg-emerald-400/75",
    today: "bg-sidebar-muted-foreground/50",
  };
  const criticalHalo: Partial<Record<OverviewStatus, string>> = {
    approval: "ring-[3px] ring-orange-500/20 dark:ring-orange-400/22",
    input: "ring-[3px] ring-orange-500/20 dark:ring-orange-400/22",
    failed: "ring-[3px] ring-red-500/20 dark:ring-red-400/22",
  };
  return (
    <div className="group/overview-row relative flex min-w-0 flex-1 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={buttonRef}
              type="button"
              data-overview-row={mode}
              data-overview-thread-key={row.key}
              aria-current={active ? "page" : undefined}
              onClick={onOpen}
              onContextMenu={
                actions?.onContextMenu
                  ? (event) => {
                      event.preventDefault();
                      actions.onContextMenu?.(
                        row.ref,
                        { x: event.clientX, y: event.clientY },
                        contextMenuSourceOf(event.nativeEvent),
                      );
                    }
                  : undefined
              }
              className={cn(
                "block min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1.5 text-start text-sidebar-foreground outline-none transition-[background-color,color,opacity,box-shadow,scale] duration-150 ease-(--ease-spring-snappy) active:duration-75 active:ease-out hover:bg-sidebar-row-hover active:bg-sidebar-row-active motion-safe:active:scale-[0.985] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-sidebar-row-active aria-[current=page]:light:ring-1 aria-[current=page]:light:ring-inset aria-[current=page]:light:ring-sidebar-border/70 aria-[current=page]:dark:ring-1 aria-[current=page]:dark:ring-inset aria-[current=page]:dark:ring-white/8 motion-reduce:transition-none motion-reduce:active:scale-100",
                mode === "today" &&
                  row.status === "done" &&
                  "opacity-75 hover:opacity-100 aria-[current=page]:opacity-100",
              )}
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                indicator[row.status],
                criticalHalo[row.status],
              )}
            />
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
        </TooltipTrigger>
        <TooltipPopup>{context === null ? title : `${title} · ${context}`}</TooltipPopup>
      </Tooltip>
      <OverviewRowQuickActions
        row={row}
        mode={mode}
        now={now}
        timestampFormat={timestampFormat}
        actions={actions}
        onDismissError={onDismissError}
      />
    </div>
  );
}

export function SidebarOverview({
  threads,
  activeKey,
  now,
  providers,
  projectNames,
  timestampFormat = "locale",
  actions,
  onNavigate,
}: {
  threads: readonly EnvironmentThreadShell[];
  activeKey: string | null;
  now: string;
  providers: ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>;
  projectNames: ReadonlyMap<string, string>;
  timestampFormat?: TimestampFormat;
  actions?: SidebarOverviewActions;
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
  const acknowledgedErrors = useUiStateStore((state) => state.acknowledgedErrorRunByThreadKey);
  const acknowledgeThreadError = useUiStateStore((state) => state.acknowledgeThreadError);
  const disconnectedEnvironmentIds = collectDisconnectedEnvironmentIds(isReady, environments);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [showAllRunning, setShowAllRunning] = useState(false);
  const [showTodayTasks, setShowTodayTasks] = useState(false);
  const [todayVisibleCount, setTodayVisibleCount] = useState(25);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const { active, activeKeys, attention, attentionCount, todayTasks, todayTasksCount } =
    buildSidebarOverview(
      threads,
      now,
      localVisits,
      acknowledgedErrors,
      disconnectedEnvironmentIds,
      { includeTodayRows: showTodayTasks },
    );
  const activeRunningButtonRef = useActiveRunningOverviewButton(
    activeKey,
    activeKey !== null && activeKeys.has(activeKey),
  );
  const preview = previewActiveWork(active);
  const childCount = active.reduce((sum, group) => sum + group.childCount, 0);
  const hiddenActive =
    active.length > preview.length ||
    preview.some((group) => group.children.length < group.childCount);
  const activeLabel = gt("Running now");
  const attentionLabel = gt("Needs my attention");
  const todayTasksLabel = gt("Today's tasks");
  const shownAttention = showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW_LIMIT);
  const shownRunning = showAllRunning ? active : preview;
  const runningLayoutKey = JSON.stringify(
    shownRunning.map(({ root, children }) => [
      root.key,
      collapsedGroups.has(root.key) ? [] : children.map((row) => row.key),
    ]),
  );
  const attentionLayoutKey = JSON.stringify(shownAttention.map((row) => row.key));
  const todayLayoutKey = showTodayTasks ? JSON.stringify(todayTasks.map((row) => row.key)) : "[]";
  const hasMoreAttention = attention.length > ATTENTION_PREVIEW_LIMIT;
  const attachRunning = useOverviewListMotion(runningLayoutKey);
  const attachAttention = useOverviewListMotion(attentionLayoutKey, true);
  const attachToday = useOverviewListMotion(todayLayoutKey);
  const attachSections = useOverviewListMotion(
    `${runningLayoutKey}:${attentionLayoutKey}:${todayLayoutKey}:${incomplete}:${hiddenActive}:${hasMoreAttention}:${todayTasksCount > 0}`,
    true,
  );
  const headingClass =
    "flex min-w-0 items-center gap-2 px-2 pt-2 pb-1 text-2xs text-sidebar-muted-foreground";

  const renderRow = (row: OverviewRow, mode: OverviewRowMode, count = 0) => {
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
    const context = mode === "running" ? (provider ?? project) : (project ?? provider);
    return (
      <OverviewThreadButton
        row={row}
        mode={mode}
        title={title}
        statusLabel={statusLabel}
        context={context ?? null}
        active={activeKey === row.key}
        showProgress={mode === "attention" || (mode === "running" && activeKey === row.key)}
        now={now}
        timestampFormat={timestampFormat}
        actions={actions}
        buttonRef={mode === "running" && activeKey === row.key ? activeRunningButtonRef : undefined}
        onDismissError={acknowledgeThreadError}
        onOpen={() => onNavigate(row.ref)}
      />
    );
  };
  const renderActive = () => (
    <ul
      ref={attachRunning}
      aria-label={activeLabel}
      aria-hidden={shownRunning.length === 0 || undefined}
      className="relative flex flex-col gap-px"
    >
      {shownRunning.map(({ root, children, childCount: count }) => {
        const expanded = !collapsedGroups.has(root.key);
        const visibleChildren = expanded && children.length > 0 ? children : null;
        const title = root.thread.title || gt("Untitled thread");
        return (
          <li key={root.key} data-sidebar-motion-key={root.key}>
            <div className="flex min-w-0 items-center">
              {children.length > 0 ? (
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
                  className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-sidebar-muted-foreground outline-none transition-colors duration-150 ease-out hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <ChevronDownIcon
                    aria-hidden
                    className={cn(
                      "size-3 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-(--ease-drawer)",
                      !expanded && "-rotate-90 rtl:rotate-90",
                    )}
                  />
                </button>
              ) : null}
              {renderRow(root, "running", count)}
            </div>
            <RunningSubtaskList
              layoutKey={JSON.stringify(visibleChildren?.map((row) => row.key) ?? [])}
            >
              {visibleChildren?.map((child) => (
                <li key={child.key} data-sidebar-motion-key={child.key} className="flex min-w-0">
                  {renderRow(child, "running")}
                </li>
              )) ?? null}
            </RunningSubtaskList>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div
      ref={attachSections}
      className="relative mb-2 flex flex-col gap-1.5 border-b border-sidebar-border pb-2"
      data-thread-selection-safe
    >
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
          <OverviewCount count={active.length} className="ms-auto shrink-0 tabular-nums" />
        </h2>
        {incomplete ? (
          <p role="status" className="px-2 text-2xs text-sidebar-muted-foreground">
            {gt("Some connections are still syncing. Status may be out of date.")}
          </p>
        ) : null}
        {renderActive()}
        {hiddenActive ? (
          <Button
            variant="ghost"
            size="compact"
            aria-expanded={showAllRunning}
            onClick={() => setShowAllRunning(!showAllRunning)}
          >
            {showAllRunning
              ? gt("Collapse")
              : gt(
                  "{count, plural, one {Show all {count} running task} other {Show all {count} running tasks}}",
                  { count: active.length + childCount },
                )}
          </Button>
        ) : null}
      </section>
      {attention.length > 0 ? (
        <section aria-label={attentionLabel} data-sidebar-motion-key="attention">
          <h2 className={headingClass}>
            <span>{attentionLabel}</span>
            <OverviewCount
              count={attentionCount}
              className={cn(
                "ms-auto rounded-full px-1.5 font-medium tabular-nums",
                attentionCount > 0 && "bg-warning-surface text-warning-foreground",
              )}
            />
          </h2>
          <ul
            ref={attachAttention}
            aria-label={attentionLabel}
            className="relative flex flex-col gap-px"
          >
            {shownAttention.map((row) => (
              <li key={row.key} data-sidebar-motion-key={row.key} className="flex min-w-0">
                {renderRow(row, "attention")}
              </li>
            ))}
          </ul>
          {hasMoreAttention ? (
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
      {todayTasksCount > 0 ? (
        <section aria-label={todayTasksLabel} data-sidebar-motion-key="today-tasks">
          <button
            type="button"
            aria-expanded={showTodayTasks}
            onClick={() =>
              setShowTodayTasks((expanded) => {
                if (expanded) setTodayVisibleCount(25);
                return !expanded;
              })
            }
            className={cn(
              headingClass,
              "w-full cursor-pointer rounded-md text-start outline-none transition-colors duration-150 ease-out hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
            )}
          >
            <span>{todayTasksLabel}</span>
            <span className="ms-auto inline-flex shrink-0 items-center gap-1 tabular-nums">
              <OverviewCount count={todayTasksCount} className="tabular-nums" />
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "size-3 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-(--ease-drawer)",
                  !showTodayTasks && "-rotate-90 rtl:rotate-90",
                )}
              />
            </span>
          </button>
          {showTodayTasks ? (
            <>
              <ul
                ref={attachToday}
                aria-label={todayTasksLabel}
                className="relative flex flex-col gap-px"
              >
                {todayTasks.slice(0, todayVisibleCount).map((row) => (
                  <li key={row.key} data-sidebar-motion-key={row.key} className="flex min-w-0">
                    {renderRow(row, "today")}
                  </li>
                ))}
              </ul>
              {todayTasks.length > todayVisibleCount ? (
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() => setTodayVisibleCount((count) => count + 25)}
                >
                  {gt("{count, plural, one {Show {count} more} other {Show {count} more}}", {
                    count: todayTasks.length - todayVisibleCount,
                  })}
                </Button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

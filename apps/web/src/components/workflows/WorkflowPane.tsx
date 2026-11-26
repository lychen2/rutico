import { useRef } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { workflowReferenceLabel } from "@t3tools/client-runtime/workflows";
import { EnvironmentId, ThreadId, type WorkflowRunReference } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { BotIcon, Maximize2Icon, XIcon } from "lucide-react";

import { useSharedIndicator } from "../../lib/motion/useSharedIndicator";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import {
  activeWorkflowPaneIndex,
  closeWorkflowPaneTab,
  openWorkflowPaneTab,
  type WorkflowPaneState,
  type WorkflowPaneTab,
} from "./workflowPane.logic";
import {
  useOpenReferencePage,
  WorkflowReferenceMark,
  WorkflowReferencePanel,
} from "./WorkflowReferences";
import WorkflowThreadPane, {
  useOpenThreadPage,
  WorkflowThreadTabLabel,
} from "./WorkflowThreadPane";
import { useWorkflowThreadOpen } from "./useWorkflowThreadOpen";

/**
 * The pane beside a run: a tab per transcript or reference opened from it. Only the tab that
 * shows is mounted, so a pane with a chat and two pull requests renders one of them.
 */
export default function WorkflowPane({
  environmentId,
  runId,
  state,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: string | null;
  readonly state: WorkflowPaneState;
  readonly onChange: (next: WorkflowPaneState) => void;
}) {
  const gt = useGT();
  const detail = useEnvironmentQuery(
    runId === null ? null : serverEnvironment.workflowRun({ environmentId, input: { runId } }),
  );
  const openThreadPage = useOpenThreadPage();
  const openReferencePage = useOpenReferencePage(environmentId);
  const tabs = state.pane ?? [];
  const activeIndex = activeWorkflowPaneIndex(state);
  const active = tabs[activeIndex];
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabIndicatorRef = useRef<HTMLSpanElement | null>(null);
  const activeTabKey =
    active === undefined
      ? null
      : "thread" in active
        ? `thread:${active.env ?? ""}:${active.thread}`
        : `${active.kind}:${active.key}`;
  useSharedIndicator({
    containerRef: tabListRef,
    indicatorRef: tabIndicatorRef,
    activeSelector: '[data-workflow-pane-tab="true"][data-active="true"]',
    activeKey: activeTabKey,
    preset: "fluid",
    axis: "x",
  });
  const threadOf = (tab: Extract<WorkflowPaneTab, { thread: string }>) =>
    scopeThreadRef(
      tab.env === undefined ? environmentId : EnvironmentId.make(tab.env),
      ThreadId.make(tab.thread),
    );
  const referenceOf = (tab: Extract<WorkflowPaneTab, { kind: string }>) =>
    detail.data?.references.find(
      (reference) => reference.kind === tab.kind && reference.key === tab.key,
    ) ?? null;
  const activeReference = active === undefined || "thread" in active ? null : referenceOf(active);
  const activeThread = active !== undefined && "thread" in active ? threadOf(active) : null;
  const activeThreadOpen = useWorkflowThreadOpen(
    environmentId,
    activeThread?.environmentId ?? environmentId,
  ).open;
  const openFull =
    active === undefined
      ? null
      : "thread" in active
        ? // Nowhere to go while this client neither knows the environment nor reads it through the run's.
          activeThreadOpen === "unavailable"
          ? null
          : () =>
              openThreadPage(
                threadOf(active),
                activeThreadOpen === "linked" ? environmentId : undefined,
              )
        : activeReference === null
          ? null
          : openReferencePage(activeReference);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 border-b ps-2 pe-2">
        <div
          ref={tabListRef}
          role="tablist"
          aria-label={gt("Open beside the run")}
          className="relative flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
        >
          <span
            ref={tabIndicatorRef}
            aria-hidden="true"
            data-slot="workflow-pane-tab-indicator"
            className="pointer-events-none absolute top-0 left-0 z-0 rounded-md bg-muted opacity-0 ring-1 ring-inset ring-border/70 will-change-transform dark:ring-white/10"
          />
          {tabs.map((tab, index) => (
            <div
              key={
                "thread" in tab ? `thread:${tab.env ?? ""}:${tab.thread}` : `${tab.kind}:${tab.key}`
              }
              data-workflow-pane-tab="true"
              data-active={index === activeIndex ? "true" : "false"}
              className={cn(
                "relative z-1 flex max-w-56 min-w-0 shrink-0 items-center rounded-md text-xs transition-colors duration-150",
                index === activeIndex
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={index === activeIndex}
                className="flex min-w-0 cursor-pointer items-center gap-1.5 py-1 ps-2 pe-1"
                onClick={() => onChange(openWorkflowPaneTab(state, tab))}
              >
                {"thread" in tab ? (
                  <>
                    <BotIcon aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">
                      <WorkflowThreadTabLabel threadRef={threadOf(tab)} />
                    </span>
                  </>
                ) : (
                  <ReferenceTabLabel reference={referenceOf(tab)} fallback={tab.kind} />
                )}
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={gt("Close tab")}
                onClick={() => onChange(closeWorkflowPaneTab(state, index))}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
        {openFull === null ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={
              active !== undefined && "thread" in active
                ? gt("Open as a full thread")
                : gt("Open on its own page")
            }
            onClick={openFull}
          >
            <Maximize2Icon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close the pane")}
          onClick={() => onChange({})}
        >
          <XIcon />
        </Button>
      </div>
      <div
        key={activeTabKey ?? "empty"}
        role="tabpanel"
        data-workflow-detail-enter="true"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {active === undefined ? null : "thread" in active ? (
          <WorkflowThreadPane
            key={`${active.env ?? ""}:${active.thread}`}
            viaEnvironmentId={environmentId}
            threadRef={threadOf(active)}
          />
        ) : activeReference !== null ? (
          <WorkflowReferencePanel
            key={`${active.kind}:${active.key}`}
            environmentId={environmentId}
            reference={activeReference}
          />
        ) : (
          <p className="p-3 text-xs text-muted-foreground" role="status">
            {detail.data === null ? gt("Loading…") : gt("This run no longer lists it.")}
          </p>
        )}
      </div>
    </div>
  );
}

function ReferenceTabLabel({
  reference,
  fallback,
}: {
  readonly reference: WorkflowRunReference | null;
  readonly fallback: string;
}) {
  if (reference === null) return <span className="truncate">{fallback}</span>;
  return (
    <>
      <WorkflowReferenceMark reference={reference} />
      <span className="truncate">{workflowReferenceLabel(reference)}</span>
    </>
  );
}

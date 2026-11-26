import type * as React from "react";
import type {
  EnvironmentId,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { toastManager } from "../ui/toast";
import { groupPullRequestChecks } from "./pullRequestDetail.logic";
import { summarizeChecksRing, type ChecksRingSegment } from "./pullRequestStackRail.logic";
import {
  PullRequestCheckStatusIcon,
  pullRequestChecksCountLabel,
  pullRequestCheckStatusLabel,
  pullRequestChecksStatePresentation,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

const CHECKS_RING_RADIUS = 14;
const CHECKS_RING_CIRCUMFERENCE = 2 * Math.PI * CHECKS_RING_RADIUS;

const CHECKS_SEGMENT_TONES: Record<ChecksRingSegment["kind"], string> = {
  passed: "text-success",
  running: "text-warning",
  failed: "text-destructive",
  neutral: "text-muted-foreground/45",
};

function ChecksProgressRing({ checks }: { readonly checks: ReadonlyArray<PullRequestCheck> }) {
  const gt = useGT();
  const ring = summarizeChecksRing(checks, CHECKS_RING_CIRCUMFERENCE);
  if (ring.total === 0) return null;

  return (
    <div
      data-slot="pr-checks-ring-summary"
      className="mb-2.5 flex items-center gap-3 rounded-lg border border-border/60 bg-muted/35 px-2.5 py-2"
    >
      <div className="relative flex size-9 shrink-0 items-center justify-center">
        <svg aria-hidden="true" viewBox="0 0 36 36" className="size-9 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r={CHECKS_RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            className="text-border/75"
          />
          {ring.segments.map((segment) => (
            <circle
              key={segment.kind}
              cx="18"
              cy="18"
              r={CHECKS_RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeDasharray={`${segment.dashLength} ${CHECKS_RING_CIRCUMFERENCE}`}
              strokeDashoffset={segment.dashOffset}
              className={cn(
                "transition-[stroke-dasharray,stroke-dashoffset] duration-(--duration-fluid) ease-(--spring-fluid) motion-reduce:transition-none",
                CHECKS_SEGMENT_TONES[segment.kind],
              )}
            />
          ))}
        </svg>
        <span className="absolute font-mono text-3xs font-semibold tabular-nums text-foreground">
          {ring.passed}/{ring.total}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5 text-xs">
        <p className="font-medium tabular-nums text-foreground">
          {gt("{passed}/{total} passed", { passed: ring.passed, total: ring.total })}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs tabular-nums text-muted-foreground">
          {ring.failed > 0 ? (
            <span className="text-destructive">{gt("{count} failed", { count: ring.failed })}</span>
          ) : null}
          {ring.running > 0 ? (
            <span className="text-warning-foreground">
              {gt("{count} running", { count: ring.running })}
            </span>
          ) : null}
          {ring.neutral > 0 ? <span>{gt("{count} neutral", { count: ring.neutral })}</span> : null}
        </div>
      </div>
    </div>
  );
}

// Fetch only on open to avoid per-row requests.
function LazyChecksBody({
  environmentId,
  reference,
  threadRef,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  threadRef: ScopedThreadRef | null;
}) {
  const gt = useGT();
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
    useMessages(),
  );
  if (detailQuery.error !== null) {
    return <p className="text-muted-foreground text-xs">{detailQuery.error}</p>;
  }
  if (detailQuery.data === null) {
    return (
      <p className="text-muted-foreground text-xs">
        {detailQuery.isPending ? gt("Loading checks…") : gt("No checks reported")}
      </p>
    );
  }
  return <ChecksBody checks={detailQuery.data.checks} threadRef={threadRef} />;
}

function ChecksBody({
  checks,
  threadRef,
}: {
  checks: ReadonlyArray<PullRequestCheck>;
  threadRef: ScopedThreadRef | null;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const openLink = useOpenLink(threadRef);
  const [showAll, setShowAll] = useState(false);
  const { attention, running, completed } = groupPullRequestChecks(checks);
  const canCollapse = attention.length + running.length > 0 && completed.length > 0;
  const visibleChecks = [...attention, ...running, ...(showAll || !canCollapse ? completed : [])];
  const hasDetails = visibleChecks.some((check) => check.url !== null);
  if (checks.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        <T>No checks reported</T>
      </p>
    );
  }
  return (
    <>
      <ChecksProgressRing checks={checks} />
      <ScrollArea className="-me-3 w-auto max-h-64">
        <ul
          className={cn(
            "grid gap-x-2 gap-y-1 pe-3",
            hasDetails
              ? "grid-cols-[auto_minmax(0,1fr)_auto_auto]"
              : "grid-cols-[auto_minmax(0,1fr)_auto]",
          )}
        >
          {visibleChecks.map(
            (check, index) => (
              /* oxlint-disable react/no-array-index-key -- Check names can repeat; these status rows have no local state. */ <li
                key={`${index}:${check.name}`}
                className="col-span-full grid grid-cols-subgrid items-center text-xs"
              >
                <PullRequestCheckStatusIcon status={check.status} />
                <SharedTooltipTrigger
                  render={<span className="min-w-0 truncate">{check.name}</span>}
                  label={check.description ?? check.name}
                />
                <span className="justify-self-end whitespace-nowrap text-muted-foreground">
                  {pullRequestCheckStatusLabel(check, resolve)}
                </span>
                {check.url === null ? null : (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      if (!check.url) return;
                      void openLink(check.url).catch((error: unknown) => {
                        console.error(error);
                        toastManager.add({
                          type: "error",
                          title: m(msg("Unable to open check details")),
                        });
                      });
                    }}
                  >
                    <T>Details</T>
                  </button>
                )}
              </li>
            ) /* oxlint-enable react/no-array-index-key */,
          )}
        </ul>
      </ScrollArea>
      {canCollapse ? (
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? gt("Show less") : gt("Show all")}
        </Button>
      ) : null}
    </>
  );
}

export function PullRequestChecksPopover({
  checksState,
  checks,
  stale = false,
  environmentId,
  reference,
  threadRef = null,
  variant = "icon",
  className,
  render,
}: {
  checksState: PullRequestChecksState;
  checks?: ReadonlyArray<PullRequestCheck>;
  stale?: boolean;
  environmentId?: EnvironmentId;
  reference?: PullRequestRef;
  threadRef?: ScopedThreadRef | null;
  variant?: "icon" | "count";
  className?: string;
  render?: React.ReactElement;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const presentation = pullRequestChecksStatePresentation(checksState, resolve);
  const countLabel = checks === undefined ? null : pullRequestChecksCountLabel(checks, resolve);
  const summary =
    checks === undefined || stale ? null : summarizePullRequestChecks(checks, resolve);
  return (
    <Popover>
      <PopoverTrigger
        nativeButton={variant === "count"}
        aria-label={
          variant === "count"
            ? gt("Open checks: {summary}", { summary: summary ?? presentation.label })
            : gt("Checks: {summary}", { summary: presentation.label })
        }
        render={
          variant === "count" ? (
            (render ?? <Button variant="ghost" size="sm" className={className} />)
          ) : (
            <span
              role="button"
              tabIndex={0}
              className={cn("inline-flex shrink-0 cursor-pointer items-center", className)}
            />
          )
        }
        onClick={(event) => event.stopPropagation()}
      >
        <presentation.Icon aria-hidden className={cn("size-3.5", presentation.toneClassName)} />
        {variant === "count" && countLabel !== null ? (
          <span className="min-w-0 truncate tabular-nums">{countLabel}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup align="start" width="md" side="bottom">
        <p className="mb-2 font-medium text-sm">{presentation.label}</p>
        {summary === null ? null : <p className="mb-2 text-muted-foreground text-xs">{summary}</p>}
        {stale ? (
          <p className="text-muted-foreground text-xs">
            <T>Check details are out of date. Refresh the pull request to update them.</T>
          </p>
        ) : checks !== undefined ? (
          <ChecksBody checks={checks} threadRef={threadRef} />
        ) : environmentId !== undefined && reference !== undefined ? (
          <LazyChecksBody
            environmentId={environmentId}
            reference={reference}
            threadRef={threadRef}
          />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

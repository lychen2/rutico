import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { OrchestrationV2Run, TurnTokenUsage } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { ChevronUpIcon } from "lucide-react";

import { tickTextContent } from "~/lib/tickTextContent";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import "./composerStatusGlass.css";

const runStatusLabels = {
  preparing: msg("Preparing"),
  queued: msg("Queued"),
  starting: msg("Starting"),
  running: msg("Running"),
  waiting: msg("Waiting"),
  completed: msg("Completed"),
  interrupted: msg("Interrupted"),
  failed: msg("Failed"),
  cancelled: msg("Cancelled"),
  rolled_back: msg("Rolled back"),
} satisfies Record<OrchestrationV2Run["status"], string>;

export function ComposerThreadContext({
  usage,
  run,
  stepCount,
  turnUsage,
  contextStatus,
}: {
  readonly usage: ContextWindowSnapshot | null;
  readonly run: Pick<
    OrchestrationV2Run,
    "ordinal" | "status" | "workStartedAt" | "startedAt" | "completedAt"
  > | null;
  readonly stepCount: number | null;
  readonly turnUsage: TurnTokenUsage | null;
  readonly contextStatus?: string | undefined;
}) {
  const gt = useGT();
  const locale = useLocale();
  const resolve = useMessages();
  const status = run?.status;
  const start = run?.workStartedAt ?? run?.startedAt ?? null;
  const startMs = start === null ? null : DateTime.toEpochMillis(start);
  const endMs = run?.completedAt == null ? null : DateTime.toEpochMillis(run.completedAt);
  const running =
    status === "preparing" || status === "starting" || status === "running" || status === "waiting";
  const percent = usage?.usedPercentage == null ? null : Math.round(usage.usedPercentage);
  const modelUsage =
    turnUsage?.usageStatus !== "unavailable" && !turnUsage?.localCommand ? turnUsage : null;
  const input = modelUsage?.inputTokens;
  const output = modelUsage?.outputTokens;
  const cacheRead = modelUsage?.cachedInputTokens;
  const cacheWrite = modelUsage?.cacheCreationTokens;
  const total = input !== undefined && output !== undefined ? input + output : null;
  const cachePercent =
    input !== undefined && input > 0 && cacheRead !== undefined
      ? Math.round((cacheRead / input) * 100)
      : null;

  return (
    <div className="relative flex justify-center px-2 pt-1">
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" data-composer-status-glass />}>
          <span className="flex items-center gap-1.5 font-medium">
            <span
              aria-hidden
              className="grid size-3 shrink-0 place-items-center rounded-full border border-current/50"
              style={
                percent === null
                  ? undefined
                  : { background: `conic-gradient(currentColor ${percent}%, transparent 0)` }
              }
            >
              {percent === null ? null : <span className="size-2 rounded-full bg-background" />}
            </span>
            {run === null
              ? gt("Context", { $context: "context window row label" })
              : gt("Round {round}", { round: run.ordinal.toLocaleString(locale) })}
          </span>
          {status !== undefined ? <span>{resolve(runStatusLabels[status])}</span> : null}
          {stepCount !== null ? (
            <span>{gt("{steps, plural, one {# step} other {# steps}}", { steps: stepCount })}</span>
          ) : null}
          {startMs !== null ? (
            endMs !== null ? (
              <span>{formatDuration(Math.max(0, endMs - startMs))}</span>
            ) : running ? (
              <span
                ref={tickTextContent((nowMs) => formatDuration(Math.max(0, nowMs - startMs)), true)}
              />
            ) : null
          ) : null}
          {total !== null ? (
            <span>{gt("{tokens} tokens", { tokens: total.toLocaleString(locale) })}</span>
          ) : null}
          {cachePercent !== null ? (
            <span>{gt("Cache {percent}%", { percent: cachePercent })}</span>
          ) : null}
          <ChevronUpIcon aria-hidden className="size-3 shrink-0" />
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" padding="compact" width="sm">
          <PopoverTitle className="mb-2">{gt("Context window")}</PopoverTitle>
          <p className="text-xs text-muted-foreground tabular-nums">
            {usage === null
              ? gt("Not reported")
              : usage.maxTokens == null
                ? gt("{usedTokens} tokens used", {
                    usedTokens: usage.usedTokens.toLocaleString(locale),
                  })
                : gt("{used} of {max} tokens", {
                    used: usage.usedTokens.toLocaleString(locale),
                    max: usage.maxTokens.toLocaleString(locale),
                  })}
          </p>
          {input !== undefined ||
          output !== undefined ||
          cacheRead !== undefined ||
          cacheWrite !== undefined ? (
            <>
              <p className="mt-3 text-sm font-semibold">{gt("Round token usage")}</p>
              <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
                {input !== undefined ? (
                  <>
                    <dt>{gt("Input")}</dt>
                    <dd>{input.toLocaleString(locale)}</dd>
                  </>
                ) : null}
                {output !== undefined ? (
                  <>
                    <dt>{gt("Output")}</dt>
                    <dd>{output.toLocaleString(locale)}</dd>
                  </>
                ) : null}
                {cacheRead !== undefined ? (
                  <>
                    <dt>{gt("Cache read")}</dt>
                    <dd>{cacheRead.toLocaleString(locale)}</dd>
                  </>
                ) : null}
                {cacheWrite !== undefined ? (
                  <>
                    <dt>{gt("Cache write")}</dt>
                    <dd>{cacheWrite.toLocaleString(locale)}</dd>
                  </>
                ) : null}
              </dl>
            </>
          ) : null}
          {contextStatus ? (
            <p className="mt-2 text-xs text-muted-foreground">{contextStatus}</p>
          ) : null}
        </PopoverPopup>
      </Popover>
    </div>
  );
}

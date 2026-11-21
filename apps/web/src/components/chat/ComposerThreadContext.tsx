import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { OrchestrationV2Run, TurnTokenUsage } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { ChevronDownIcon } from "lucide-react";

import { tickTextContent } from "~/lib/tickTextContent";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";

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
  const rate =
    output !== undefined && startMs !== null && endMs !== null && endMs > startMs
      ? ((output * 1000) / (endMs - startMs)).toLocaleString(locale, { maximumFractionDigits: 1 })
      : null;
  const cachePercent =
    input !== undefined && input > 0 && cacheRead !== undefined
      ? Math.round((cacheRead / input) * 100)
      : null;

  return (
    <div className="relative flex justify-center px-2 pt-1">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="group flex min-h-7 max-w-full flex-wrap items-center justify-center gap-x-2 rounded-sm px-1 text-xs text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={
                running ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-current"
              }
            />
            {run === null
              ? gt("Context", { $context: "context window row label" })
              : gt("Round {round}", { round: run.ordinal.toLocaleString(locale) })}
          </span>
          {status !== undefined ? (
            <span className="sr-only">{resolve(runStatusLabels[status])}</span>
          ) : null}
          {stepCount !== null ? (
            <span>{gt("{steps, plural, one {# step} other {# steps}}", { steps: stepCount })}</span>
          ) : null}
          {rate !== null && <span>· {rate} tok/s</span>}
          {total !== null ? (
            <span className="border-s ps-2">
              {gt("{tokens} tokens", { tokens: total.toLocaleString(locale) })}
            </span>
          ) : null}
          {cachePercent !== null ? (
            <span>{gt("Cache {percent}%", { percent: cachePercent })}</span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className="size-3 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
          />
        </PopoverTrigger>
        <PopoverPopup side="bottom" align="center" padding="compact" width="sm">
          <PopoverTitle className="mb-2">{gt("Context window")}</PopoverTitle>
          {run !== null ? (
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2 border-b pb-2 text-sm tabular-nums">
              <strong>{gt("Round {round}", { round: run.ordinal.toLocaleString(locale) })}</strong>
              <span>{resolve(runStatusLabels[run.status])}</span>
              {rate !== null && <strong>{rate} tok/s</strong>}
              {stepCount !== null && (
                <span>
                  {gt("{steps, plural, one {# step} other {# steps}}", { steps: stepCount })}
                </span>
              )}
              {startMs !== null ? (
                endMs !== null ? (
                  <span>{formatDuration(Math.max(0, endMs - startMs))}</span>
                ) : running ? (
                  <span
                    ref={tickTextContent(
                      (nowMs) => formatDuration(Math.max(0, nowMs - startMs)),
                      true,
                    )}
                  />
                ) : null
              ) : null}
            </div>
          ) : null}
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
            {percent === null ? null : ` · ${percent}%`}
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

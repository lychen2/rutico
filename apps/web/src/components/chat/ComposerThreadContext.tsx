import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type {
  OrchestrationV2Run,
  OrchestrationV2ProviderTurn,
  TurnTokenUsage,
} from "@t3tools/contracts";
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

import type { currentRoundActivity } from "./currentRoundActivity";
import "./composerSessionOverview.css";

export function ComposerThreadContext({
  usage,
  run,
  stepCount,
  turnUsage,
  modelOutputTiming,
  activity,
  contextStatus,
}: {
  readonly usage: ContextWindowSnapshot | null;
  readonly run: Pick<
    OrchestrationV2Run,
    "id" | "ordinal" | "status" | "workStartedAt" | "startedAt" | "completedAt"
  > | null;
  readonly stepCount: number | null;
  readonly turnUsage: TurnTokenUsage | null;
  readonly modelOutputTiming?: OrchestrationV2ProviderTurn["modelOutputTiming"];
  readonly activity?: ReturnType<typeof currentRoundActivity> | null;
  readonly contextStatus?: string | undefined;
}) {
  const gt = useGT();
  const locale = useLocale();
  const resolve = useMessages();
  const status = run?.status;
  const start = run?.startedAt ?? run?.workStartedAt ?? null;
  const startMs = start === null ? null : DateTime.toEpochMillis(start);
  const endMs = run?.completedAt == null ? null : DateTime.toEpochMillis(run.completedAt);
  const running =
    status === "preparing" || status === "starting" || status === "running" || status === "waiting";
  const extensionWindow =
    usage === null
      ? /^mc: (\d+(?:\.\d+)?[KMB]?) \((\d+)%\)(?: · |$)/u.exec(contextStatus ?? "")
      : null;
  const extensionUsed = extensionWindow?.[1];
  const percent =
    usage?.usedPercentage != null
      ? Math.round(usage.usedPercentage)
      : extensionWindow === null
        ? null
        : Number(extensionWindow[2]);
  const modelUsage =
    turnUsage?.usageStatus !== "unavailable" && !turnUsage?.localCommand ? turnUsage : null;
  const input = modelUsage?.inputTokens;
  const output = modelUsage?.outputTokens;
  const cacheRead = modelUsage?.cachedInputTokens;
  const cacheWrite = modelUsage?.cacheCreationTokens;
  const reasoningTokens = modelUsage?.reasoningTokens;
  const total = input !== undefined && output !== undefined ? input + output : null;
  const firstOutputMs =
    startMs === null || modelOutputTiming === undefined
      ? null
      : modelOutputTiming.firstOutputAtMs - startMs;
  const firstOutput =
    firstOutputMs === null || firstOutputMs < 0 ? null : formatDuration(firstOutputMs);
  const speed =
    modelOutputTiming !== undefined && modelOutputTiming.sampledDurationMs > 0
      ? gt("{rate} chars/s", {
          rate: (
            (modelOutputTiming.sampledCharacters * 1000) /
            modelOutputTiming.sampledDurationMs
          ).toLocaleString(locale, { maximumFractionDigits: 1 }),
        })
      : null;
  const cachePercent =
    input !== undefined && input > 0 && cacheRead !== undefined
      ? Math.round((cacheRead / input) * 100)
      : null;

  return (
    <div data-session-footer="" className="flex justify-start px-3 py-1">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="group flex min-h-7 max-w-full flex-wrap items-center justify-center gap-x-2 rounded-sm px-1 text-xs text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          <span
            data-session-primary=""
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1"
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
              <span>
                {gt("{steps, plural, one {# step} other {# steps}}", { steps: stepCount })}
              </span>
            ) : null}
          </span>
          {run !== null && (
            <span className="inline-flex items-center gap-2 border-s ps-2">
              <span>
                {gt("Time to first output")} {firstOutput ?? gt("Not reported")}
              </span>
              <span>
                {gt("Model output speed")} {speed ?? gt("Not reported")}
              </span>
            </span>
          )}
          {total !== null ? (
            <span className="border-s ps-2">
              {gt("{tokens} tokens", { tokens: total.toLocaleString(locale) })}
            </span>
          ) : null}
          {cachePercent !== null ? (
            <>
              {total !== null && <span aria-hidden>·</span>}
              <span>{gt("Cache {percent}%", { percent: cachePercent })}</span>
            </>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className="size-3 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
          />
        </PopoverTrigger>
        <PopoverPopup side="top" align="center" padding="none" width="md">
          <div data-session-overview="" className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <PopoverTitle>{gt("Overview")}</PopoverTitle>
              {status && (
                <span className="text-xs text-muted-foreground">
                  {resolve(runStatusLabels[status])}
                </span>
              )}
            </div>
            {run !== null ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-4 border-b pb-3 text-xs tabular-nums">
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">{gt("Activity")}</span>
                    <strong className="text-base">
                      {gt("Round {round}", { round: run.ordinal.toLocaleString(locale) })}
                    </strong>
                    {stepCount !== null && (
                      <span>
                        {gt("{steps, plural, one {# step} other {# steps}}", { steps: stepCount })}
                      </span>
                    )}
                  </div>
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">{gt("Model output speed")}</span>
                    <strong className="text-base">{speed ?? gt("Not reported")}</strong>
                    <div className="flex gap-1 text-muted-foreground">
                      <span>{gt("Time to first output")}</span>
                      <span>{firstOutput ?? gt("Not reported")}</span>
                    </div>
                    <div className="flex gap-1 text-muted-foreground">
                      <span>{gt("Duration")}</span>
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
                  </div>
                </div>
                {modelOutputTiming !== undefined && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    {gt(
                      "Samples text, thinking and tool arguments received from the main model. Speed uses the time between the first and last chunks of each model response, excluding first-chunk characters, tool execution and results.",
                    )}
                  </p>
                )}
              </>
            ) : null}
            {(activity || reasoningTokens !== undefined) && (
              <dl className="mb-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs tabular-nums">
                {reasoningTokens !== undefined || (activity?.reasoning.count ?? 0) > 0 ? (
                  <>
                    <dt>{gt("Reasoning")}</dt>
                    <dd className="text-end">
                      {reasoningTokens !== undefined
                        ? gt("{tokens} tokens", { tokens: reasoningTokens.toLocaleString(locale) })
                        : activity?.reasoning.count}
                      {activity &&
                        activity.reasoning.timed > 0 &&
                        ` · Σ ${formatDuration(activity.reasoning.milliseconds)}`}
                    </dd>
                  </>
                ) : null}
                {activity && (
                  <>
                    <dt>{gt("Tool calls")}</dt>
                    <dd className="text-end">
                      {activity.tools.count}
                      {activity.tools.timed > 0 &&
                        ` · Σ ${formatDuration(activity.tools.milliseconds)}`}
                    </dd>
                  </>
                )}
              </dl>
            )}
            <p className="mb-1 text-xs font-semibold">{gt("Context window")}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {usage === null
                ? extensionUsed === undefined
                  ? gt("Not reported")
                  : gt("{usedTokens} tokens used", { usedTokens: `≈${extensionUsed}` })
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
            {percent !== null && (
              <progress
                data-context-meter=""
                className="mt-1 w-full"
                max={100}
                value={percent}
                aria-label={gt("Context window")}
              />
            )}
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
              <details className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{gt("Diagnostics")}</summary>
                <p className="mt-2 break-words">{contextStatus}</p>
              </details>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { useGT, useLocale } from "gt-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  CirclePauseIcon,
  ListTodoIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { ComposerBanner } from "./ComposerBanner";

export interface ComposerThreadDashboardData {
  readonly threadKey: string;
  readonly usage: ContextWindowSnapshot | null;
  readonly steps: readonly OrchestrationV2PlanStep[] | null;
}

export function selectOmpTodoSteps(projection: Pick<ThreadStructure, "thread" | "plans">) {
  // OMP publishes a single full snapshot for this thread, replacing it even on a clear.
  const plan = projection.plans.find((plan) => plan.id === `omp-todo:${projection.thread.id}`);
  return plan?.kind === "todo_list" && plan.status !== "superseded" ? plan.steps : null;
}

export function ComposerThreadDashboard({
  usage,
  steps,
}: Omit<ComposerThreadDashboardData, "threadKey">) {
  const gt = useGT();
  const locale = useLocale();
  const percent = usage?.usedPercentage == null ? null : Math.round(usage.usedPercentage);
  const contextLabel = gt("Context", { $context: "context window row label" });
  const todoLabel = gt("To-do list");
  const checklist = [];
  let completed = 0;
  let runningTitle: string | undefined;
  for (const step of steps ?? []) {
    // OMP's projection puts the title first and encodes blocked/abandoned on the next line.
    const [title = step.text, note, ...rest] = step.text.split("\n");
    if (step.status === "pending" && note === "[abandoned]") continue;
    const blocked = step.status === "pending" && /^\[blocked\](?: |$)/.test(note ?? "");
    const details = [blocked ? note?.slice("[blocked]".length).trimStart() : note, ...rest];
    if (step.status === "completed") completed += 1;
    if (step.status === "running") runningTitle ??= title;
    checklist.push({ id: step.id, title, status: blocked ? "blocked" : step.status, details });
  }
  const total = checklist.length;
  const progress = gt("{completed}/{total} done", { completed, total });
  const tokenCount = usage?.usedTokens.toLocaleString(locale);
  const tokenLabel =
    tokenCount === undefined
      ? gt("Not reported")
      : gt("{usedTokens} tokens used", { usedTokens: tokenCount });

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root data-chat-composer-collapsed-controls="true">
        <div className="grid min-w-0 grid-cols-1 items-center gap-x-2 @sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 px-2 py-1 @sm:min-h-9">
            {percent === null ? (
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full border border-muted-foreground/45"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-3 shrink-0 place-items-center rounded-full text-primary forced-colors:border"
                style={{ background: `conic-gradient(currentColor ${percent}%, var(--border) 0)` }}
              >
                <span className="size-2 rounded-full bg-(--chat-composer-attached-surface)" />
              </span>
            )}
            <span className="font-medium">{contextLabel}</span>
            <span className="text-muted-foreground tabular-nums">{tokenLabel}</span>
            {percent !== null ? (
              <span className="font-medium tabular-nums">
                {gt("{used}% used", { used: percent })}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 border-t border-border/60 @sm:border-t-0 @sm:border-s">
            {total === 0 ? (
              <div className="flex min-h-11 items-center gap-2 px-2 @sm:min-h-9">
                <ListTodoIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium">{todoLabel}</span>
                <span className="text-muted-foreground">{gt("No to-dos yet")}</span>
              </div>
            ) : (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="compact"
                      className="group min-h-11 w-full min-w-0 justify-start @sm:min-h-9"
                    />
                  }
                >
                  <ListTodoIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="shrink-0 font-medium text-foreground">{todoLabel}</span>
                  <span className="shrink-0 tabular-nums">{progress}</span>
                  {runningTitle ? (
                    <span className="min-w-0 truncate text-start text-foreground">
                      {runningTitle}
                    </span>
                  ) : null}
                  <ChevronDownIcon
                    aria-hidden
                    className="ms-auto size-3 shrink-0 group-data-popup-open:rotate-180"
                  />
                </PopoverTrigger>
                <PopoverPopup side="top" align="end" width="md" padding="compact">
                  <div className="flex items-center justify-between gap-2 border-b pb-2">
                    <PopoverTitle>{todoLabel}</PopoverTitle>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {progress}
                    </span>
                  </div>
                  <ol className="divide-y divide-border/60">
                    {checklist.map(({ id, title, status, details }) => {
                      const Icon =
                        status === "completed"
                          ? CheckIcon
                          : status === "blocked"
                            ? CirclePauseIcon
                            : CircleIcon;
                      const label =
                        status === "completed"
                          ? gt("Completed")
                          : status === "running"
                            ? gt("In progress")
                            : status === "blocked"
                              ? gt("Blocked")
                              : gt("Pending");
                      return (
                        <li
                          key={id}
                          className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 py-2 text-xs"
                        >
                          <Icon
                            aria-hidden
                            className={
                              status === "running"
                                ? "mt-0.5 size-3.5 fill-current text-primary"
                                : "mt-0.5 size-3.5 text-muted-foreground"
                            }
                          />
                          <div className="min-w-0 wrap-anywhere">
                            <p className="font-medium">{title}</p>
                            <p className="text-muted-foreground">{label}</p>
                            {details.some(Boolean) ? (
                              <p className="whitespace-pre-wrap text-muted-foreground">
                                {details.filter(Boolean).join("\n")}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </PopoverPopup>
              </Popover>
            )}
          </div>
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}

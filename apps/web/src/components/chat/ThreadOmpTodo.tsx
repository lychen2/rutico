import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  CirclePauseIcon,
  ListTodoIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import "./threadOmpTodo.css";

export function withoutOmpTodoSnapshots(rows: readonly OrchestrationV2ProjectedTurnItem[]) {
  let retained: OrchestrationV2ProjectedTurnItem[] | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.item.type === "todo_list" && row.item.planId === `omp-todo:${row.item.threadId}`) {
      retained ??= rows.slice(0, index);
    } else {
      retained?.push(row);
    }
  }
  return retained ?? rows;
}

interface OmpTodoStep {
  readonly id: string;
  readonly title: string;
  readonly status: "completed" | "running" | "blocked" | "pending";
  readonly details: string;
}

interface OmpTodoProgress {
  readonly steps: readonly OmpTodoStep[];
  readonly completed: number;
  readonly currentTitle: string | undefined;
}

export function selectOmpTodo(projection: Pick<ThreadStructure, "thread" | "plans">) {
  // Each OMP update replaces the thread's sole snapshot, even when it clears the list.
  const planId = `omp-todo:${projection.thread.id}`;
  const plan = projection.plans.find((plan) => plan.id === planId);
  const steps: OmpTodoStep[] = [];
  let completed = 0;
  let runningTitle: string | undefined;
  let incompleteTitle: string | undefined;
  if (plan?.kind === "todo_list" && plan.status !== "superseded") {
    for (const step of plan.steps) {
      // The adapter encodes blocked and abandoned on the first detail line.
      const [title = step.text, note, ...rest] = step.text.split("\n");
      if (step.status === "pending" && note === "[abandoned]") continue;
      const blocked = step.status === "pending" && /^\[blocked\](?: |$)/.test(note ?? "");
      const details = [blocked ? note?.slice("[blocked]".length).trimStart() : note, ...rest]
        .filter(Boolean)
        .join("\n");
      if (step.status === "completed") completed += 1;
      else incompleteTitle ??= title;
      if (step.status === "running") runningTitle ??= title;
      steps.push({ id: step.id, title, status: blocked ? "blocked" : step.status, details });
    }
  }
  return { planId, steps, completed, currentTitle: runningTitle ?? incompleteTitle };
}

export function ThreadOmpTodo({ progress }: { readonly progress: OmpTodoProgress }) {
  const gt = useGT();
  const { steps, completed, currentTitle } = progress;
  const label = gt("To-do list");
  const title = currentTitle ?? gt("Completed");
  const titleRef = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ title: string; width: number } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Animate intrinsic label width after a task change without delaying the visible text.
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const width = element.getBoundingClientRect().width;
    const before = previous.current;
    previous.current = { title, width };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (before === null || before.title === title || before.width === width || preference.matches)
      return;
    const animation = element.animate([{ width: `${before.width}px` }, { width: `${width}px` }], {
      duration: 350,
      easing: "cubic-bezier(.3,1.35,.45,1)",
    });
    const cancel = () => animation.cancel();
    preference.addEventListener("change", cancel);
    return () => {
      preference.removeEventListener("change", cancel);
      cancel();
    };
  }, [title]);
  const statusLabels = {
    completed: gt("Completed"),
    running: gt("In progress"),
    blocked: gt("Blocked"),
    pending: gt("Pending"),
  };

  return (
    <section aria-label={label} className="relative z-20 mx-auto w-fit max-w-full">
      <Collapsible>
        <CollapsibleTrigger
          aria-label={[
            label,
            title,
            gt("{completed}/{total} done", { completed, total: steps.length }),
          ]
            .filter(Boolean)
            .join(" · ")}
          className="group flex min-h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-popover px-3 text-xs shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11"
        >
          {completed === steps.length ? (
            <CheckIcon
              aria-hidden
              data-todo-done-mark
              className="size-3.5 shrink-0 text-popover-foreground"
            />
          ) : (
            <ListTodoIcon aria-hidden className="size-3.5 shrink-0 text-popover-foreground" />
          )}
          <span ref={titleRef} className="min-w-0 max-w-64 truncate font-medium">
            <span key={title} data-todo-step-label>
              {title}
            </span>
          </span>
          {steps.length <= 8 ? (
            <span aria-hidden className="hidden shrink-0 gap-0.5 sm:flex">
              {steps.map(({ id, status }) => (
                <span
                  key={id}
                  className={cn(
                    "h-1 w-1.5 rounded-full",
                    status === "completed"
                      ? "bg-success"
                      : status === "running"
                        ? "bg-primary"
                        : status === "blocked"
                          ? "bg-warning"
                          : "bg-border",
                  )}
                />
              ))}
            </span>
          ) : null}
          <span className="shrink-0 font-medium tabular-nums">
            {completed}/{steps.length}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel className="absolute bottom-full left-1/2 mb-1 w-max max-w-[min(24rem,85vw)] -translate-x-1/2">
          <ol className="max-h-[45dvh] divide-y divide-border/60 overflow-y-auto rounded-xl border bg-popover px-3 text-popover-foreground shadow-lg">
            {steps.map(({ id, title, status, details }) => {
              const Icon =
                status === "completed"
                  ? CheckIcon
                  : status === "blocked"
                    ? CirclePauseIcon
                    : CircleIcon;
              return (
                <li key={id} className="flex items-start gap-2 py-2 text-xs">
                  <Icon
                    aria-hidden
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      status === "running" ? "fill-current text-primary" : "text-muted-foreground",
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-x-2 sm:flex-row sm:justify-between">
                    <div className="min-w-0 wrap-anywhere">
                      <p className="font-medium">{title}</p>
                      {details ? (
                        <p className="whitespace-pre-wrap text-muted-foreground">{details}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-muted-foreground">{statusLabels[status]}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}

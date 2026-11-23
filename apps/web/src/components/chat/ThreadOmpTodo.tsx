import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import "./threadOmpTodo.css";

export function withoutOmpTodoSnapshots(
  rows: readonly OrchestrationV2ProjectedTurnItem[],
  floatingTodoPlanId?: string,
) {
  let retained: OrchestrationV2ProjectedTurnItem[] | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (
      row.item.type === "todo_list" &&
      (row.item.planId === `omp-todo:${row.item.threadId}` ||
        row.item.planId === floatingTodoPlanId)
    ) {
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
  readonly current: OmpTodoStep | undefined;
}

export function selectOmpTodo(projection: Pick<ThreadStructure, "thread" | "plans">) {
  // Each OMP update replaces the thread's sole snapshot, even when it clears the list.
  const planId = `omp-todo:${projection.thread.id}`;
  const plan = projection.plans.find(
    (plan) => plan.id === planId && plan.threadId === projection.thread.id,
  );
  const steps: OmpTodoStep[] = [];
  let completed = 0;
  let running: OmpTodoStep | undefined;
  let incomplete: OmpTodoStep | undefined;
  if (plan?.kind === "todo_list" && plan.status !== "superseded") {
    for (const step of plan.steps) {
      // The adapter encodes blocked and abandoned on the first detail line.
      const [title = step.text, note, ...rest] = step.text.split("\n");
      if (step.status === "pending" && note === "[abandoned]") continue;
      const blocked = step.status === "pending" && /^\[blocked\](?: |$)/.test(note ?? "");
      const details = [blocked ? note?.slice("[blocked]".length).trimStart() : note, ...rest]
        .filter(Boolean)
        .join("\n");
      const entry = {
        id: step.id,
        title,
        status: blocked ? ("blocked" as const) : step.status,
        details,
      };
      if (entry.status === "completed") completed += 1;
      else incomplete ??= entry;
      if (entry.status === "running") running ??= entry;
      steps.push(entry);
    }
  }
  return { steps, completed, current: running ?? incomplete };
}

function rememberExpanded(storageKey: string, expanded: boolean) {
  try {
    localStorage.setItem(storageKey, String(expanded));
  } catch {
    // Storage can be disabled.
  }
}

function TodoMark({ mode, spinning }: { mode: string; spinning: boolean }) {
  return (
    <span data-omp-todo-mark data-mode={mode} aria-hidden>
      {mode === "done" ? (
        <CheckIcon size={10} strokeWidth={2.5} />
      ) : spinning ? (
        <svg
          ref={observeVisibleAnimation}
          className="motion-safe:visible-animate-spin"
          viewBox="0 0 16 16"
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeOpacity=".2"
          />
          <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : null}
    </span>
  );
}

function TodoStepRow({
  active,
  completed,
  visible,
  children,
}: {
  active: boolean;
  completed: boolean;
  visible: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const previous = useRef(completed);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Draw newly completed checks, not historical ones.
  useLayoutEffect(() => {
    const changed = previous.current !== completed;
    previous.current = completed;
    if (
      !changed ||
      !completed ||
      !visible ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const mark = ref.current?.querySelector("[data-omp-todo-mark] svg");
    const animation = mark?.animate(
      [
        { strokeDasharray: "24", strokeDashoffset: "24" },
        { strokeDasharray: "24", strokeDashoffset: "0" },
      ],
      { duration: 350, easing: "ease" },
    );
    return () => animation?.cancel();
  }, [completed, visible]);
  return (
    <li ref={ref} aria-current={active ? "step" : undefined}>
      {children}
    </li>
  );
}

export function ThreadOmpTodo({
  threadKey,
  progress,
}: {
  readonly threadKey: string;
  readonly progress: OmpTodoProgress;
}) {
  const gt = useGT();
  const { steps, completed, current } = progress;
  const done = completed === steps.length;
  const live = current?.status === "running";
  const mode = done ? "done" : live ? "run" : current?.status === "blocked" ? "need" : "idle";
  const storageKey = `t3code:task-trail-expanded:v1:${threadKey}`;
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === "true" || (saved !== "false" && !done);
    } catch {
      return !done;
    }
  });
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = gt("To-do list");
  const statusLabels = {
    completed: gt("Completed"),
    running: gt("In progress"),
    blocked: gt("Blocked"),
    pending: gt("Pending"),
  };
  const status = current ? statusLabels[current.status] : statusLabels.completed;
  const title = current?.title ?? statusLabels.completed;
  const titleRef = useRef<HTMLSpanElement>(null);
  const previousTitle = useRef(title);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Animate the changed step title once after DOM commit.
  useLayoutEffect(() => {
    const changed = previousTitle.current !== title;
    previousTitle.current = title;
    if (
      !changed ||
      !titleRef.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = titleRef.current.animate(
      [
        { opacity: 0, transform: "translateY(9px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 350, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [title]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the completed list visible briefly and cancel if work resumes.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => {
      setExpanded(false);
      rememberExpanded(storageKey, false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [done, storageKey]);

  return (
    <div className="mx-auto w-full max-w-(--chat-content-max-width) pb-1">
      <section aria-label={label} data-omp-todo data-mode={mode}>
        <button
          ref={triggerRef}
          type="button"
          data-omp-todo-bar
          aria-label={`${label} · ${title} · ${status} · ${completed}/${steps.length}`}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => {
            setExpanded(!expanded);
            rememberExpanded(storageKey, !expanded);
          }}
        >
          <TodoMark mode={mode} spinning={live && !expanded} />
          <span data-omp-todo-title>
            <span ref={titleRef} dir="auto">
              {title}
            </span>
          </span>
          <span data-omp-todo-segments aria-hidden>
            {steps.map((step) => (
              <i
                key={step.id}
                data-mode={
                  step.status === "completed" ? "done" : step === current ? mode : "pending"
                }
              />
            ))}
          </span>
          <span data-omp-todo-count>
            {completed}/{steps.length}
          </span>
          <ChevronDownIcon size={13} aria-hidden data-omp-todo-chevron />
        </button>
        <div
          id={listId}
          data-omp-todo-body
          data-expanded={expanded}
          inert={!expanded}
          aria-hidden={!expanded}
        >
          <div>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <strong>{label}</strong>
              <span data-omp-todo-count>
                {completed}/{steps.length}
              </span>
              <button
                type="button"
                className="ms-auto rounded-full bg-secondary px-2 py-1"
                onClick={() => {
                  triggerRef.current?.click();
                  triggerRef.current?.focus();
                }}
              >
                {gt("Collapse")}
              </button>
            </div>
            <ol data-omp-todo-list>
              {steps.map((step) => (
                <TodoStepRow
                  key={step.id}
                  active={step === current}
                  completed={step.status === "completed"}
                  visible={expanded}
                >
                  <div data-omp-todo-step>
                    <TodoMark
                      mode={
                        step.status === "completed"
                          ? "done"
                          : step.status === "blocked"
                            ? "need"
                            : step === current
                              ? mode
                              : "pending"
                      }
                      spinning={step === current && live && expanded}
                    />
                    <span data-omp-todo-step-title dir="auto">
                      {step.title}
                    </span>
                    <span data-omp-todo-status data-blocked={step.status === "blocked"}>
                      {statusLabels[step.status]}
                    </span>
                  </div>
                  {step.details ? (
                    <p data-omp-todo-details dir="auto">
                      {step.details}
                    </p>
                  ) : null}
                </TodoStepRow>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

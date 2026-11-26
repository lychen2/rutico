import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronUpIcon } from "lucide-react";

import { useGT } from "gt-react";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cancelFlip, captureFlipSnapshot, playFlipBatch, type FlipRect } from "~/lib/motion/flip";
import type { SpringConfig } from "~/lib/motion/springs";
import { AnimatedNumber } from "../ui/animated-number";
import type { AntigravityTaskTrail } from "./antigravityTaskTrail";
import styles from "./taskPlanCapsule.module.css";
import { TaskPlanStages, completedTitle } from "./TaskPlanStages";
import {
  capsuleMode,
  currentMilestoneIndex,
  deriveMilestones,
  type CapsuleMode,
  type Milestone,
} from "./taskMilestones";

/** How long the finished capsule stays before it fades; hover, focus or an open panel hold it. */
const DONE_LINGER_MS = 5000;
const FADE_OUT_MS = 200;
const TITLE_SWAP_MS = 300;
// Asymmetric spring physics: fluid expansion (~320/35) and crisper snap-shut (~520/38).
const CAPSULE_OPEN_SPRING: SpringConfig = { duration: 0.35, bounce: 0.02 };
const CAPSULE_CLOSE_SPRING: SpringConfig = { duration: 0.26, bounce: 0.04 };

export interface TaskPlanCapsuleProps {
  readonly progress: AntigravityTaskTrail;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  /** Called once the finished capsule has faded, or at once when the plan was already finished. */
  readonly onDismissed?: ((handoffRect?: FlipRect) => void) | undefined;
}

/** The step the capsule's wait belongs to: the running one, else the next, else the last. */
function waitingStepId(progress: AntigravityTaskTrail) {
  return (
    progress.steps.find((step) => step.status === "running")?.id ??
    progress.steps.find((step) => step.status === "pending")?.id ??
    progress.steps.at(-1)?.id
  );
}

function Ring({
  mode,
  percent,
  justCompleted,
}: {
  mode: CapsuleMode;
  percent: number;
  justCompleted: boolean;
}) {
  return (
    <svg
      className={styles["plan-ring"]}
      viewBox="0 0 18 18"
      data-mode={mode}
      data-just-completed={justCompleted ? "true" : undefined}
      style={{ "--plan-percent": percent } as CSSProperties}
      aria-hidden
    >
      <circle className={styles["plan-ring-bloom"]} cx="9" cy="9" r="8.5" />
      <circle className={styles["plan-ring-fill"]} cx="9" cy="9" r="9" />
      <circle className={styles["plan-ring-track"]} cx="9" cy="9" r="7.5" />
      <circle className={styles["plan-ring-dash"]} cx="9" cy="9" r="7.5" />
      <circle className={styles["plan-ring-arc"]} cx="9" cy="9" r="7.5" pathLength="100" />
      <path className={styles["plan-ring-check"]} d="M5.4 9.3l2.5 2.5 4.7-5" pathLength="100" />
      <path className={styles["plan-ring-alert"]} d="M9 5.2v4.4M9 12.3v.1" />
    </svg>
  );
}

export function TaskPlanCapsule({ progress, onOpenFile, onDismissed }: TaskPlanCapsuleProps) {
  const gt = useGT();
  const panelId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFlipRef = useRef<{
    readonly card: FlipRect;
    readonly shadow: FlipRect | null;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const setOpenWithFlip = useStableCallback((nextOpen: boolean) => {
    const card = cardRef.current;
    if (card) {
      const shadow = shadowRef.current;
      pendingFlipRef.current = {
        card: captureFlipSnapshot(card),
        shadow: shadow ? captureFlipSnapshot(shadow) : null,
      };
    }
    setOpen(nextOpen);
  });
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [fading, setFading] = useState(false);
  const [hintKey, setHintKey] = useState(0);
  const { complete, waiting } = progress;
  const needStep = progress.blockedStepId ?? (waiting ? waitingStepId(progress) : undefined);
  const milestones = deriveMilestones({
    steps: progress.steps,
    activities: progress.activities,
    waitingStepId: needStep,
  });
  const mode = capsuleMode(milestones, {
    waiting,
    complete,
    failed: progress.failed,
  });
  const [previousMode, setPreviousMode] = useState(mode);
  const [justCompleted, setJustCompleted] = useState(false);
  if (previousMode !== mode) {
    setPreviousMode(mode);
    setJustCompleted(previousMode !== "done" && mode === "done");
  }
  const dismissHandoffRectRef = useRef<FlipRect | undefined>(undefined);
  const liveFallback = progress.planId === undefined;
  const currentIndex = currentMilestoneIndex(milestones);
  const current: Milestone | undefined = milestones[currentIndex];
  const finished = milestones.filter((milestone) => milestone.status === "done").length;
  const percent = milestones.length === 0 ? 0 : Math.round((finished / milestones.length) * 100);
  const completedFallbackOps = liveFallback
    ? milestones
        .filter((milestone) => milestone.status === "done")
        .reduce((sum, milestone) => sum + milestone.operations.length, 0)
    : 0;
  const title = complete
    ? completedTitle(milestones.length, progress.durationMs, gt)
    : progress.liveIntent !== undefined
      ? liveFallback && completedFallbackOps > 0
        ? `${progress.liveIntent} · ${gt("{count} calls completed", { count: completedFallbackOps })}`
        : progress.liveIntent
      : liveFallback && completedFallbackOps > 0 && current
        ? `${current.name} · ${gt("{count} calls completed", { count: completedFallbackOps })}`
        : (current?.name ?? gt("Task steps"));
  const pill =
    mode === "need" ? gt("Needs confirmation") : mode === "problem" ? gt("Problem") : null;

  // The old title slides out while the new one slides in; one timer clears the old one.
  const [shownTitle, setShownTitle] = useState(title);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  if (shownTitle !== title) {
    setOutgoing(shownTitle);
    setShownTitle(title);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- One timeout removes the outgoing title after its exit animation.
  useEffect(() => {
    if (outgoing === null) return;
    const timer = window.setTimeout(() => setOutgoing(null), TITLE_SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  // A wait or a problem pulses once. A wait opens the panel unless the user is typing.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the focused element once when attention is first needed.
  useEffect(() => {
    if (mode !== "need" && mode !== "problem") return;
    // oxlint-disable-next-line react/set-state-in-effect -- Only the rising edge into a wait or problem pulses, and the focus check reads the document.
    setHintKey((key) => key + 1);
    if (mode !== "need") return;
    const typing = document.activeElement?.closest("[data-chat-composer-form]") != null;
    if (typing) return;
    setOpenWithFlip(true);
    const waitingMilestone = milestones.find((milestone) => milestone.status === "need");
    if (waitingMilestone) setOpenStage(waitingMilestone.id);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Milestones change on every progress tick; only a change of mode counts.
  }, [mode]);

  // Esc and a press outside both fold the panel.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Document listeners exist only while the panel is open.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const inside = root?.contains(document.activeElement) ?? false;
      setOpenWithFlip(false);
      if (inside) barRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && root && !root.contains(event.target)) {
        setOpenWithFlip(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpenWithFlip]);

  // Interruptible single-shell GPU FLIP morph between collapsed and expanded widths (zero width reflow transition).
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays batched WAAPI FLIP from the pre-toggle snapshot before paint
  useLayoutEffect(() => {
    const pending = pendingFlipRef.current;
    pendingFlipRef.current = null;
    const card = cardRef.current;
    if (!pending || !card) return;
    const inverseChildren = [barRef.current, panelBodyRef.current].filter(
      (element): element is HTMLButtonElement | HTMLDivElement => element !== null,
    );
    const preset = open ? CAPSULE_OPEN_SPRING : CAPSULE_CLOSE_SPRING;
    const entries = [
      {
        element: card,
        first: pending.card,
        options: {
          scale: true,
          preset,
          inverseScaleChildren: inverseChildren,
        },
      },
      ...(shadowRef.current && pending.shadow
        ? [
            {
              element: shadowRef.current,
              first: pending.shadow,
              options: { scale: true, preset },
            },
          ]
        : []),
    ];
    playFlipBatch(entries);
    return () => {
      cancelFlip(card);
      if (shadowRef.current) cancelFlip(shadowRef.current);
    };
  }, [open]);

  // Bring the stage that holds attention into view whenever the panel opens.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scrolls the panel's own list after it is laid out.
  useLayoutEffect(() => {
    const list = scrollRef.current;
    const row = list?.querySelector('[data-current="true"]');
    if (!open || !list || !row) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += top - 8;
  }, [open]);

  // A finished plan lingers, then fades; one that was finished before this view opened never shows.
  const [startedComplete] = useState(complete);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- An already finished plan is dismissed before paint.
  useLayoutEffect(() => {
    if (startedComplete) onDismissed?.();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Only the first render decides whether the plan was already finished.
  }, []);
  if (!complete && fading) setFading(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- One timeout starts the fade of a finished plan after capturing its FLIP handoff rect.
  useEffect(() => {
    if (!complete || startedComplete || holding || open) return;
    const timer = window.setTimeout(() => {
      dismissHandoffRectRef.current = cardRef.current
        ? captureFlipSnapshot(cardRef.current)
        : undefined;
      setFading(true);
    }, DONE_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [complete, startedComplete, holding, open]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- One timeout hands over to the history summary once the fade ends.
  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => {
      const handoffRect = dismissHandoffRectRef.current;
      dismissHandoffRectRef.current = undefined;
      onDismissed?.(handoffRect);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [fading, onDismissed]);

  const barLabel = liveFallback
    ? [title, pill].filter((part) => part !== null).join(" · ")
    : [title, pill, `${finished}/${milestones.length}`].filter((part) => part !== null).join(" · ");

  return (
    <section
      ref={rootRef}
      aria-label={gt("Task progress")}
      className={styles["plan-capsule"]}
      data-plan-capsule={mode}
      data-mode={mode}
      data-open={open}
      data-fallback={liveFallback || undefined}
      data-visible={!(fading && complete)}
      inert={fading && complete}
      onPointerEnter={() => setHolding(true)}
      onPointerLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHolding(false);
      }}
    >
      <div ref={shadowRef} className={styles["plan-shadow"]} aria-hidden />
      <div ref={cardRef} className={styles["plan-card"]} data-plan-card-mode={mode}>
        <span key={hintKey} className={styles["plan-hint"]} data-hint={hintKey > 0} aria-hidden />
        <div className={styles["plan-panel"]}>
          <div className={styles["plan-panel-clip"]}>
            <div
              ref={panelBodyRef}
              id={panelId}
              className={styles["plan-panel-body"]}
              role="region"
              inert={!open}
              aria-label={liveFallback ? gt("Live execution") : gt("Task plan")}
            >
              <div className={styles["plan-panel-head"]}>
                {liveFallback ? (
                  <>
                    <strong>{gt("Live execution")}</strong>
                    <span className={styles["plan-head-badge"]} data-tone="info">
                      {gt("No multi-stage plan")}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>{gt("Task plan")}</strong>
                    <span className={styles["plan-head-meta"]}>
                      {gt("{done}/{total} stages", {
                        done: finished,
                        total: milestones.length,
                      })}
                    </span>
                    <span className={styles["plan-head-badge"]} data-tone="ok">
                      {gt("Click stage for details")}
                    </span>
                  </>
                )}
                <span className={styles["plan-panel-spacer"]} />
                <button
                  type="button"
                  className={styles["plan-collapse-btn"]}
                  onClick={() => setOpenWithFlip(false)}
                >
                  {gt("Collapse")}
                </button>
                <kbd className={styles["plan-esc-kbd"]}>esc</kbd>
              </div>
              <div ref={scrollRef} className={styles["plan-panel-scroll"]}>
                <TaskPlanStages
                  milestones={milestones}
                  currentIndex={currentIndex}
                  openId={openStage}
                  onToggle={(id) => setOpenStage(openStage === id ? null : id)}
                  onOpenFile={onOpenFile}
                  label={gt("Reported task steps")}
                  liveFallback={liveFallback}
                />
              </div>
            </div>
          </div>
        </div>
        <button
          ref={barRef}
          type="button"
          data-plan-bar="true"
          className={styles["plan-bar"]}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={barLabel}
          onClick={() => setOpenWithFlip(!open)}
        >
          <Ring mode={mode} percent={complete ? 100 : percent} justCompleted={justCompleted} />
          <span className={styles["plan-bar-ico"]} data-mode={mode} aria-hidden>
            {mode === "done" ? (
              <svg viewBox="0 0 16 16">
                <path d="M3.6 8.4l3 3 5.8-6.2" />
              </svg>
            ) : null}
          </span>
          <span className={styles["plan-title"]} data-swapping={outgoing !== null}>
            {outgoing === null ? null : (
              <span key={outgoing} className={styles["plan-title-out"]} aria-hidden>
                {outgoing}
              </span>
            )}
            <span key={title} className={styles["plan-title-in"]}>
              {title}
            </span>
          </span>
          {pill === null ? null : (
            <span className={styles["plan-pill"]} data-tone={mode === "problem" ? "problem" : mode}>
              {pill}
            </span>
          )}
          {liveFallback ? null : (
            <>
              <span className={styles["plan-segments"]} aria-hidden>
                {milestones.map((milestone) => (
                  <i key={milestone.id} data-status={milestone.status} />
                ))}
              </span>
              <span className={styles["plan-count"]}>
                <AnimatedNumber value={complete ? milestones.length : finished} />/
                {milestones.length}
              </span>
            </>
          )}
          <ChevronUpIcon className={styles["plan-chevron"]} aria-hidden />
        </button>
      </div>
    </section>
  );
}

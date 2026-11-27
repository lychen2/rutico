import { useId, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { useGT } from "gt-react";
import { cancelFlip, playFlip, type FlipRect } from "~/lib/motion/flip";
import type { AntigravityTaskTrail } from "./antigravityTaskTrail";
import { TaskPlanStages, completedTitle } from "./TaskPlanStages";
import { currentMilestoneIndex, deriveMilestones } from "./taskMilestones";
import styles from "./taskPlanCapsule.module.css";

/** What the floating capsule leaves in the conversation once it has faded: one row to reopen. */
export function TaskPlanSummary({
  progress,
  onOpenFile,
  consumeHandoffRect,
}: {
  readonly progress: AntigravityTaskTrail;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly consumeHandoffRect?: (() => FlipRect | null) | undefined;
}) {
  const gt = useGT();
  const bodyId = useId();
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const milestones = deriveMilestones({
    steps: progress.steps,
    activities: progress.activities,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lands the retiring floating TaskPlanCapsule into this inline history card via one-shot WAAPI FLIP
  useLayoutEffect(() => {
    const element = summaryRef.current;
    const first = consumeHandoffRect?.();
    if (!element || !first) return;
    playFlip(element, first, { scale: false, preset: "spatial" });
    return () => cancelFlip(element);
  }, [consumeHandoffRect]);

  return (
    <div className="chat-content-lane pb-3" data-task-plan-summary="true">
      <section
        ref={summaryRef}
        aria-label={gt("Task progress")}
        className={styles["plan-summary"]}
        data-open={open}
      >
        <button
          type="button"
          className={styles["plan-summary-bar"]}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className={styles["plan-summary-check"]} aria-hidden>
            <CheckIcon />
          </span>
          <span className={styles["plan-summary-title"]}>
            {completedTitle(milestones.length, progress.durationMs, gt)}
          </span>
          <ChevronDownIcon className={styles["plan-summary-chevron"]} aria-hidden />
        </button>
        <div id={bodyId} className={styles["plan-summary-body"]} inert={!open}>
          <div className={styles["plan-summary-clip"]}>
            <div className={styles["plan-summary-scroll"]}>
              <TaskPlanStages
                milestones={milestones}
                currentIndex={currentMilestoneIndex(milestones)}
                openId={openStage}
                onToggle={(id) => setOpenStage(openStage === id ? null : id)}
                onOpenFile={onOpenFile}
                label={
                  progress.planId === undefined ? gt("Live execution") : gt("Reported task steps")
                }
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

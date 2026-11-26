import type { PullRequestReviewGuideStop } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { useRef } from "react";

import { useSharedIndicator } from "~/lib/motion/useSharedIndicator";
import { cn } from "~/lib/utils";
import "~/styles/workspace-hubs.css";

import { Badge } from "../../ui/badge";
import { stopSubline } from "@t3tools/client-runtime/review-guide-tour";

const PROGRESS_RING_RADIUS = 6;
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS;

export function GuideRail({
  stops,
  position,
  seen,
  onSelect,
}: {
  stops: ReadonlyArray<PullRequestReviewGuideStop>;
  position: number;
  seen: ReadonlySet<number>;
  onSelect: (position: number) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const listRef = useRef<HTMLOListElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const reviewed = seen.size;
  const total = stops.length;
  const isAllReviewed =
    total > 0 && (reviewed >= total || (position === total - 1 && reviewed >= total - 1));
  const progressRatio = total > 0 ? Math.min(1, (isAllReviewed ? total : reviewed) / total) : 0;

  useSharedIndicator({
    containerRef: listRef,
    indicatorRef,
    activeSelector: 'button[aria-current="step"]',
    activeKey: position,
    preset: "fluid",
    axis: "y",
  });

  const renderStop = (stop: PullRequestReviewGuideStop, index: number) => {
    const isLast = index === stops.length - 1;
    const isSeen = seen.has(index);
    const isActive = position === index;
    const isSegmentCompleted = isSeen || index < position;
    return (
      <li key={index} className="relative z-1">
        {!isLast ? (
          <span
            aria-hidden="true"
            data-slot="guide-rail-spine"
            className={cn(
              "pointer-events-none absolute top-6 bottom-[-0.375rem] left-[1.09375rem] w-px transition-colors duration-200 motion-reduce:transition-none",
              isSegmentCompleted ? "bg-success/45" : "bg-border/75",
            )}
          />
        ) : null}
        <RailRow
          active={isActive}
          onClick={() => onSelect(index)}
          lead={<StopBullet number={index + 1} seen={isSeen} active={isActive} />}
          title={stop.title}
          detail={
            <>
              {stop.attention !== null ? (
                <Badge size="sm" variant="warning">
                  <T>Look closely</T>
                </Badge>
              ) : null}
              <span>{stopSubline(stop, messages)}</span>
            </>
          }
        />
      </li>
    );
  };

  return (
    <nav aria-label={gt("Review tour")} className="flex min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums @max-[56rem]/guide:hidden">
        <span
          data-slot="guide-progress-ring"
          data-complete={isAllReviewed ? "true" : undefined}
          className="relative inline-flex size-4 shrink-0 items-center justify-center"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 -rotate-90 overflow-visible"
          >
            <circle
              cx="8"
              cy="8"
              r={PROGRESS_RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="text-border/80"
            />
            <circle
              cx="8"
              cy="8"
              r={PROGRESS_RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeDasharray={PROGRESS_RING_CIRCUMFERENCE}
              strokeDashoffset={PROGRESS_RING_CIRCUMFERENCE * (1 - progressRatio)}
              className={cn(
                "transition-[stroke-dashoffset,color] duration-(--duration-fluid) ease-(--spring-fluid) motion-reduce:transition-none",
                isAllReviewed ? "text-success" : "text-primary",
              )}
            />
          </svg>
        </span>
        <p>
          {gt(
            "{total, plural, one {{reviewed} of {total} read} other {{reviewed} of {total} read}}",
            { reviewed, total },
          )}
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <ol ref={listRef} className="relative flex flex-col gap-0.5">
          <div ref={indicatorRef} aria-hidden="true" data-slot="guide-rail-indicator" />
          {stops.map(renderStop)}
        </ol>
      </div>
    </nav>
  );
}

function RailRow({
  active,
  onClick,
  lead,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  lead: React.ReactNode;
  title: string;
  detail: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "step" : undefined}
      onClick={onClick}
      className={cn(
        "relative z-1 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none",
        active ? "text-accent-foreground" : "hover:bg-accent/45",
      )}
    >
      {lead}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-sm text-foreground", active && "font-medium")}>{title}</span>
        {detail !== null ? (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function StopBullet({ number, seen, active }: { number: number; seen: boolean; active: boolean }) {
  const gt = useGT();
  return (
    <span
      data-slot="guide-rail-bullet"
      data-seen={seen ? "true" : undefined}
      data-active={active ? "true" : undefined}
      className={cn(
        "relative z-1 flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-2xs tabular-nums transition-[border-color,background-color,color,transform] duration-180 ease-(--spring-snappy) motion-reduce:transition-none",
        seen
          ? "border-success/55 bg-success/10 text-success-foreground"
          : active
            ? "border-primary/70 bg-primary/10 text-foreground"
            : "border-border text-muted-foreground",
      )}
    >
      {seen ? (
        <svg
          role="img"
          aria-label={gt("Stop {number}, read", { number })}
          viewBox="0 0 12 12"
          fill="none"
          className="size-3"
        >
          <path
            data-slot="guide-rail-check-path"
            d="M2.5 6.3 5 8.7 9.6 3.5"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        number
      )}
    </span>
  );
}

import { useMessages } from "gt-react";
import { type CSSProperties, type ReactNode } from "react";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

export const MESSAGE_HEADING_LEVEL = 3;

type DotMatrixPhase = "preparing" | "thinking" | "tooling" | "compacting";

const DOT_MATRIX_COORDS = [2.5, 6.17, 9.83, 13.5] as const;
const DOT_MATRIX_CELLS = [0, 1, 2, 3].flatMap((row) =>
  [0, 1, 2, 3].map((col) => ({
    row,
    col,
    cx: DOT_MATRIX_COORDS[col]!,
    cy: DOT_MATRIX_COORDS[row]!,
  })),
);

export function resolveDotMatrixPhase(rawPhase: string): DotMatrixPhase {
  if (rawPhase === "preparing" || rawPhase === "starting") return "preparing";
  if (rawPhase === "compacting") return "compacting";
  if (rawPhase === "thinking" || rawPhase === "reasoning") return "thinking";
  return "tooling";
}

export function dotMatrixPhaseDelayRatio(row: number, col: number, phase: DotMatrixPhase): number {
  const dx = col - 1.5;
  const dy = row - 1.5;
  const dist = Math.hypot(dx, dy);
  const maxDist = Math.SQRT2 * 1.5;
  switch (phase) {
    case "preparing":
      return (row + col) / 6;
    case "thinking":
      return dist / maxDist;
    case "compacting":
      return 1 - dist / maxDist;
    case "tooling": {
      const angle = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      return (angle * 2) % 1;
    }
  }
}

export function DotMatrixWorkingIndicator({
  phase,
  className,
}: {
  readonly phase: string;
  readonly className?: string;
}) {
  const resolvedPhase = resolveDotMatrixPhase(phase);
  const cycleMs = resolvedPhase === "compacting" ? 1100 : resolvedPhase === "tooling" ? 1250 : 1450;
  return (
    <svg
      ref={observeVisibleAnimation}
      aria-hidden="true"
      viewBox="0 0 16 16"
      data-dot-matrix-indicator="true"
      data-dot-matrix-phase={resolvedPhase}
      style={{ "--dm-cycle": `${cycleMs}ms` } as CSSProperties}
      className={cn("size-3.5 shrink-0 text-info", className)}
    >
      {DOT_MATRIX_CELLS.map(({ row, col, cx, cy }) => {
        const ratio = dotMatrixPhaseDelayRatio(row, col, resolvedPhase);
        const delayMs = -Math.round(ratio * cycleMs);
        const isCore = row >= 1 && row <= 2 && col >= 1 && col <= 2;
        return (
          <circle
            key={`${row}-${col}`}
            cx={cx}
            cy={cy}
            r="1.08"
            fill="currentColor"
            data-dm-dot="true"
            data-dm-core={isCore ? "true" : undefined}
            style={{ "--dm-delay": `${delayMs}ms` } as CSSProperties}
          />
        );
      })}
    </svg>
  );
}

export function MessageAuthorHeading({ children }: { children: string }) {
  return <h3 className="sr-only select-none">{children}</h3>;
}

export function TimelineRowTimestamp({
  createdAt,
  timestampFormat,
  className,
  alwaysVisible = false,
}: {
  createdAt: string;
  timestampFormat: TimestampFormat;
  className?: string;
  alwaysVisible?: boolean;
}) {
  const m = useMessages();
  return (
    <SharedTooltipTrigger
      render={
        <span
          className={cn(
            "pointer-events-none absolute me-1 shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100 group-focus-within/timeline-row:pointer-events-auto group-focus-within/timeline-row:static group-focus-within/timeline-row:opacity-100",
            alwaysVisible && "pointer-events-auto static opacity-100",
            className,
          )}
        />
      }
      label={formatChatTimestampTooltip(createdAt, timestampFormat, m)}
    >
      {formatDayAwareTimestamp(createdAt, timestampFormat, undefined, undefined, m)}
    </SharedTooltipTrigger>
  );
}

export function ActivityShimmerOverlay({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className="live-activity-focus pointer-events-none absolute inset-y-0 select-none"
    >
      <span className="live-activity-focus-counter block">
        <span className={cn("live-activity-focus-aligned block text-foreground", className)}>
          {children}
        </span>
      </span>
    </span>
  );
}

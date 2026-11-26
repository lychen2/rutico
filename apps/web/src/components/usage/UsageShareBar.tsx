import { useUiText } from "~/i18n/useUiText";
import { formatPercent } from "@t3tools/shared/usageFormat";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ShareSegment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export function UsageShareBar({
  label,
  segments,
  format,
  aside,
}: {
  readonly label: string;
  readonly segments: readonly ShareSegment[];
  readonly format: (value: number) => string;
  readonly aside?: ReactNode;
}) {
  const uiText = useUiText();
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5" onMouseLeave={() => setHoveredLabel(null)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{uiText(label)}</h3>
        {aside}
      </div>
      {/* The legend below carries every figure; the bar's tooltips are pointer-only. */}
      <div aria-hidden className="flex h-2 gap-0.5">
        {visible.map((segment) => {
          const segmentKey = uiText(segment.label);
          const isHovered = hoveredLabel === segmentKey;
          const isDimmed = hoveredLabel !== null && !isHovered;
          return (
            <Tooltip key={segmentKey}>
              <TooltipTrigger
                render={
                  <div
                    onMouseEnter={() => setHoveredLabel(segmentKey)}
                    className={cn(
                      "h-full min-w-1 rounded-xs transition-[flex-grow,opacity,transform] duration-(--duration-fluid) ease-(--spring-fluid) first:rounded-l-full last:rounded-r-full motion-reduce:transition-none",
                      isHovered && "scale-y-125",
                      isDimmed && "opacity-40",
                    )}
                    style={{ flex: `${segment.value} 1 0`, backgroundColor: segment.color }}
                  />
                }
              />
              <TooltipPopup>
                {segmentKey} · {format(segment.value)} · {formatPercent(segment.value / total)}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
      <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {visible.map((segment) => {
          const segmentKey = uiText(segment.label);
          const isHovered = hoveredLabel === segmentKey;
          const isDimmed = hoveredLabel !== null && !isHovered;
          return (
            <li
              key={segmentKey}
              onMouseEnter={() => setHoveredLabel(segmentKey)}
              className={cn(
                "flex items-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none",
                isDimmed && "opacity-45",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-xs transition-transform duration-150 motion-reduce:transition-none",
                  isHovered && "scale-125",
                )}
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-muted-foreground">{segmentKey}</span>{" "}
              <span className="text-foreground tabular-nums">{format(segment.value)}</span>
              <span className="sr-only">, {formatPercent(segment.value / total)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

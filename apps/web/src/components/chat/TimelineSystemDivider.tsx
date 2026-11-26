import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

interface CompactTokenMetric {
  readonly numericTotal: number;
  readonly displayValue: number;
  readonly suffix: string;
  readonly decimals: number;
}

const TOKEN_UNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  "": 1,
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

/** Parse formatted token strings like `128k`, `1.4M`, or `850` for squeeze-bar ratios. */
export function parseCompactTokenMetric(raw: string): CompactTokenMetric | null {
  const match = raw
    .trim()
    .replaceAll(",", "")
    .match(/^(\d+(?:\.\d+)?)\s*([kKmMbB]?)$/);
  if (!match) return null;
  const numPart = match[1]!;
  const suffix = match[2] ?? "";
  const displayValue = Number.parseFloat(numPart);
  if (!Number.isFinite(displayValue) || displayValue < 0) return null;
  const multiplier = TOKEN_UNIT_MULTIPLIERS[suffix.toLowerCase()];
  if (multiplier === undefined) return null;
  const dotIndex = numPart.indexOf(".");
  return {
    numericTotal: displayValue * multiplier,
    displayValue,
    suffix,
    decimals: dotIndex === -1 ? 0 : numPart.length - dotIndex - 1,
  };
}

export function resolveCompactionRatio(before: string, after: string): number | null {
  const beforeMetric = parseCompactTokenMetric(before);
  const afterMetric = parseCompactTokenMetric(after);
  if (!beforeMetric || !afterMetric || beforeMetric.numericTotal <= 0) return null;
  return Math.max(0.08, Math.min(1, afterMetric.numericTotal / beforeMetric.numericTotal));
}

export function TimelineSystemDivider(props: {
  readonly label: ReactNode;
  readonly detail?: ReactNode | null;
  readonly variant?: "milestone" | "action" | "danger";
  readonly tone?: "neutral" | "danger";
  readonly icon?: LucideIcon;
  readonly showDetailSeparator?: boolean;
  readonly wrapDetail?: boolean;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  const Icon = props.icon;
  const variant =
    props.variant ?? (props.tone === "danger" ? "danger" : props.onAction ? "action" : "milestone");
  const isDanger = variant === "danger" || props.tone === "danger";
  const content = (
    <>
      <span
        className={cn(
          "inline-flex items-baseline gap-1.5 align-baseline font-medium",
          props.wrapDetail && "shrink-0 whitespace-nowrap",
        )}
      >
        {Icon ? <Icon className="size-3 shrink-0 self-center" /> : null}
        {props.label}
      </span>
      {props.detail ? (
        <span
          className={cn(
            "min-w-0 opacity-75",
            props.wrapDetail ? "ml-1.5 wrap-anywhere" : "inline-flex items-center",
            typeof props.detail === "string" &&
              (props.wrapDetail ? "whitespace-pre-wrap" : "max-w-80 truncate"),
          )}
        >
          {props.showDetailSeparator === false ? null : "·\u00a0"}
          {props.detail}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      data-system-divider={variant}
      className={cn(
        "flex min-w-0 items-center gap-2.5 py-2 text-2xs text-muted-foreground",
        isDanger && "text-destructive",
      )}
    >
      <span
        aria-hidden="true"
        data-divider-wing="start"
        data-divider-tone={isDanger ? "danger" : "neutral"}
        className="h-px flex-1"
      />
      {props.onAction ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={props.actionLabel}
                onClick={props.onAction}
                data-system-divider-capsule={variant}
                className={cn(
                  "min-w-0 cursor-pointer rounded-full border bg-card/90 px-2.5 py-1 shadow-xs transition-[background-color,border-color,color,transform] duration-150 ease-out hover:-translate-y-px hover:border-foreground/22 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 active:translate-y-0 active:scale-[0.975] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
                  isDanger ? "border-destructive/35 bg-destructive/6" : "border-border/75",
                  props.wrapDetail ? "text-center" : "flex items-center gap-1.5",
                )}
              />
            }
          >
            {content}
          </TooltipTrigger>
          <TooltipPopup side="top">{props.actionLabel}</TooltipPopup>
        </Tooltip>
      ) : (
        <span
          data-system-divider-capsule={variant}
          className={cn(
            "min-w-0 rounded-full border px-2.5 py-1 shadow-xs",
            isDanger ? "border-destructive/30 bg-destructive/6" : "border-border/65 bg-card/85",
            props.wrapDetail ? "text-center" : "flex flex-wrap items-center justify-center gap-1.5",
          )}
        >
          {content}
        </span>
      )}
      <span
        aria-hidden="true"
        data-divider-wing="end"
        data-divider-tone={isDanger ? "danger" : "neutral"}
        className="h-px flex-1"
      />
    </div>
  );
}

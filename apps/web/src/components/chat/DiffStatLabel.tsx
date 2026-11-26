import { useGT } from "gt-react";
import { memo } from "react";
import { cn } from "~/lib/utils";

export function formatCompactDiffCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 999_500) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  if (value < 999_500_000) {
    const m = value / 1_000_000;
    return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
  }
  const b = value / 1_000_000_000;
  return `${b < 10 ? b.toFixed(1).replace(/\.0$/, "") : Math.round(b)}b`;
}

function resolveHeatBlockCounts(
  additions: number,
  deletions: number,
  totalBlocks = 5,
): {
  readonly added: number;
  readonly deleted: number;
  readonly neutral: number;
} {
  const safeAdd = Math.max(0, additions);
  const safeDel = Math.max(0, deletions);
  const total = safeAdd + safeDel;
  if (total === 0) {
    return { added: 0, deleted: 0, neutral: totalBlocks };
  }
  let added = Math.round((safeAdd / total) * totalBlocks);
  let deleted = Math.round((safeDel / total) * totalBlocks);
  if (safeAdd > 0 && added === 0) added = 1;
  if (safeDel > 0 && deleted === 0) deleted = 1;
  while (added + deleted > totalBlocks) {
    if (added >= deleted && added > 1) added -= 1;
    else if (deleted > 1) deleted -= 1;
    else break;
  }
  const neutral = Math.max(0, totalBlocks - added - deleted);
  return { added, deleted, neutral };
}

export const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  className?: string;
  layout?: "aligned" | "inline";
  showHeatBlocks?: boolean;
}) {
  const { additions, deletions, className, layout = "aligned", showHeatBlocks = false } = props;
  const gt = useGT();
  const heatBlocks = showHeatBlocks ? resolveHeatBlockCounts(additions, deletions) : null;
  return (
    <span
      role="group"
      aria-label={gt("{additions} additions, {deletions} deletions", { additions, deletions })}
      className={cn(
        layout === "inline"
          ? "inline-flex items-center gap-1 tabular-nums align-middle"
          : "inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle",
        className,
      )}
    >
      <span aria-hidden="true" className="font-mono text-diff-addition-foreground">
        +{formatCompactDiffCount(additions)}
      </span>
      <span aria-hidden="true" className="font-mono text-diff-deletion-foreground">
        -{formatCompactDiffCount(deletions)}
      </span>
      {heatBlocks ? (
        <span
          aria-hidden="true"
          data-slot="diff-stat-heat-blocks"
          className="ml-0.5 inline-flex items-center gap-0.5"
        >
          {Array.from({ length: heatBlocks.added }, (_, index) => (
            <span
              key={`a-${index}`}
              className="h-1.5 w-1 rounded-xs bg-diff-addition-foreground/85"
            />
          ))}
          {Array.from({ length: heatBlocks.deleted }, (_, index) => (
            <span
              key={`d-${index}`}
              className="h-1.5 w-1 rounded-xs bg-diff-deletion-foreground/85"
            />
          ))}
          {Array.from({ length: heatBlocks.neutral }, (_, index) => (
            <span key={`n-${index}`} className="h-1.5 w-1 rounded-xs bg-muted-foreground/25" />
          ))}
        </span>
      ) : null}
    </span>
  );
});

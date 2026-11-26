import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import type { PullRequestChangeBreakdown } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";

const KIND_LABELS = {
  code: msg("Code", { $context: "kind of changed file" }),
  tests: msg("Tests", { $context: "kind of changed file" }),
  mocks: msg("Mocks", { $context: "kind of changed file" }),
  generated: msg("Generated", { $context: "kind of changed file" }),
  docs: msg("Docs", { $context: "kind of changed file" }),
} satisfies Record<keyof NonNullable<PullRequestChangeBreakdown>, string>;

type DiffTotals = { additions: number; deletions: number };

export function ChangeBreakdownGrid({
  breakdown,
  total,
}: {
  breakdown: NonNullable<PullRequestChangeBreakdown>;
  total?: DiffTotals;
}) {
  const gt = useGT();
  const m = useMessages();
  const rows = (Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>)
    .map((kind) => ({
      kind,
      label: m(KIND_LABELS[kind]),
      additions: breakdown[kind].additions,
      deletions: breakdown[kind].deletions,
    }))
    .filter((row) => row.additions > 0 || row.deletions > 0);
  const maxRowTotal = Math.max(1, ...rows.map((row) => row.additions + row.deletions));
  const totalLines = total ? Math.max(1, total.additions + total.deletions) : maxRowTotal;

  return (
    <div className="grid grid-cols-[auto_auto_auto_minmax(3.75rem,5.5rem)] items-center justify-start gap-x-3.5 gap-y-1 py-0.5 font-mono tabular-nums">
      {rows.map((row) => (
        <BreakdownRow
          key={row.kind}
          label={row.label}
          additions={row.additions}
          deletions={row.deletions}
          maxScale={maxRowTotal}
        />
      ))}
      {total ? (
        <>
          <div className="col-span-4 border-t border-border" />
          <BreakdownRow
            label={gt("Total", { $context: "sum of changed lines" })}
            additions={total.additions}
            deletions={total.deletions}
            maxScale={totalLines}
          />
        </>
      ) : null}
    </div>
  );
}

function BreakdownRow({
  label,
  additions,
  deletions,
  maxScale,
}: DiffTotals & { label: string; maxScale: number }) {
  const sum = additions + deletions;
  const barScale = maxScale > 0 ? Math.min(1, Math.max(sum > 0 ? 0.08 : 0, sum / maxScale)) : 0;
  const addRatio = sum > 0 ? (additions / sum) * 100 : 0;
  const delRatio = sum > 0 ? (deletions / sum) * 100 : 0;

  return (
    <>
      <span className="font-sans">{label}</span>
      <span className="text-right text-diff-addition-foreground">
        +{formatDiffCount(additions)}
      </span>
      <span className="text-right text-diff-deletion">-{formatDiffCount(deletions)}</span>
      <span
        aria-hidden="true"
        data-slot="change-breakdown-bar"
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/65"
      >
        <span
          className="flex h-full w-full origin-left overflow-hidden rounded-full transition-transform duration-(--duration-fluid) ease-(--spring-fluid) motion-reduce:transition-none"
          style={{ transform: `scaleX(${barScale})` }}
        >
          {additions > 0 ? (
            <span
              className="h-full bg-diff-addition-foreground"
              style={{ width: `${addRatio}%` }}
            />
          ) : null}
          {deletions > 0 ? (
            <span className="h-full bg-diff-deletion" style={{ width: `${delRatio}%` }} />
          ) : null}
        </span>
      </span>
    </>
  );
}

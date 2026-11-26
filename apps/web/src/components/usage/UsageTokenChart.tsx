import { uiText as copy } from "~/i18n";
import { usageHourTicks } from "./usageAxis";
import { useState } from "react";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { formatPercent, formatTokens } from "@t3tools/shared/usageFormat";

type TokenLayer = "cache" | "fresh" | "output";

function splitTokenLayers(row: MergedUsage | undefined) {
  const total = row?.totalTokens ?? 0;
  // V9 three layers: cache reads, fresh input (incl. cache writes), model output.
  const cache = Math.min(total, row?.cachedInputTokens ?? 0);
  const output = Math.min(total - cache, row?.outputTokens ?? 0);
  const fresh = Math.max(0, total - cache - output);
  return { total, cache, fresh, output };
}

export function UsageTokenChart({
  periods,
  totals,
  formatPeriod,
  selectedHour,
  onSelectHour,
  hourly,
  timeZone,
}: {
  readonly periods: readonly string[];
  readonly totals: readonly MergedUsage[];
  readonly formatPeriod: (period: string) => string;
  readonly selectedHour: string | null;
  readonly onSelectHour: (period: string) => void;
  readonly hourly: boolean;
  readonly timeZone?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isolatedLayer, setIsolatedLayer] = useState<TokenLayer | null>(null);

  const toggleLayer = (layer: TokenLayer) => {
    setIsolatedLayer((current) => (current === layer ? null : layer));
  };

  const rows = totals.map((row) => splitTokenLayers(row));
  const valueForRow = (split: ReturnType<typeof splitTokenLayers>) =>
    isolatedLayer === null ? split.total : split[isolatedLayer];

  const peak = Math.max(1, ...rows.map(valueForRow));
  const hoveredIndex = hovered === null ? -1 : periods.indexOf(hovered);
  const active = hoveredIndex >= 0 ? totals[hoveredIndex] : null;
  const activeSplit = hoveredIndex >= 0 ? rows[hoveredIndex] : null;
  const overallTotal = rows.reduce((sum, split) => sum + split.total, 0);
  const isolatedTotal = rows.reduce((sum, split) => sum + valueForRow(split), 0);
  const isolatedLayerLabel =
    isolatedLayer === "cache"
      ? copy("Cache read")
      : isolatedLayer === "fresh"
        ? copy("Fresh input (incl. cache writes)")
        : isolatedLayer === "output"
          ? copy("Model output (incl. reasoning)")
          : null;

  const parts = active
    ? ([
        [copy("Cache read"), active.cachedInputTokens],
        [copy("New input"), active.uncachedInputTokens],
        [copy("Output"), active.outputTokens],
        [copy("Cache write"), active.cacheCreationTokens],
      ] as const)
    : [];
  const headlineValue = activeSplit ? valueForRow(activeSplit) : isolatedTotal;
  return (
    <div className="usage-token-chart" data-isolated-layer={isolatedLayer ?? undefined}>
      <div className="usage-readout" role="status" data-usage-readout>
        <div>
          <span>
            {hovered
              ? isolatedLayerLabel
                ? `${formatPeriod(hovered)} · ${isolatedLayerLabel}`
                : formatPeriod(hovered)
              : isolatedLayerLabel
                ? `${isolatedLayerLabel} · ${formatPercent(overallTotal > 0 ? isolatedTotal / overallTotal : 0)}`
                : copy("All periods · Total")}
          </span>
          <strong className="tabular-nums">
            {formatTokens(headlineValue)} {copy("Tokens")}
          </strong>
        </div>
        <div className="usage-readout-parts">
          {parts
            .filter(([, value]) => value > 0)
            .map(([label, value]) => (
              <span key={label}>
                <b>
                  {formatTokens(value)} ·{" "}
                  {formatPercent(active && active.totalTokens > 0 ? value / active.totalTokens : 0)}
                </b>{" "}
                {label}
              </span>
            ))}
        </div>
      </div>
      <div className="usage-token-plot" onMouseLeave={() => setHovered(null)}>
        <div className="usage-token-axis" aria-hidden>
          {[1, 0.75, 0.5, 0.25, 0].map((value) => (
            <span key={value}>{formatTokens(peak * value)}</span>
          ))}
        </div>
        <div
          className="usage-token-columns"
          role="group"
          aria-label={hourly ? copy("Hourly tokens") : copy("Daily tokens.")}
        >
          {periods.map((period, index) => {
            const split = rows[index] ?? { total: 0, cache: 0, fresh: 0, output: 0 };
            const shownTotal = valueForRow(split);
            const cacheHeight =
              isolatedLayer === "cache"
                ? split.cache > 0
                  ? 100
                  : 0
                : isolatedLayer === null && split.total > 0
                  ? (split.cache / split.total) * 100
                  : 0;
            const freshHeight =
              isolatedLayer === "fresh"
                ? split.fresh > 0
                  ? 100
                  : 0
                : isolatedLayer === null && split.total > 0
                  ? (split.fresh / split.total) * 100
                  : 0;
            const outputHeight =
              isolatedLayer === "output"
                ? split.output > 0
                  ? 100
                  : 0
                : isolatedLayer === null && split.total > 0
                  ? (split.output / split.total) * 100
                  : 0;
            return (
              <button
                type="button"
                key={period}
                className="usage-token-column"
                aria-label={copy("{period}, {count} tokens", {
                  period: formatPeriod(period),
                  count: formatTokens(shownTotal),
                })}
                aria-pressed={hourly ? selectedHour === period : undefined}
                data-hovered={hovered === period || undefined}
                onMouseEnter={() => setHovered(period)}
                onFocus={() => setHovered(period)}
                onBlur={() => setHovered(null)}
                onClick={() => {
                  if (hourly) onSelectHour(period);
                }}
              >
                {hovered === period ? <i className="usage-token-rule" /> : null}
                <span
                  data-usage-bar
                  className="usage-token-stack"
                  style={{ height: `${(shownTotal / peak) * 100}%` }}
                >
                  <i
                    data-token-type="cache"
                    data-dim={
                      isolatedLayer !== null && isolatedLayer !== "cache" ? "true" : undefined
                    }
                    style={{ height: `${cacheHeight}%` }}
                  />
                  <i
                    data-token-type="fresh"
                    data-dim={
                      isolatedLayer !== null && isolatedLayer !== "fresh" ? "true" : undefined
                    }
                    style={{ height: `${freshHeight}%` }}
                  />
                  <i
                    data-token-type="output"
                    data-dim={
                      isolatedLayer !== null && isolatedLayer !== "output" ? "true" : undefined
                    }
                    style={{ height: `${outputHeight}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="usage-token-labels" aria-hidden>
        {hourly && timeZone
          ? usageHourTicks(periods, timeZone, 4, true).map((tick) => (
              <span
                key={tick.at}
                style={{
                  position: "absolute",
                  left: `${tick.position * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {tick.label}
              </span>
            ))
          : periods
              .filter((_, index) => index % Math.max(1, Math.floor(periods.length / 6)) === 0)
              .map((period) => (
                <span key={period}>
                  {hourly ? formatPeriod(period).replace(/:\d{2}$/, ":00") : formatPeriod(period)}
                </span>
              ))}
      </div>
      <div className="usage-token-legend" role="group" aria-label={copy("Token layers")}>
        {(
          [
            ["cache", copy("Cache read")],
            ["fresh", copy("Fresh input (incl. cache writes)")],
            ["output", copy("Model output (incl. reasoning)")],
          ] as const
        ).map(([layer, label]) => {
          const activeLayer = isolatedLayer === layer;
          const dimmedLayer = isolatedLayer !== null && !activeLayer;
          return (
            <button
              key={layer}
              type="button"
              className="usage-token-legend-btn"
              aria-pressed={activeLayer}
              data-active={activeLayer ? "true" : undefined}
              data-dim={dimmedLayer ? "true" : undefined}
              onClick={() => toggleLayer(layer)}
            >
              <i data-token-type={layer === "cache" ? undefined : layer} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {hourly ? (
        <p className="usage-card-hint">
          {copy("Select a bar to filter models to that hour. Select it again to clear.")}
        </p>
      ) : null}
    </div>
  );
}

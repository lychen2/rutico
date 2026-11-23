import { Pressable, View } from "react-native";

import type { DailyTotals } from "@t3tools/shared/usageMerge";

import { buildChartDays, type UsageChartMetric } from "./usageChartData";
import { useProviderColors } from "./usageProviders";

export interface UsageDailyChartProps {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly height: number;
  readonly selectedDay?: string | null;
  readonly onSelectDay?: (day: string | null) => void;
}

export function UsageDailyChart({
  days,
  daily,
  metric,
  height,
  selectedDay = null,
  onSelectDay,
}: UsageDailyChartProps) {
  const colors = useProviderColors();
  const chartDays = buildChartDays(days, daily, metric);
  const max = chartDays.reduce((peak, day) => Math.max(peak, day.total), 0);

  return (
    <View style={{ height }} className="flex-row items-end gap-[2px]">
      {/* Use column-reverse: provider values are bottom-first and Hermes lacks toReversed. */}
      {chartDays.map((day) => {
        const barHeight =
          max === 0 ? 0 : Math.max(day.total > 0 ? 3 : 0, (day.total / max) * height);
        const isSelected = selectedDay === day.day;
        const dimmed = selectedDay !== null && !isSelected;
        const bar = (
          <View
            style={{ height: barHeight, opacity: dimmed ? 0.32 : 1 }}
            className="w-full flex-col-reverse overflow-hidden rounded-t-md"
          >
            {day.values.map((entry) => (
              <View
                key={entry.provider}
                style={{
                  height: max === 0 ? 0 : (entry.value / max) * height,
                  backgroundColor: colors[entry.provider],
                }}
              />
            ))}
          </View>
        );
        if (!onSelectDay) {
          return (
            <View key={day.day} className="h-full flex-1 justify-end">
              {bar}
            </View>
          );
        }
        return (
          <Pressable
            key={day.day}
            className="h-full flex-1 justify-end"
            onPress={() => onSelectDay(isSelected ? null : day.day)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            {bar}
          </Pressable>
        );
      })}
    </View>
  );
}

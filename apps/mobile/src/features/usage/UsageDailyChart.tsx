import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { DailyTotals } from "@t3tools/shared/usageMerge";

import { AppText as Text } from "../../components/ui/AppText";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY, TIMING_QUICK_FADE } from "../../lib/mobileMotion";
import { buildChartDays, type UsageChartDay, type UsageChartMetric } from "./usageChartData";
import { useProviderColors } from "./usageProviders";

const READOUT_ENTERING = FadeIn.duration(120).reduceMotion(ReduceMotion.System);
const READOUT_EXITING = FadeOut.duration(100).reduceMotion(ReduceMotion.System);
const READOUT_MIN_WIDTH = 124;

export interface UsageDailyChartProps {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly height: number;
  readonly selectedDay?: string | null;
  readonly onSelectDay?: (day: string | null) => void;
  readonly formatPeriodLabel?: (period: string) => string;
  readonly formatValue?: (value: number) => string;
}

function AnimatedChartBar(props: {
  readonly day: UsageChartDay;
  readonly max: number;
  readonly height: number;
  readonly isSelected: boolean;
  readonly dimmed: boolean;
  readonly colors: ReturnType<typeof useProviderColors>;
  readonly onPress?: () => void;
}) {
  const targetBarHeight =
    props.max === 0
      ? 0
      : Math.max(props.day.total > 0 ? 3 : 0, (props.day.total / props.max) * props.height);
  const targetOpacity = props.dimmed ? 0.35 : 1;
  const barHeight = useSharedValue(targetBarHeight);
  const barOpacity = useSharedValue(targetOpacity);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- springs bar heights smoothly when switching usage window or metric
  useEffect(() => {
    barHeight.set(withSpring(targetBarHeight, SPRING_SPATIAL_SNAPPY));
  }, [barHeight, targetBarHeight]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates inactive bar dimming during chart scrubbing
  useEffect(() => {
    barOpacity.set(withTiming(targetOpacity, TIMING_QUICK_FADE));
  }, [barOpacity, targetOpacity]);

  const barStyle = useAnimatedStyle(() => ({
    height: barHeight.get(),
    opacity: barOpacity.get(),
  }));

  const bar = (
    <Animated.View
      style={barStyle}
      className="w-full flex-col-reverse overflow-hidden rounded-t-md"
    >
      {props.day.values.map((entry) => (
        <View
          key={entry.provider}
          style={{
            flex: props.day.total > 0 ? entry.value / props.day.total : 0,
            backgroundColor: props.colors[entry.provider],
          }}
        />
      ))}
    </Animated.View>
  );

  if (!props.onPress) {
    return <View className="h-full flex-1 justify-end">{bar}</View>;
  }

  return (
    <Pressable
      className="h-full flex-1 justify-end"
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.isSelected }}
    >
      {bar}
    </Pressable>
  );
}

export function UsageDailyChart({
  days,
  daily,
  metric,
  height,
  selectedDay = null,
  onSelectDay,
  formatPeriodLabel,
  formatValue,
}: UsageDailyChartProps) {
  const colors = useProviderColors();
  const chartDays = useMemo(() => buildChartDays(days, daily, metric), [daily, days, metric]);
  const max = chartDays.reduce((peak, day) => Math.max(peak, day.total), 0);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const chartWidth = useSharedValue(0);
  const activeIndex = useSharedValue(-1);
  const isScrubbing = useSharedValue(false);
  const crosshairX = useSharedValue(0);

  const selectedIndex =
    selectedDay === null ? -1 : chartDays.findIndex((candidate) => candidate.day === selectedDay);
  const selectedChartDay = selectedIndex >= 0 ? chartDays[selectedIndex]! : null;
  const barCount = chartDays.length;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs crosshair X position when selection changes via tap or reset
  useEffect(() => {
    if (selectedIndex >= 0 && measuredWidth > 0 && barCount > 0) {
      const targetX = ((selectedIndex + 0.5) / barCount) * measuredWidth;
      crosshairX.set(withSpring(targetX, SPRING_SPATIAL_SNAPPY));
      activeIndex.set(selectedIndex);
    } else if (selectedIndex < 0) {
      activeIndex.set(-1);
    }
  }, [activeIndex, barCount, crosshairX, measuredWidth, selectedIndex]);

  const handleScrubToIndex = useCallback(
    (index: number) => {
      const target = chartDays[index];
      if (!target) return;
      triggerSemanticHaptic("segmentFrequentTick");
      onSelectDay?.(target.day);
    },
    [chartDays, onSelectDay],
  );

  const scrubPanGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.Pan()
        .enabled(Boolean(onSelectDay) && barCount > 0)
        .activeOffsetX([-6, 6])
        .failOffsetY([-14, 14])
        .onBegin((event) => {
          const width = chartWidth.get();
          if (width <= 0 || barCount <= 0) return;
          isScrubbing.set(true);
          const clampedX = Math.max(0, Math.min(width - 1, event.x));
          const index = Math.max(
            0,
            Math.min(barCount - 1, Math.floor((clampedX / width) * barCount)),
          );
          crosshairX.set(((index + 0.5) / barCount) * width);
          if (index !== activeIndex.get()) {
            activeIndex.set(index);
            runOnJS(handleScrubToIndex)(index);
          }
        })
        .onUpdate((event) => {
          const width = chartWidth.get();
          if (width <= 0 || barCount <= 0) return;
          const clampedX = Math.max(0, Math.min(width - 1, event.x));
          const index = Math.max(
            0,
            Math.min(barCount - 1, Math.floor((clampedX / width) * barCount)),
          );
          crosshairX.set(((index + 0.5) / barCount) * width);
          if (index !== activeIndex.get()) {
            activeIndex.set(index);
            runOnJS(handleScrubToIndex)(index);
          }
        })
        .onFinalize(() => {
          isScrubbing.set(false);
        }),
    [activeIndex, barCount, chartWidth, crosshairX, handleScrubToIndex, isScrubbing, onSelectDay],
  );

  const longPressGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.LongPress()
        .enabled(Boolean(onSelectDay) && barCount > 0)
        .minDuration(110)
        .onStart((event) => {
          const width = chartWidth.get();
          if (width <= 0 || barCount <= 0) return;
          const clampedX = Math.max(0, Math.min(width - 1, event.x));
          const index = Math.max(
            0,
            Math.min(barCount - 1, Math.floor((clampedX / width) * barCount)),
          );
          crosshairX.set(((index + 0.5) / barCount) * width);
          if (index !== activeIndex.get()) {
            activeIndex.set(index);
            runOnJS(handleScrubToIndex)(index);
          }
        }),
    [activeIndex, barCount, chartWidth, crosshairX, handleScrubToIndex, onSelectDay],
  );

  const chartGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.Simultaneous(scrubPanGesture, longPressGesture),
    [longPressGesture, scrubPanGesture],
  );

  const crosshairStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: crosshairX.get() }],
  }));

  const readoutStyle = useAnimatedStyle(() => {
    const width = chartWidth.get();
    const maxOffset = Math.max(0, width - READOUT_MIN_WIDTH);
    const clampedLeft = Math.max(0, Math.min(maxOffset, crosshairX.get() - READOUT_MIN_WIDTH / 2));
    return {
      transform: [{ translateX: clampedLeft }],
    };
  });

  return (
    <GestureDetector gesture={chartGesture}>
      <View
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          setMeasuredWidth(width);
          chartWidth.set(width);
        }}
        style={{ height }}
        className="relative flex-row items-end gap-[2px]"
      >
        {selectedChartDay !== null && measuredWidth > 0 ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={crosshairStyle}
              className="absolute inset-y-0 left-0 z-10 w-[1.5px] items-center bg-foreground/35"
            >
              <View className="size-2 -translate-y-0.5 rounded-full bg-primary" />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              entering={READOUT_ENTERING}
              exiting={READOUT_EXITING}
              style={[readoutStyle, { minWidth: READOUT_MIN_WIDTH }]}
              className="absolute left-0 top-1 z-20 items-center rounded-full border border-border bg-card/95 px-2.5 py-1"
            >
              <Text
                numberOfLines={1}
                className="font-t3-bold text-2xs tabular-nums text-foreground"
              >
                {`${formatPeriodLabel ? formatPeriodLabel(selectedChartDay.day) : selectedChartDay.day} · ${formatValue ? formatValue(selectedChartDay.total) : selectedChartDay.total}`}
              </Text>
            </Animated.View>
          </>
        ) : null}
        {/* Use column-reverse: provider values are bottom-first and Hermes lacks toReversed. */}
        {chartDays.map((day) => {
          const isSelected = selectedDay === day.day;
          const dimmed = selectedDay !== null && !isSelected;
          return (
            <AnimatedChartBar
              key={day.day}
              day={day}
              max={max}
              height={height}
              isSelected={isSelected}
              dimmed={dimmed}
              colors={colors}
              onPress={
                onSelectDay
                  ? () => {
                      triggerSemanticHaptic("segmentTick");
                      onSelectDay(isSelected ? null : day.day);
                    }
                  : undefined
              }
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}

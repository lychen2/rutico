import { Slider } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { View } from "react-native";

import { cn } from "../../lib/cn";
import { AppText as Text } from "./AppText";
import { SymbolView } from "./AppSymbol";
import { NativeThemeHost } from "./NativeThemeHost.android";
import { useControlTheme } from "./useControlTheme";
import type { SliderRowProps } from "./SliderRow.types";

const SCRUB_HAPTIC_MIN_INTERVAL_MS = 28;

function snapToStep(value: number, min: number, max: number, step: number): number {
  const safeStep = step > 0 ? step : 1;
  const snapped = min + Math.round((value - min) / safeStep) * safeStep;
  const clamped = Math.min(max, Math.max(min, snapped));
  // Eliminate IEEE-754 decimal drift (e.g. 11.500000000000002).
  return Math.round(clamped * 1000) / 1000;
}

export function SliderRow(props: SliderRowProps) {
  const { colors } = useControlTheme();
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  // The value of the drag in progress; null between drags.
  const draft = useRef<number | null>(null);
  const lastStepped = useRef<number>(props.value);
  const lastHapticAt = useRef<number>(0);

  const displayedValue = scrubValue ?? props.value;
  const displayedLabel =
    scrubValue !== null && props.formatValueLabel
      ? props.formatValueLabel(scrubValue)
      : props.valueLabel;

  const isAtDefault =
    props.defaultValue !== undefined && Math.abs(displayedValue - props.defaultValue) < 1e-4;
  const defaultFraction =
    props.defaultValue !== undefined && props.max > props.min
      ? Math.max(0, Math.min(1, (props.defaultValue - props.min) / (props.max - props.min)))
      : null;

  const fireStepHaptic = (next: number) => {
    const isDefaultDetent =
      props.defaultValue !== undefined && Math.abs(next - props.defaultValue) < 1e-4;
    const now = Date.now();
    if (!isDefaultDetent && now - lastHapticAt.current < SCRUB_HAPTIC_MIN_INTERVAL_MS) {
      return;
    }
    lastHapticAt.current = now;
    void Haptics.performAndroidHapticsAsync(
      isDefaultDetent ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Segment_Tick,
    ).catch(() => Haptics.selectionAsync().catch(() => undefined));
  };

  const commit = (value: number) => {
    if (props.disabled) return;
    const next = snapToStep(value, props.min, props.max, props.step);
    lastStepped.current = next;
    if (next === props.value) return;
    fireStepHaptic(next);
    props.onChange(next);
  };

  return (
    <View className={props.disabled ? "gap-2 p-4 opacity-45" : "gap-2 p-4"}>
      <View className="flex-row items-center gap-4">
        <SymbolView name={props.icon} size={24} tintColorClassName="accent-icon" />
        <Text className="min-w-0 flex-1 text-base">{props.label}</Text>
        <Text
          className={cn(
            "text-sm tabular-nums",
            scrubValue !== null
              ? "font-t3-bold text-primary"
              : isAtDefault
                ? "font-t3-medium text-foreground"
                : "text-foreground-muted",
          )}
        >
          {displayedLabel}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={props.label}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: Boolean(props.disabled) }}
        accessibilityValue={{
          min: props.min,
          max: props.max,
          now: displayedValue,
          text: displayedLabel,
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "increment") commit(props.value + props.step);
          else if (nativeEvent.actionName === "decrement") commit(props.value - props.step);
        }}
      >
        <View importantForAccessibility="no-hide-descendants">
          <NativeThemeHost style={{ height: 48, width: "100%" }}>
            <Slider
              min={props.min}
              max={props.max}
              value={props.value}
              steps={Math.max(0, Math.round((props.max - props.min) / props.step) - 1)}
              enabled={!props.disabled}
              modifiers={[fillMaxWidth()]}
              colors={{
                thumbColor: colors["--color-primary"],
                activeTrackColor: colors["--color-primary"],
                inactiveTrackColor: colors["--color-secondary"],
              }}
              onValueChange={(value) => {
                if (props.disabled) return;
                const stepped = snapToStep(value, props.min, props.max, props.step);
                draft.current = stepped;
                if (stepped !== lastStepped.current) {
                  lastStepped.current = stepped;
                  fireStepHaptic(stepped);
                  setScrubValue(stepped);
                  props.onPreviewChange?.(stepped);
                }
              }}
              onValueChangeFinished={() => {
                const value = draft.current;
                draft.current = null;
                setScrubValue(null);
                props.onPreviewChange?.(null);
                if (value !== null) {
                  const next = snapToStep(value, props.min, props.max, props.step);
                  if (next !== props.value) {
                    props.onChange(next);
                  }
                }
              }}
            />
          </NativeThemeHost>
          {defaultFraction !== null ? (
            <View className="relative mx-2.5 -mt-1.5 h-2.5 justify-center" pointerEvents="none">
              <View
                style={{ left: `${defaultFraction * 100}%`, marginLeft: -4 }}
                className={cn(
                  "absolute size-2 rounded-full",
                  isAtDefault ? "scale-125 bg-primary" : "bg-border",
                )}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

import * as Haptics from "expo-haptics";
import { useState } from "react";
import { I18nManager, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withSpring,
} from "react-native-reanimated";

import { segmentedControlColors } from "./segmentedControlColors";
import { AppText } from "./AppText";
import { useControlTheme } from "./useControlTheme";
import type { SegmentedControlProps } from "./SegmentedControl.types";

export type { SegmentedControlProps } from "./SegmentedControl.types";

const THUMB_SPRING_CONFIG = {
  damping: 32,
  stiffness: 360,
  mass: 0.7,
  reduceMotion: ReduceMotion.System,
} as const;

export function SegmentedControl<Value extends string | number>(
  props: SegmentedControlProps<Value>,
) {
  const { colorScheme, colors, themeId } = useControlTheme();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const { width } = layout;
  const reduceMotion = useReducedMotion();
  const selectedIndex = props.options.findIndex((option) => option.value === props.selected);
  const segmentWidth = props.options.length ? Math.max(0, width - 6) / props.options.length : 0;
  const direction = I18nManager.isRTL ? -1 : 1;
  // The index animates, not the offset, so a resize moves the selection without sliding it.
  const selectedPosition = useDerivedValue(() =>
    reduceMotion ? selectedIndex : withSpring(selectedIndex, THUMB_SPRING_CONFIG),
  );
  const selectionStyle = useAnimatedStyle(() => ({
    width: segmentWidth,
    transform: [{ translateX: selectedPosition.get() * segmentWidth * direction }],
  }));
  const { trackColor, selectedColor, selectedTextColor, mutedColor } = segmentedControlColors(
    colors,
    colorScheme,
    props.variant,
    Platform.OS,
    themeId,
  );
  const minHeight = props.size === "compact" ? 32 : Platform.OS === "android" ? 40 : 36;
  const targetHitHeight = Platform.OS === "android" ? 48 : 44;
  const verticalHitSlop = Math.max(0, Math.ceil((targetHitHeight - (minHeight - 6)) / 2));
  const thumbRimColor =
    colorScheme === "dark" ? "rgba(255, 255, 255, 0.09)" : "rgba(0, 0, 0, 0.06)";
  const thumbElevationStyle =
    Platform.OS === "android"
      ? { elevation: 1 }
      : {
          shadowColor: "#000000",
          shadowOpacity: colorScheme === "dark" ? 0.18 : 0.06,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
        };

  return (
    <View collapsable={false} className={props.className}>
      <View
        onLayout={(event) => setLayout(event.nativeEvent.layout)}
        className="flex-row rounded-full p-[3px]"
        style={{
          minHeight,
          backgroundColor: trackColor,
        }}
      >
        {selectedIndex >= 0 && width > 0 ? (
          <Animated.View
            pointerEvents="none"
            className="absolute bottom-[3px] start-[3px] top-[3px] rounded-full"
            style={[
              {
                backgroundColor: selectedColor,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: thumbRimColor,
              },
              thumbElevationStyle,
              selectionStyle,
            ]}
          />
        ) : null}
        {props.options.map((option) => {
          const selected = option.value === props.selected;
          return (
            <Pressable
              key={`${typeof option.value}:${option.value}`}
              accessibilityRole={props.role ?? "button"}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              accessibilityState={{ selected }}
              hitSlop={{ top: verticalHitSlop, bottom: verticalHitSlop }}
              onPress={() => {
                if (!selected) {
                  void Haptics.selectionAsync().catch(() => undefined);
                }
                props.onSelect(option.value);
              }}
              className="flex-1 items-center justify-center rounded-full px-2 py-1 active:opacity-70"
              style={{ minHeight: minHeight - 6 }}
            >
              <AppText
                textRole="footnote"
                className={selected ? "font-t3-bold" : "font-t3-medium"}
                style={{
                  color: selected ? selectedTextColor : mutedColor,
                }}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

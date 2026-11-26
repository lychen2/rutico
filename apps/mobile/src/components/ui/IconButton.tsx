import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { IconButtonProps } from "./IconButton.types";
import { cn } from "../../lib/cn";

import { SymbolView } from "./AppSymbol";

const PRESS_SPRING_CONFIG = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

const VARIANT_CLASS_NAMES = {
  standard: ["rounded-full active:bg-row-hover", "accent-foreground"],
  primary: ["rounded-full bg-primary", "accent-primary-foreground"],
  danger: ["rounded-full bg-danger", "accent-danger-foreground"],
  tonal: ["rounded-full bg-secondary", "accent-secondary-foreground"],
} as const;

export function IconButton(props: IconButtonProps) {
  const variant = props.variant ?? "standard";
  const [containerClassName, iconTintClassName] = VARIANT_CLASS_NAMES[variant];
  const disabled = Boolean(props.disabled);
  const iconSize = Math.round(24 * (props.iconScale ?? 1));
  const pressScale = useSharedValue(1);
  const animatedScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));

  const handlePress = () => {
    if (disabled || !props.onPress) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    props.onPress();
  };

  return (
    <Animated.View style={animatedScaleStyle}>
      <Pressable
        onPress={props.onPress ? handlePress : undefined}
        onPressIn={() => {
          if (!disabled) {
            pressScale.set(withSpring(0.92, PRESS_SPRING_CONFIG));
          }
        }}
        onPressOut={() => {
          pressScale.set(withSpring(1, PRESS_SPRING_CONFIG));
        }}
        disabled={disabled}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: props.selected }}
        className={cn(
          "size-12 items-center justify-center",
          !disabled && "active:opacity-70",
          disabled && variant !== "standard" ? "rounded-full bg-subtle-strong" : containerClassName,
        )}
      >
        <SymbolView
          name={props.icon}
          size={iconSize}
          tintColorClassName={
            disabled
              ? "accent-icon-subtle"
              : variant === "standard"
                ? (props.tintColorClassName ?? iconTintClassName)
                : iconTintClassName
          }
        />
      </Pressable>
    </Animated.View>
  );
}

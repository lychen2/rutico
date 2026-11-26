import * as Haptics from "expo-haptics";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { cn } from "../../lib/cn";
import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { IconButton } from "./IconButton";
import { Button } from "./Button";
import { useAndroidControlSizing } from "./useAndroidControlSizing";

const PRESS_SPRING_CONFIG = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

export function ControlPill(props: {
  readonly icon?: ComponentProps<typeof SymbolView>["name"];
  readonly iconNode?: ReactNode;
  readonly label?: string;
  readonly accessibilityLabel?: string;
  readonly onPress?: () => void;
  readonly activateOnPressIn?: boolean;
  readonly variant?: "circle" | "pill" | "primary" | "danger";
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const variant = props.variant ?? "circle";
  const disabled = Boolean(props.disabled);
  const { smallIconSize } = useAndroidControlSizing();
  const activatedOnPressInRef = useRef(false);
  const pressScale = useSharedValue(1);
  const animatedScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));

  const triggerPress = () => {
    if (disabled || !props.onPress) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    props.onPress();
  };

  const handlePressIn = () => {
    if (!disabled) {
      pressScale.set(withSpring(0.93, PRESS_SPRING_CONFIG));
    }
    if (props.activateOnPressIn) {
      activatedOnPressInRef.current = true;
      triggerPress();
    }
  };
  const handlePressOut = () => {
    pressScale.set(withSpring(1, PRESS_SPRING_CONFIG));
    if (props.activateOnPressIn) {
      // Defer reset: Pressability calls onPressOut before onPress for the same gesture.
      setTimeout(() => {
        activatedOnPressInRef.current = false;
      }, 0);
    }
  };
  const handlePress = () => {
    if (props.activateOnPressIn && activatedOnPressInRef.current) {
      return;
    }
    triggerPress();
  };

  const iconTintClassName =
    variant === "primary"
      ? disabled
        ? "accent-icon-subtle"
        : "accent-primary-foreground"
      : variant === "danger"
        ? "accent-danger-foreground"
        : "accent-icon";

  const isCircle =
    variant === "circle" || variant === "danger" || (variant === "primary" && !props.label);
  const containerClassName = cn(
    isCircle
      ? "h-[44px] w-[44px] items-center justify-center rounded-full android:h-[48px] android:w-[48px]"
      : variant === "primary"
        ? "h-[44px] flex-row items-center justify-center gap-2 rounded-full px-5 android:h-[48px]"
        : "h-[44px] flex-row items-center justify-center gap-2 rounded-full px-3.5 android:h-[48px]",
    variant === "primary"
      ? disabled
        ? "bg-subtle-strong"
        : "bg-primary"
      : variant === "danger"
        ? "bg-danger"
        : "bg-subtle",
    props.className,
  );
  const labelClassName = cn(
    "text-center text-xs font-t3-bold",
    variant === "primary"
      ? disabled
        ? "text-foreground-muted"
        : "text-primary-foreground"
      : variant === "danger"
        ? "text-danger-foreground"
        : "text-foreground",
  );

  if (
    Platform.OS === "android" &&
    (variant === "pill" || variant === "primary") &&
    props.label &&
    props.onPress &&
    !props.icon &&
    !props.iconNode &&
    !props.className &&
    !props.activateOnPressIn &&
    (!props.accessibilityLabel || props.accessibilityLabel === props.label)
  ) {
    return (
      <Button
        label={props.label}
        onPress={props.onPress}
        disabled={disabled}
        tone={variant === "primary" ? "primary" : "secondary"}
      />
    );
  }

  if (
    Platform.OS === "android" &&
    props.accessibilityLabel &&
    props.icon &&
    !props.iconNode &&
    !props.label &&
    !props.className &&
    !props.activateOnPressIn
  ) {
    return (
      <IconButton
        accessibilityLabel={props.accessibilityLabel}
        icon={props.icon}
        onPress={props.onPress}
        disabled={disabled}
        variant={variant === "primary" ? "primary" : variant === "danger" ? "danger" : "tonal"}
      />
    );
  }

  return (
    <Animated.View style={animatedScaleStyle}>
      <Pressable
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        onPress={props.onPress ? handlePress : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        className={containerClassName}
        style={({ pressed }) => (pressed && !disabled ? { opacity: 0.75 } : undefined)}
      >
        {props.iconNode ? (
          <View className="h-4 w-4 items-center justify-center">{props.iconNode}</View>
        ) : props.icon ? (
          <SymbolView
            name={props.icon}
            size={smallIconSize}
            tintColorClassName={iconTintClassName}
            type="monochrome"
          />
        ) : null}
        {props.label ? <Text className={labelClassName}>{props.label}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

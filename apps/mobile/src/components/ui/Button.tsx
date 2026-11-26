import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SymbolView, type AppSymbolName } from "./AppSymbol";
import { AppActivityIndicator } from "./AppActivityIndicator";
import { AppText } from "./AppText";
import { cn } from "../../lib/cn";

export interface ButtonProps {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly icon?: AppSymbolName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly loading?: boolean;
  readonly tone?: "primary" | "secondary" | "danger" | "text" | "contrast";
  readonly fullWidth?: boolean;
  readonly size?: "default" | "compact";
}

const PRESS_SPRING_CONFIG = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

const TONE_CLASS_NAMES = {
  contrast: ["bg-foreground", "text-screen"],
  primary: ["bg-primary", "text-primary-foreground"],
  secondary: ["bg-secondary", "text-secondary-foreground"],
  danger: ["bg-danger", "text-danger-foreground"],
  text: ["bg-transparent", "text-primary-text"],
} as const;

export function Button(props: ButtonProps) {
  const tone = props.tone ?? "secondary";
  const [containerClassName, labelClassName] = TONE_CLASS_NAMES[tone];
  const disabled = Boolean(props.disabled || props.loading);
  const pressScale = useSharedValue(1);
  const animatedScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));

  const handlePress = () => {
    if (tone === "primary" || tone === "danger" || tone === "contrast") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    props.onPress();
  };

  return (
    <Animated.View
      style={[
        props.fullWidth ? { width: "100%" } : { alignSelf: "flex-start" },
        animatedScaleStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityHint={props.accessibilityHint}
        accessibilityState={{ disabled, busy: Boolean(props.loading) }}
        disabled={disabled}
        onPress={handlePress}
        onPressIn={() => {
          if (!disabled) {
            pressScale.set(withSpring(0.97, PRESS_SPRING_CONFIG));
          }
        }}
        onPressOut={() => {
          pressScale.set(withSpring(1, PRESS_SPRING_CONFIG));
        }}
        className={cn(
          "flex-row items-center justify-center gap-2 rounded-full active:opacity-70",
          props.size === "compact" ? "min-h-[44px] px-5" : "min-h-[44px] px-6 android:min-h-[48px]",
          props.fullWidth && "w-full",
          disabled ? "bg-subtle-strong" : containerClassName,
        )}
      >
        {props.loading ? (
          <AppActivityIndicator colorClassName="accent-foreground-muted" />
        ) : props.icon ? (
          <SymbolView
            name={props.icon}
            size={18}
            tintColorClassName={
              disabled ? "accent-foreground-muted" : labelClassName.replace("text-", "accent-")
            }
          />
        ) : null}
        <AppText
          className={cn(
            "min-w-0 shrink text-center font-t3-medium",
            disabled ? "text-foreground-muted" : labelClassName,
          )}
        >
          {props.label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

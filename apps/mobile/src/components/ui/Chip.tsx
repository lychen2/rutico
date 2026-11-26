import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";

import { cn } from "../../lib/cn";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { AppText } from "./AppText";
import { SymbolView, type AppSymbolName } from "./AppSymbol";

const PRESS_SPRING_CONFIG = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

const ChipGlass = withUniwind(GlassView, {
  style: { fromClassName: "className" },
  tintColor: { fromClassName: "tintColorClassName", styleProperty: "accentColor" },
});

export function Chip(props: {
  readonly label: string;
  readonly selected?: boolean;
  readonly icon?: AppSymbolName;
  readonly trailingIcon?: AppSymbolName;
  readonly size?: "small" | "default";
  readonly glass?: boolean;
  readonly colorScheme?: "light" | "dark";
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
}) {
  const small = props.size === "small";
  const disabled = Boolean(props.disabled);
  const pressScale = useSharedValue(1);
  const animatedScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));
  const hitSlop = small
    ? {
        top: Platform.OS === "android" ? 12 : 10,
        bottom: Platform.OS === "android" ? 12 : 10,
        left: 6,
        right: 6,
      }
    : { top: 8, bottom: 8, left: 6, right: 6 };
  const layout = cn(
    "flex-row items-center gap-1.5 rounded-2xl px-3",
    small ? "py-1" : "min-h-8 py-1.5",
  );
  const iconColor = props.selected ? "accent-primary-foreground" : "accent-icon-muted";
  const content = (
    <>
      {props.icon ? (
        <SymbolView name={props.icon} size={15} tintColorClassName={iconColor} />
      ) : null}
      <AppText
        textRole={small ? "caption" : "footnote"}
        numberOfLines={small ? undefined : 1}
        className={cn(
          "shrink",
          !small && "max-w-[180px]",
          !small && "font-t3-medium",
          props.selected ? "text-primary-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </AppText>
      {props.trailingIcon ? (
        <SymbolView name={props.trailingIcon} size={11} tintColorClassName={iconColor} />
      ) : null}
    </>
  );
  const body =
    props.glass && NATIVE_LIQUID_GLASS_SUPPORTED ? (
      <ChipGlass
        isInteractive
        colorScheme={props.colorScheme}
        tintColorClassName={props.selected ? "accent-primary" : undefined}
        className={layout}
      >
        {content}
      </ChipGlass>
    ) : (
      <View
        className={cn(
          layout,
          props.selected ? "bg-primary" : small ? "bg-grouped-card" : "bg-subtle",
        )}
      >
        {content}
      </View>
    );
  return props.onPress ? (
    <Animated.View style={animatedScaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityState={{ selected: props.selected, disabled }}
        disabled={disabled}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => undefined);
          props.onPress?.();
        }}
        onPressIn={() => {
          if (!disabled) {
            pressScale.set(withSpring(0.96, PRESS_SPRING_CONFIG));
          }
        }}
        onPressOut={() => {
          pressScale.set(withSpring(1, PRESS_SPRING_CONFIG));
        }}
        hitSlop={hitSlop}
        className={disabled ? "opacity-45" : "active:opacity-70"}
      >
        {body}
      </Pressable>
    </Animated.View>
  ) : (
    body
  );
}

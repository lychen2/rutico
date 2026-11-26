import * as Haptics from "expo-haptics";
import { Platform, Pressable, type ViewStyle } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { FloatingActionButtonProps } from "./FloatingActionButton.types";
import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { AppText } from "./AppText";
import { SymbolView } from "./AppSymbol";
import { cn } from "../../lib/cn";

const PRESS_SPRING_CONFIG = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

export function FloatingActionButton(props: FloatingActionButtonProps) {
  const { themeAppearance } = useAppearancePreferences();
  const isDark = themeAppearance === "dark";
  const pressScale = useSharedValue(1);
  const animatedScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));

  const elevationStyle: ViewStyle =
    Platform.OS === "android"
      ? { elevation: 6 }
      : {
          shadowColor: "#000000",
          shadowOpacity: isDark ? 0.24 : 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        };

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    props.onPress();
  };

  return (
    <Animated.View
      className={props.className}
      style={[elevationStyle, props.style, animatedScaleStyle]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={handlePress}
        onPressIn={() => {
          pressScale.set(withSpring(0.94, PRESS_SPRING_CONFIG));
        }}
        onPressOut={() => {
          pressScale.set(withSpring(1, PRESS_SPRING_CONFIG));
        }}
        className={cn(
          "min-h-14 min-w-14 flex-row items-center justify-center gap-2 rounded-2xl px-4 active:opacity-80",
          props.tone === "primary" ? "bg-primary" : "bg-secondary",
        )}
      >
        <SymbolView
          name={props.icon}
          size={24}
          tintColorClassName={
            props.tone === "primary" ? "accent-primary-foreground" : "accent-secondary-foreground"
          }
        />
        {props.variant === "extended" && props.expanded !== false ? (
          <AppText
            textRole="footnote"
            className={cn(
              props.tone === "primary" ? "text-primary-foreground" : "text-secondary-foreground",
            )}
          >
            {props.label}
          </AppText>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

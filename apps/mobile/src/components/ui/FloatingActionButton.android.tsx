import type { FloatingActionButtonProps } from "./FloatingActionButton.types";
import { NativeThemeHost } from "./NativeThemeHost.android";
import {
  Box,
  ExtendedFloatingActionButton,
  FloatingActionButton as ComposeFloatingActionButton,
  LargeFloatingActionButton,
  Text,
} from "@expo/ui/jetpack-compose";
import { defaultMinSize, height, size, width } from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { useAndroidControlSizing } from "./useAndroidControlSizing";
import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { useScaledTextRole } from "../../features/settings/appearance/useScaledTextRole";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_EFFECTS_FAST } from "../../lib/mobileMotion";
import { SymbolView } from "./AppSymbol";

export function FloatingActionButton(props: FloatingActionButtonProps) {
  const { themeVariables: colors } = useAppearancePreferences();
  const typography = useScaledTextRole("footnote");
  const { scale, iconSize: standardIconSize, fabSize, largeFabSize } = useAndroidControlSizing();
  const buttonSize = props.variant === "large" ? largeFabSize : fabSize;
  const primary = props.tone === "primary";
  const containerColor = colors[primary ? "--color-primary" : "--color-secondary"];
  const contentColor =
    colors[primary ? "--color-primary-foreground" : "--color-secondary-foreground"];
  const Component =
    props.variant === "extended"
      ? ExtendedFloatingActionButton
      : props.variant === "large"
        ? LargeFloatingActionButton
        : ComposeFloatingActionButton;
  const iconSize = props.variant === "large" ? Math.round(36 * scale) : standardIconSize;
  const pressScale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));
  const handlePress = () => {
    pressScale.set(
      withSequence(withSpring(0.94, SPRING_EFFECTS_FAST), withSpring(1, SPRING_EFFECTS_FAST)),
    );
    triggerSemanticHaptic("contextClick");
    props.onPress();
  };
  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={handlePress}
      className={props.className}
      style={[props.style, animatedStyle]}
    >
      <View importantForAccessibility="no-hide-descendants">
        <NativeThemeHost matchContents ignoreSafeAreaKeyboardInsets>
          <Component
            modifiers={[
              defaultMinSize({ minWidth: buttonSize }),
              height(buttonSize),
              ...(props.variant === "extended" ? [] : [width(buttonSize)]),
            ]}
            containerColor={containerColor}
            onClick={handlePress}
            expanded={props.expanded}
          >
            <Component.Icon>
              <Box modifiers={[size(iconSize, iconSize)]} />
            </Component.Icon>
            {props.variant === "extended" ? (
              <ExtendedFloatingActionButton.Text>
                <Text color={contentColor} style={{ ...typography, fontWeight: "500" }}>
                  {props.label}
                </Text>
              </ExtendedFloatingActionButton.Text>
            ) : null}
          </Component>
        </NativeThemeHost>
      </View>
      {/* The RN icon stays outside Compose so it cannot intercept native button taps. */}
      <View
        pointerEvents="none"
        className="absolute inset-y-0 justify-center"
        style={
          props.variant === "extended" ? { left: 16 } : { left: 0, right: 0, alignItems: "center" }
        }
      >
        <SymbolView
          name={props.icon}
          size={iconSize}
          tintColorClassName={primary ? "accent-primary-foreground" : "accent-secondary-foreground"}
        />
      </View>
    </Animated.View>
  );
}

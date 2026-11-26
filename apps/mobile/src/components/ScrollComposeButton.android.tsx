import { NativeThemeHost } from "./ui/NativeThemeHost.android";
import { Box, ExtendedFloatingActionButton, Icon, Text } from "@expo/ui/jetpack-compose";
import {
  defaultMinSize,
  fillMaxWidth,
  height,
  onSizeChanged,
  size,
} from "@expo/ui/jetpack-compose/modifiers";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { I18nManager, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { resolveScaledTextRole } from "../lib/appearancePreferences";
import { triggerSemanticHaptic } from "../lib/hapticChoreography";
import { SPRING_EFFECTS_FAST, SPRING_SPATIAL_SNAPPY } from "../lib/mobileMotion";

/** Keep the animated width and icon positioning entirely inside Compose, not Yoga. */
export function ScrollComposeButton(props: {
  readonly expanded: boolean;
  readonly onPress: () => void;
  readonly size?: number;
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const gt = useGT();
  const { appearance, themeVariables: colors } = useAppearancePreferences();
  const typography = resolveScaledTextRole("footnote", appearance.baseFontSize);
  const { iconSize, fabSize: scaledFabSize } = useAndroidControlSizing();
  const fabSize = props.size ?? scaledFabSize;
  const nativeSize = Math.max(56, fabSize);
  const scale = fabSize / nativeSize;
  const nativeIconSize = Math.round(iconSize / scale);
  const [buttonWidth, setButtonWidth] = useState(nativeSize);
  const rememberWidth = ({ width }: { width: number }) => {
    setButtonWidth((previous) => Math.max(previous, width));
  };
  const pressScale = useSharedValue(1);
  const targetHitWidth = props.expanded ? buttonWidth * scale : fabSize;
  const animatedHitWidth = useDerivedValue(
    () => withSpring(targetHitWidth, SPRING_SPATIAL_SNAPPY),
    [targetHitWidth],
  );
  const visualPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));
  const hitTargetAnimatedStyle = useAnimatedStyle(() => ({
    width: animatedHitWidth.get(),
  }));

  return (
    <View
      pointerEvents="box-none"
      className={props.className}
      style={[props.style, { left: 20, height: fabSize }]}
    >
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[
          {
            transformOrigin: I18nManager.isRTL ? "top left" : "top right",
          },
          visualPressStyle,
        ]}
      >
        <View
          style={{
            transform: [{ scale }],
            transformOrigin: I18nManager.isRTL ? "top left" : "top right",
          }}
        >
          <NativeThemeHost
            matchContents={{ vertical: true }}
            ignoreSafeAreaKeyboardInsets
            style={{ width: "100%" }}
          >
            <Box modifiers={[fillMaxWidth()]} contentAlignment="centerEnd">
              <ExtendedFloatingActionButton
                expanded={props.expanded}
                containerColor={colors["--color-primary"]}
                modifiers={[
                  defaultMinSize({ minWidth: nativeSize }),
                  height(nativeSize),
                  onSizeChanged(rememberWidth),
                ]}
              >
                <ExtendedFloatingActionButton.Icon>
                  <Box modifiers={[size(nativeIconSize, nativeIconSize)]}>
                    <Icon
                      source={require("../../assets/icons/compose.xml")}
                      size={nativeIconSize}
                      tint={colors["--color-primary-foreground"]}
                    />
                  </Box>
                </ExtendedFloatingActionButton.Icon>
                <ExtendedFloatingActionButton.Text>
                  <Text
                    color={colors["--color-primary-foreground"]}
                    style={{
                      fontSize: typography.fontSize / scale,
                      lineHeight: typography.lineHeight / scale,
                      fontWeight: "500",
                    }}
                  >
                    {gt("New thread")}
                  </Text>
                </ExtendedFloatingActionButton.Text>
              </ExtendedFloatingActionButton>
            </Box>
          </NativeThemeHost>
        </View>
      </Animated.View>
      {/* The visual host is wider than the button; only this target intercepts list touches. */}
      <Animated.View
        style={[
          {
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            borderRadius: 16 * scale,
            overflow: "hidden",
          },
          hitTargetAnimatedStyle,
        ]}
      >
        <Pressable
          onPressIn={() => {
            pressScale.set(withSpring(0.94, SPRING_EFFECTS_FAST));
          }}
          onPressOut={() => {
            pressScale.set(withSpring(1, SPRING_EFFECTS_FAST));
          }}
          onPress={() => {
            triggerSemanticHaptic("contextClick");
            props.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={gt("New thread")}
          android_ripple={{ foreground: true }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

import { Image } from "expo-image";
import { useEffect, useId } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { useAppActive } from "../lib/appState";
import { DEFAULT_MOBILE_THEME_ID } from "../lib/mobileTheme";

const MOBILE_HERO_SOURCE = require("../../assets/rutico-hero-mobile.webp");

export type RuticoBackdropVariant = "hero" | "canvas" | "drawer" | "header";

const IMAGE_OPACITY: Readonly<Record<RuticoBackdropVariant, { light: number; dark: number }>> = {
  hero: { light: 0.9, dark: 0.52 },
  canvas: { light: 0.78, dark: 0.38 },
  drawer: { light: 0.68, dark: 0.34 },
  header: { light: 0.56, dark: 0.3 },
};

const SCRIM_STOPS: Readonly<
  Record<
    RuticoBackdropVariant,
    {
      readonly light: readonly [number, number, number];
      readonly dark: readonly [number, number, number];
    }
  >
> = {
  hero: { light: [0.48, 0.24, 0.06], dark: [0.62, 0.36, 0.16] },
  canvas: { light: [0.72, 0.44, 0.14], dark: [0.82, 0.58, 0.32] },
  drawer: { light: [0.58, 0.36, 0.18], dark: [0.8, 0.58, 0.38] },
  header: { light: [0.56, 0.38, 0.24], dark: [0.72, 0.54, 0.34] },
};

export function RuticoMobileBackdrop(
  props: {
    readonly variant?: RuticoBackdropVariant;
    readonly active?: boolean;
  } = {},
) {
  const { themeAppearance, themeId, themeVariables } = useAppearancePreferences();
  const appActive = useAppActive();
  const variant = props.variant ?? "hero";
  const isActive = props.active ?? true;
  const isDark = themeAppearance === "dark";
  const isDefaultTheme = themeId === DEFAULT_MOBILE_THEME_ID;
  const reducedMotion = useReducedMotion();
  const shouldAnimate = isActive && appActive && variant !== "header" && !reducedMotion;
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const scrimGradientId = `rutico-scrim-${safeId}`;
  const auroraGradientId = `rutico-aurora-${safeId}`;

  const drift = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives continuous ambient floating animation on the backdrop while visible and foregrounded
  useEffect(() => {
    if (!shouldAnimate) {
      cancelAnimation(drift);
      drift.set(0);
      return;
    }
    drift.set(
      withRepeat(
        withTiming(1, {
          duration: 9200,
          easing: Easing.inOut(Easing.sin),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(drift);
    };
  }, [drift, shouldAnimate]);

  const imageMotionStyle = useAnimatedStyle(() => {
    const progress = drift.get();
    return {
      transform: [
        { scale: variant === "header" ? 1.02 : interpolate(progress, [0, 1], [1.03, 1.068]) },
        { translateX: variant === "header" ? 0 : interpolate(progress, [0, 1], [0, -6]) },
        { translateY: variant === "header" ? 0 : interpolate(progress, [0, 1], [0, -8]) },
      ],
    };
  });

  const auroraMinOpacity = isDefaultTheme ? 0.14 : 0.08;
  const auroraMaxOpacity = isDefaultTheme ? 0.28 : 0.16;
  const auroraStyle = useAnimatedStyle(() => {
    const progress = drift.get();
    return {
      opacity:
        variant === "header"
          ? auroraMinOpacity
          : interpolate(progress, [0, 1], [auroraMinOpacity, auroraMaxOpacity]),
    };
  });

  const imageOpacity = isDark ? IMAGE_OPACITY[variant].dark : IMAGE_OPACITY[variant].light;
  const stops = isDark ? SCRIM_STOPS[variant].dark : SCRIM_STOPS[variant].light;
  const scrimHex = isDefaultTheme
    ? isDark
      ? "#141022"
      : "#FAF5FF"
    : themeVariables["--color-screen"];
  const auroraPrimary = isDefaultTheme
    ? isDark
      ? "#C77DFF"
      : "#EE93B2"
    : themeVariables["--color-primary"];
  const auroraSecondary = isDefaultTheme ? "#B7A3F5" : themeVariables["--color-focus"];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} className="overflow-hidden">
      <Animated.View style={[StyleSheet.absoluteFill, imageMotionStyle]}>
        <Image
          source={MOBILE_HERO_SOURCE}
          contentFit="cover"
          contentPosition={variant === "header" ? "right center" : "bottom right"}
          accessibilityIgnoresInvertColors
          style={[StyleSheet.absoluteFill, { opacity: imageOpacity }]}
        />
      </Animated.View>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id={scrimGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={scrimHex} stopOpacity={stops[0]} />
            <Stop offset="48%" stopColor={scrimHex} stopOpacity={stops[1]} />
            <Stop offset="100%" stopColor={scrimHex} stopOpacity={stops[2]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${scrimGradientId})`} />
      </Svg>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, auroraStyle]}>
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <RadialGradient id={auroraGradientId} cx="82%" cy="22%" r="60%">
              <Stop offset="0%" stopColor={auroraPrimary} stopOpacity="0.65" />
              <Stop offset="55%" stopColor={auroraSecondary} stopOpacity="0.24" />
              <Stop offset="100%" stopColor={auroraSecondary} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill={`url(#${auroraGradientId})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

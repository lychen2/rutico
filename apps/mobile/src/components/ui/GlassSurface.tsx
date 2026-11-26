import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import type { ReactNode, Ref } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type ColorValue,
  type ViewInstance,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { withUniwind } from "uniwind";

import { MOBILE_SHAPE } from "../../lib/designTokens";
import { cn } from "../../lib/cn";
import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { GlassBackdrop } from "./GlassBackdrop";

// Explicit mappings keep the native glassEffectStyle enum out of style-array conversion.
const ThemedGlassView = withUniwind(GlassView, {
  style: { fromClassName: "className" },
  tintColor: { fromClassName: "tintColorClassName", styleProperty: "accentColor" },
});

interface GlassSurfaceProps extends ViewProps {
  readonly ref?: Ref<ViewInstance>;
  readonly children: ReactNode;
  readonly glassEffectStyle?: "clear" | "regular" | "none";
  // null leaves UIKit's material untinted instead of applying the theme tint.
  readonly tintColor?: ColorValue | null;
  readonly tintColorClassName?: string;
  readonly chrome?: "default" | "none";
  readonly fallbackColor?: ColorValue;
  readonly fallbackClassName?: string;
}

function splitGlassSurfaceStyle(
  style: ViewProps["style"],
  fallbackBorderRadius: number,
): {
  readonly outerStyle: ViewStyle;
  readonly innerStyle: ViewStyle;
} {
  const flat = StyleSheet.flatten(style);
  const borderRadius =
    typeof flat?.borderRadius === "number" ? flat.borderRadius : fallbackBorderRadius;
  if (!flat) {
    return {
      outerStyle: { borderRadius },
      innerStyle: { borderRadius },
    };
  }
  const {
    position,
    top,
    right,
    bottom,
    left,
    start,
    end,
    inset,
    insetBlock,
    insetBlockStart,
    insetBlockEnd,
    insetInline,
    insetInlineStart,
    insetInlineEnd,
    zIndex,
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    alignSelf,
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    aspectRatio,
    margin,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    marginStart,
    marginEnd,
    marginHorizontal,
    marginVertical,
    transform,
    opacity,
    overflow: _overflow,
    borderRadius: _borderRadius,
    borderTopLeftRadius,
    borderTopRightRadius,
    borderBottomLeftRadius,
    borderBottomRightRadius,
    borderTopStartRadius,
    borderTopEndRadius,
    borderBottomStartRadius,
    borderBottomEndRadius,
    borderCurve,
    ...restInner
  } = flat;

  const radiusStyle: ViewStyle = {
    borderRadius,
    ...(borderTopLeftRadius !== undefined ? { borderTopLeftRadius } : null),
    ...(borderTopRightRadius !== undefined ? { borderTopRightRadius } : null),
    ...(borderBottomLeftRadius !== undefined ? { borderBottomLeftRadius } : null),
    ...(borderBottomRightRadius !== undefined ? { borderBottomRightRadius } : null),
    ...(borderTopStartRadius !== undefined ? { borderTopStartRadius } : null),
    ...(borderTopEndRadius !== undefined ? { borderTopEndRadius } : null),
    ...(borderBottomStartRadius !== undefined ? { borderBottomStartRadius } : null),
    ...(borderBottomEndRadius !== undefined ? { borderBottomEndRadius } : null),
    ...(borderCurve !== undefined ? { borderCurve } : null),
  };

  const fillsOuterHeight =
    height !== undefined || flex !== undefined || (flexGrow !== undefined && flexGrow > 0);
  const fillsOuterWidth = width !== undefined;

  const outerStyle: ViewStyle = {
    ...radiusStyle,
    ...(position !== undefined ? { position } : null),
    ...(top !== undefined ? { top } : null),
    ...(right !== undefined ? { right } : null),
    ...(bottom !== undefined ? { bottom } : null),
    ...(left !== undefined ? { left } : null),
    ...(start !== undefined ? { start } : null),
    ...(end !== undefined ? { end } : null),
    ...(inset !== undefined ? { inset } : null),
    ...(insetBlock !== undefined ? { insetBlock } : null),
    ...(insetBlockStart !== undefined ? { insetBlockStart } : null),
    ...(insetBlockEnd !== undefined ? { insetBlockEnd } : null),
    ...(insetInline !== undefined ? { insetInline } : null),
    ...(insetInlineStart !== undefined ? { insetInlineStart } : null),
    ...(insetInlineEnd !== undefined ? { insetInlineEnd } : null),
    ...(zIndex !== undefined ? { zIndex } : null),
    ...(flex !== undefined ? { flex } : null),
    ...(flexGrow !== undefined ? { flexGrow } : null),
    ...(flexShrink !== undefined ? { flexShrink } : null),
    ...(flexBasis !== undefined ? { flexBasis } : null),
    ...(alignSelf !== undefined ? { alignSelf } : null),
    ...(width !== undefined ? { width } : null),
    ...(height !== undefined ? { height } : null),
    ...(minWidth !== undefined ? { minWidth } : null),
    ...(minHeight !== undefined ? { minHeight } : null),
    ...(maxWidth !== undefined ? { maxWidth } : null),
    ...(maxHeight !== undefined ? { maxHeight } : null),
    ...(aspectRatio !== undefined ? { aspectRatio } : null),
    ...(margin !== undefined ? { margin } : null),
    ...(marginTop !== undefined ? { marginTop } : null),
    ...(marginRight !== undefined ? { marginRight } : null),
    ...(marginBottom !== undefined ? { marginBottom } : null),
    ...(marginLeft !== undefined ? { marginLeft } : null),
    ...(marginStart !== undefined ? { marginStart } : null),
    ...(marginEnd !== undefined ? { marginEnd } : null),
    ...(marginHorizontal !== undefined ? { marginHorizontal } : null),
    ...(marginVertical !== undefined ? { marginVertical } : null),
    ...(transform !== undefined ? { transform } : null),
    ...(opacity !== undefined ? { opacity } : null),
  };

  const innerStyle: ViewStyle = {
    ...restInner,
    ...radiusStyle,
    ...(fillsOuterHeight ? { flex: 1 } : null),
    ...(fillsOuterWidth ? { width: "100%" } : null),
    ...(maxHeight !== undefined ? { maxHeight } : null),
  };

  return { outerStyle, innerStyle };
}

export function GlassSurface({
  ref,
  children,
  glassEffectStyle = "regular",
  chrome = "default",
  tintColor,
  tintColorClassName,
  fallbackColor,
  fallbackClassName,
  className,
  style,
  ...props
}: GlassSurfaceProps) {
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const supportsGlass = Platform.OS === "ios" && isGlassEffectAPIAvailable();
  const hasShadow = chrome !== "none";

  // Keep chrome="none" as a single native view so Animated.createAnimatedComponent(GlassSurface)
  // drives layout/borderRadius directly on the clipped host without an intermediate wrapper.
  if (!hasShadow) {
    const bareSurfaceStyle: ViewStyle = {
      borderRadius: MOBILE_SHAPE.glass,
      overflow: "hidden",
    };

    if (supportsGlass) {
      return (
        <ThemedGlassView
          {...props}
          ref={ref}
          className={cn("border-0 border-transparent bg-transparent", className)}
          glassEffectStyle={glassEffectStyle}
          tintColor={tintColor == null ? undefined : String(tintColor)}
          tintColorClassName={
            tintColorClassName ?? (tintColor === undefined ? "accent-glass-tint" : undefined)
          }
          colorScheme={isDarkMode ? "dark" : "light"}
          style={[bareSurfaceStyle, style]}
        >
          {children}
        </ThemedGlassView>
      );
    }

    return (
      <View
        {...props}
        ref={ref}
        className={cn("border-0 border-transparent", fallbackClassName, className)}
        style={[bareSurfaceStyle, style]}
      >
        <GlassBackdrop fallbackColor={fallbackColor} />
        {children}
      </View>
    );
  }

  const { outerStyle, innerStyle } = splitGlassSurfaceStyle(style, MOBILE_SHAPE.glass);
  const shadowWrapperStyle: ViewStyle =
    Platform.OS === "android"
      ? {
          ...outerStyle,
          overflow: "visible",
          boxShadow: [
            {
              offsetX: 0,
              offsetY: 6,
              blurRadius: 18,
              color: isDarkMode ? "rgba(0, 0, 0, 0.34)" : "rgba(0, 0, 0, 0.12)",
            },
          ],
        }
      : {
          ...outerStyle,
          overflow: "visible",
          shadowColor: "#000000",
          shadowOpacity: isDarkMode ? 0.22 : 0.08,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
        };
  const clippedContentStyle: ViewStyle = {
    ...innerStyle,
    overflow: "hidden",
  };

  if (supportsGlass) {
    return (
      <View {...props} ref={ref} style={shadowWrapperStyle}>
        <ThemedGlassView
          className={cn("border border-border bg-glass-surface", className)}
          glassEffectStyle={glassEffectStyle}
          tintColor={tintColor == null ? undefined : String(tintColor)}
          tintColorClassName={
            tintColorClassName ?? (tintColor === undefined ? "accent-glass-tint" : undefined)
          }
          colorScheme={isDarkMode ? "dark" : "light"}
          style={clippedContentStyle}
        >
          {children}
        </ThemedGlassView>
      </View>
    );
  }

  return (
    <View {...props} ref={ref} style={shadowWrapperStyle}>
      <View
        className={cn("border border-border", fallbackClassName, className)}
        style={clippedContentStyle}
      >
        <GlassBackdrop fallbackColor={fallbackColor} />
        {children}
      </View>
    </View>
  );
}

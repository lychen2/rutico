import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View, type ColorValue } from "react-native";

import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { themeColorWithAlpha } from "../../lib/mobileTheme";

export function GlassBackdrop(props: { readonly fallbackColor?: ColorValue }) {
  const { themeAppearance, themeVariables } = useAppearancePreferences();
  const supportsBlur = Platform.OS === "ios";
  const color = props.fallbackColor ?? themeVariables["--color-glass-fallback"];
  const fallbackAlpha = themeAppearance === "dark" ? 0.76 : 0.82;
  const colorStyle = {
    backgroundColor: supportsBlur
      ? color
      : props.fallbackColor !== undefined
        ? props.fallbackColor
        : typeof color === "string"
          ? themeColorWithAlpha(color, fallbackAlpha)
          : color,
  };
  const specularHighlightColor =
    themeAppearance === "dark" ? "rgba(226, 214, 255, 0.12)" : "rgba(255, 255, 255, 0.62)";

  return (
    <>
      {supportsBlur ? (
        <BlurView
          pointerEvents="none"
          intensity={80}
          tint={themeAppearance === "dark" ? "dark" : "default"}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        pointerEvents="none"
        className="absolute inset-0 bg-glass-fallback"
        style={colorStyle}
      />
      {!supportsBlur ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: specularHighlightColor,
          }}
        />
      ) : null}
    </>
  );
}

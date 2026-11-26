import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View, type ColorValue } from "react-native";

import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { resolveGlassBackdropTintColor } from "../../lib/mobileTheme";

export function GlassBackdrop(props: { readonly fallbackColor?: ColorValue }) {
  const { themeAppearance, themeVariables } = useAppearancePreferences();
  const supportsBlur = Platform.OS === "ios";
  const color = props.fallbackColor ?? themeVariables["--color-glass-fallback"];
  const colorStyle = {
    backgroundColor:
      props.fallbackColor !== undefined
        ? props.fallbackColor
        : typeof color === "string"
          ? resolveGlassBackdropTintColor(color, themeAppearance, supportsBlur)
          : color,
  };
  const specularHighlightColor =
    themeAppearance === "dark" ? "rgba(226, 214, 255, 0.1)" : "rgba(255, 255, 255, 0.55)";

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
      <View pointerEvents="none" className="absolute inset-0" style={colorStyle} />
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
    </>
  );
}

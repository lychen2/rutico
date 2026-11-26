import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../../features/layout/adaptive-workspace-context";
import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { cn } from "../../lib/cn";
import { DEFAULT_MOBILE_THEME_ID, themeColorWithAlpha } from "../../lib/mobileTheme";
import { RuticoMobileBackdrop } from "../RuticoMobileBackdrop";

const SURFACE_CLASS_NAMES = {
  sheet: "bg-sheet-solid",
  screen: "bg-screen",
  canvas: "bg-thread-canvas",
  drawer: "bg-drawer",
} as const;

const SURFACE_THEME_VARS = {
  sheet: "--color-sheet-solid",
  screen: "--color-screen",
  canvas: "--color-thread-canvas",
  drawer: "--color-drawer",
} as const;

/**
 * The body below a screen's AppBar. On Android it is the rounded card every pane and sheet
 * draws under its bar; a screen picks only the card's surface.
 */
export function ScreenContent({
  children,
  surface = "sheet",
  backdrop,
  insetHorizontal,
  fitToContents = false,
  onLayout,
}: {
  readonly children: ReactNode;
  readonly surface?: keyof typeof SURFACE_CLASS_NAMES;
  readonly backdrop?: "hero" | "canvas" | "drawer";
  /** Keeps the card off the window edge. Defaults to on wherever the workspace is split. */
  readonly insetHorizontal?: boolean;
  readonly fitToContents?: boolean;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { layout } = useAdaptiveWorkspaceLayout();
  const { themeAppearance, themeId, themeVariables } = useAppearancePreferences();
  const hasBackdrop = backdrop !== undefined;
  const surfaceColor = themeVariables[SURFACE_THEME_VARS[surface]];
  const backdropTintColor = hasBackdrop
    ? themeColorWithAlpha(
        surfaceColor,
        backdrop === "hero" ? 0.12 : themeAppearance === "dark" ? 0.22 : 0.18,
      )
    : undefined;

  if (Platform.OS !== "android") {
    if (hasBackdrop) {
      return (
        <View
          className={cn(
            fitToContents ? "shrink" : "flex-1",
            "overflow-hidden",
            SURFACE_CLASS_NAMES[surface],
          )}
          onLayout={onLayout}
        >
          <RuticoMobileBackdrop variant={backdrop} />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: backdropTintColor }]}
          />
          {children}
        </View>
      );
    }
    return onLayout ? (
      <View className="flex-1" onLayout={onLayout}>
        {children}
      </View>
    ) : (
      children
    );
  }

  const borderColor = hasBackdrop
    ? themeId === DEFAULT_MOBILE_THEME_ID
      ? themeAppearance === "dark"
        ? "rgba(196, 178, 255, 0.18)"
        : "rgba(155, 130, 235, 0.24)"
      : themeColorWithAlpha(
          themeVariables["--color-primary"],
          themeAppearance === "dark" ? 0.18 : 0.22,
        )
    : undefined;

  return (
    <View className={fitToContents ? "shrink bg-header" : "flex-1 bg-header"}>
      <View
        className={`overflow-hidden rounded-t-[28px] ${hasBackdrop ? "bg-screen" : SURFACE_CLASS_NAMES[surface]}`}
        collapsable={false}
        onLayout={onLayout}
        style={{
          flexShrink: 1,
          flexGrow: fitToContents ? 0 : 1,
          flexBasis: fitToContents ? "auto" : 0,
          marginHorizontal: (insetHorizontal ?? layout.usesSplitView) ? 4 : 0,
          ...(hasBackdrop
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderColor,
              }
            : undefined),
        }}
      >
        {hasBackdrop ? (
          <>
            <RuticoMobileBackdrop variant={backdrop} />
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: backdropTintColor }]}
            />
          </>
        ) : null}
        {children}
      </View>
    </View>
  );
}

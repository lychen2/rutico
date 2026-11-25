import { msg } from "gt-react-native";
import type { ViewStyle } from "react-native";

import { m, type MessageResolver } from "../../i18n/messages";
import { themeColorWithAlpha, type MobileThemeVariables } from "../../lib/mobileTheme";

export const THREAD_LIST_V2_MONO_FONT = "Menlo";
export const THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME = "px-5 py-2.5";
export const THREAD_LIST_V2_ROW_DIVIDERS = true;
export const THREAD_LIST_V2_SIDEBAR_ROW_STYLE = {
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
} satisfies ViewStyle;
export const THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE = {
  borderRadius: 12,
  overflow: "hidden",
} satisfies ViewStyle;

export const selectedThreadRowColors = {
  foregroundClassName: "text-thread-selected-foreground",
  mutedForegroundClassName: "text-thread-selected-foreground-muted",
  iconTintClassName: "accent-thread-selected-foreground",
  mutedIconTintClassName: "accent-thread-selected-foreground-muted",
};

export function getThreadListV2NewBranchMenuTitle(_branch: string, resolve: MessageResolver = m) {
  return resolve(msg("New thread on branch"));
}

export function getThreadListV2RowAppearance(
  theme: MobileThemeVariables,
  sidebarPane: boolean,
  selected: boolean,
  options?: { readonly translucent?: boolean },
) {
  const selectedBackgroundColor = theme["--color-thread-selected"];
  const translucent = options?.translucent === true;
  const style: ViewStyle | undefined = sidebarPane
    ? {
        backgroundColor: selected
          ? translucent
            ? themeColorWithAlpha(selectedBackgroundColor, 0.88)
            : selectedBackgroundColor
          : translucent
            ? themeColorWithAlpha(theme["--color-drawer"], 0.38)
            : theme["--color-drawer"],
        borderRadius: THREAD_LIST_V2_SIDEBAR_ROW_STYLE.borderRadius,
      }
    : translucent
      ? {
          backgroundColor: selected
            ? themeColorWithAlpha(selectedBackgroundColor, 0.88)
            : themeColorWithAlpha(theme["--color-screen"], 0.34),
        }
      : undefined;
  const swipeContainerStyle: ViewStyle | undefined = sidebarPane
    ? THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE
    : undefined;
  const rawSwipeBg = theme[sidebarPane ? "--color-drawer" : "--color-screen"];

  return {
    className: sidebarPane || translucent ? undefined : "bg-screen",
    interactionClassName: sidebarPane ? "bg-thread-hover" : "bg-row-hover",
    interactionOpacity: selected ? 0 : 1,
    foregroundClassName: sidebarPane ? "text-drawer-foreground" : "text-foreground",
    mutedForegroundClassName: sidebarPane
      ? "text-drawer-foreground-muted"
      : "text-foreground-muted",
    tertiaryForegroundClassName: sidebarPane
      ? "text-drawer-foreground-muted"
      : "text-foreground-tertiary",
    mutedIconTintClassName: sidebarPane
      ? "accent-drawer-foreground-muted"
      : "accent-foreground-muted",
    tertiaryIconTintClassName: sidebarPane
      ? "accent-drawer-foreground-muted"
      : "accent-foreground-tertiary",
    style,
    cardStyle: sidebarPane ? { ...style, ...THREAD_LIST_V2_SIDEBAR_ROW_STYLE } : style,
    swipeContainerStyle,
    swipeBackgroundColor: translucent ? themeColorWithAlpha(rawSwipeBg, 0.84) : rawSwipeBg,
    providerIconSurfaceColor: sidebarPane
      ? selected
        ? selectedBackgroundColor
        : theme["--color-drawer"]
      : theme["--color-screen"],
  };
}

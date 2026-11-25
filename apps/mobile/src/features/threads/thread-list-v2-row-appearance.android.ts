import { msg } from "gt-react-native";
import type { ViewStyle } from "react-native";

import { m, type MessageResolver } from "../../i18n/messages";
import { themeColorWithAlpha, type MobileThemeVariables } from "../../lib/mobileTheme";

export const THREAD_LIST_V2_MONO_FONT = "monospace";
export const THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME = "px-3 py-2.5";
export const THREAD_LIST_V2_ROW_DIVIDERS = false;
export const THREAD_LIST_V2_SIDEBAR_ROW_STYLE = {
  borderRadius: 20,
  paddingHorizontal: 12,
  paddingVertical: 10,
} satisfies ViewStyle;
export const THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE = {
  borderRadius: 20,
  overflow: "hidden",
  marginHorizontal: 8,
  marginVertical: 2,
} satisfies ViewStyle;

export const selectedThreadRowColors = {
  foregroundClassName: "text-thread-selected-foreground",
  mutedForegroundClassName: "text-thread-selected-foreground-muted",
  iconTintClassName: "accent-thread-selected-foreground",
  mutedIconTintClassName: "accent-thread-selected-foreground-muted",
};

export function getThreadListV2NewBranchMenuTitle(branch: string, resolve: MessageResolver = m) {
  return resolve(msg("New thread on {branch}", { branch }));
}

export function getThreadListV2RowAppearance(
  theme: MobileThemeVariables,
  sidebarPane: boolean,
  selected: boolean,
  options?: { readonly translucent?: boolean },
) {
  const selectedBackgroundColor = theme["--color-thread-selected"];
  const backgroundColor = theme[sidebarPane ? "--color-drawer" : "--color-screen"];
  const translucent = options?.translucent === true;
  const resolvedBackgroundColor = selected
    ? translucent
      ? themeColorWithAlpha(selectedBackgroundColor, 0.88)
      : selectedBackgroundColor
    : translucent
      ? themeColorWithAlpha(backgroundColor, sidebarPane ? 0.38 : 0.34)
      : backgroundColor;
  const style: ViewStyle = {
    backgroundColor: resolvedBackgroundColor,
    borderRadius: THREAD_LIST_V2_SIDEBAR_ROW_STYLE.borderRadius,
  };
  const swipeContainerStyle = THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE;

  return {
    className: undefined,
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
    swipeBackgroundColor: translucent
      ? themeColorWithAlpha(backgroundColor, 0.84)
      : backgroundColor,
    providerIconSurfaceColor: selected ? selectedBackgroundColor : backgroundColor,
  };
}

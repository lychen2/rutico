import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { msg, T, useGT, useMessages } from "gt-react";
import { MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { m } from "../i18n/messages";
import { useCustomThemes } from "../hooks/useCustomThemes";
import { useEnvironmentThemeDefinitions } from "../hooks/useEnvironmentTheme";
import { refreshTheme, useTheme } from "../hooks/useTheme";
import {
  getThemeDefinition,
  previewThemePreference,
  THEME_PREVIEW_ID,
  type ThemeAppearance,
  type ThemePreferenceMode,
} from "../themePalette";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import { toggleThemeEditorForTheme } from "./settings/themeEditorStore";
import {
  STANDARD_THEME_CARDS,
  getThemeCardDefinition,
  ThemePreviewCircle,
} from "./settings/ThemePreviewCircles";
import { stackedThreadToast, toastManager } from "./ui/toast";

export const APPEARANCE_OPTIONS = [
  { mode: "system", label: msg("System"), icon: MonitorIcon },
  { mode: "light", label: msg("Light"), icon: SunIcon },
  { mode: "dark", label: msg("Dark"), icon: MoonIcon },
] as const;

export function notifyThemeSaveFailure(): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: m(msg("Couldn't save theme selection")),
      description: m(msg("Try again.")),
    }),
  );
}

// Reads its own source hooks so the compiler caches the cards on them. Taking the
// sources as arguments would leave it hook-free, and the compiler would cache nothing.
function useThemeCards() {
  const customThemes = useCustomThemes();
  const environmentThemes = useEnvironmentThemeDefinitions();
  const seen = new Set<string>();
  return [
    ...STANDARD_THEME_CARDS.map((card) => ({ ...card, id: null })),
    ...[...BUILT_IN_THEMES, ...customThemes, ...environmentThemes]
      .filter((definition) => {
        if (seen.has(definition.id)) return false;
        seen.add(definition.id);
        return true;
      })
      .map(getThemeCardDefinition),
  ];
}

const LIVE_THEME_PREVIEW_DEBOUNCE_MS = 60;

type PaletteThemePreviewTarget =
  | { readonly kind: "theme"; readonly id: string | null }
  | { readonly kind: "appearance"; readonly mode: ThemePreferenceMode };

function parsePaletteThemePreviewTarget(
  highlightedItemValue: string | null,
): PaletteThemePreviewTarget | null {
  if (!highlightedItemValue) return null;
  if (highlightedItemValue === "theme:standard") {
    return { kind: "theme", id: null };
  }
  if (highlightedItemValue.startsWith("theme:palette:")) {
    return { kind: "theme", id: highlightedItemValue.slice("theme:palette:".length) };
  }
  if (
    highlightedItemValue === "appearance:system" ||
    highlightedItemValue === "appearance:light" ||
    highlightedItemValue === "appearance:dark"
  ) {
    return {
      kind: "appearance",
      mode: highlightedItemValue.slice("appearance:".length) as ThemePreferenceMode,
    };
  }
  return null;
}

function clearPalettePreviewMarker(): void {
  if (typeof document === "undefined") return;
  if (document.documentElement.dataset.themeId === THEME_PREVIEW_ID) {
    delete document.documentElement.dataset.themeId;
  }
}

/**
 * Live-previews highlighted CommandPalette theme & appearance entries with a 60ms debounce
 * using non-destructive `THEME_PREVIEW_ID`, restoring the stored theme on exit/cancel.
 */
export function useCommandPaletteThemeLivePreview(highlightedItemValue: string | null): void {
  const { theme, themeHalves, resolvedTheme } = useTheme();
  const ownsPreviewRef = useRef(false);
  const target = parsePaletteThemePreviewTarget(highlightedItemValue);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies debounced non-destructive DOM theme preview while navigating palette items
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    if (!target) {
      if (ownsPreviewRef.current) {
        ownsPreviewRef.current = false;
        refreshTheme({ preservePreview: false });
      }
      return;
    }

    // Do not clobber an active Theme Editor draft preview owned outside the command palette.
    if (!ownsPreviewRef.current && document.documentElement.dataset.themeId === THEME_PREVIEW_ID) {
      return;
    }

    const timer = window.setTimeout(() => {
      ownsPreviewRef.current = true;
      if (target.kind === "theme") {
        previewThemePreference(target.id, resolvedTheme);
        return;
      }
      const nextAppearance: ThemeAppearance =
        target.mode === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : target.mode;
      const effectiveThemeId =
        themeHalves?.[nextAppearance] ?? getThemeDefinition(theme)?.id ?? null;
      previewThemePreference(effectiveThemeId, nextAppearance);
    }, LIVE_THEME_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [resolvedTheme, target, theme, themeHalves]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores the persisted theme if the command palette closes during an active preview
  useEffect(() => {
    return () => {
      if (ownsPreviewRef.current) {
        ownsPreviewRef.current = false;
        if (
          typeof document !== "undefined" &&
          document.documentElement.dataset.themeId === THEME_PREVIEW_ID
        ) {
          refreshTheme({ preservePreview: false });
        }
      }
    };
  }, []);
}

export function useCommandPaletteThemeItems() {
  const {
    theme,
    themeHalves,
    resolvedTheme,
    appearanceMode,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
  } = useTheme();
  const themeCards = useThemeCards();
  const gt = useGT();
  const messages = useMessages();

  const changeThemeItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-theme",
    searchTerms: ["change theme", "appearance", "colors", "palette"],
    title: gt("Change theme"),
    icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <PaletteIcon className={ADDON_ICON_CLASS} />,
    shortcutCommand: "theme.select",
    groups: [
      {
        value: "themes",
        label: gt("Change theme"),
        items: themeCards.map(({ id, label, previews }) => ({
          kind: "action",
          value: id === null ? "theme:standard" : `theme:palette:${id}`,
          title: label,
          description:
            previews.length === 1
              ? previews[0]!.mode === "light"
                ? gt("For light mode")
                : gt("For dark mode")
              : undefined,
          searchTerms: [label, "theme", "appearance"],
          icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
          titleTrailingContent: (
            <span className="flex shrink-0 items-center gap-2">
              {(themeHalves?.[resolvedTheme] ?? getThemeDefinition(theme)?.id ?? null) === id ? (
                <span className="text-xs text-muted-foreground/70">
                  <T context="the theme or mode in use now">Current</T>
                </span>
              ) : null}
              <span className="flex items-center gap-1" aria-hidden>
                {previews.map((preview) => (
                  <ThemePreviewCircle
                    key={preview.mode}
                    colors={preview.colors}
                    mode={preview.mode}
                    className="size-3 border-0"
                  />
                ))}
              </span>
            </span>
          ),
          run: async () => {
            clearPalettePreviewMarker();
            const saved =
              previews.length === 1 && id !== null
                ? setThemeHalf(previews[0]!.mode, id)
                : setTheme(id ?? appearanceMode);
            if (!saved) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };

  const changeAppearanceItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-appearance",
    searchTerms: ["change appearance", "light", "dark", "system", "mode", "toggle"],
    title: gt("Change appearance"),
    icon: <MonitorIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <MonitorIcon className={ADDON_ICON_CLASS} />,
    shortcutCommand: "appearance.cycle",
    groups: [
      {
        value: "appearance",
        label: gt("Change appearance"),
        items: APPEARANCE_OPTIONS.map(({ mode, label, icon: Icon }) => ({
          kind: "action",
          value: `appearance:${mode}`,
          title: messages(label),
          searchTerms: [messages(label), label, "appearance", "mode"],
          icon: <Icon className={ITEM_ICON_CLASS} />,
          titleTrailingContent:
            appearanceMode === mode ? (
              <span className="text-xs text-muted-foreground/70">
                <T context="the theme or mode in use now">Current</T>
              </span>
            ) : undefined,
          run: async () => {
            clearPalettePreviewMarker();
            if (!setAppearanceMode(mode)) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };

  const themeEditorItem: CommandPaletteActionItem = {
    kind: "action",
    value: "action:theme-editor",
    searchTerms: ["theme", "appearance", "colors", "palette", "customize"],
    title: gt("Toggle theme editor"),
    icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "themeEditor.toggle",
    run: async () => {
      toggleThemeEditorForTheme({
        theme,
        themeHalves,
        initialAppearance: resolvedTheme,
      });
    },
  };

  return { changeThemeItem, changeAppearanceItem, themeEditorItem };
}

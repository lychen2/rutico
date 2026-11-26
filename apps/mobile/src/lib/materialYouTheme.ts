import type { MobileThemeAppearance, MobileThemeVariables } from "./mobileTheme";
import type { MaterialYouPalette } from "./materialYouPalette";

export interface MaterialYouTonalSwatch {
  readonly id: "primary" | "secondary" | "surface" | "accent";
  readonly core: string;
  readonly ring: string;
  readonly container: string;
}

export function materialYouPaletteToMobileThemeVariables(
  _palette: MaterialYouPalette,
  _appearance: MobileThemeAppearance,
  base: MobileThemeVariables,
): MobileThemeVariables {
  return base;
}

export function extractMaterialYouTonalSwatches(
  palette: MaterialYouPalette,
  _appearance: MobileThemeAppearance,
): ReadonlyArray<MaterialYouTonalSwatch> {
  return [
    {
      id: "primary",
      core: palette.primary,
      ring: palette.primaryContainer,
      container: palette.surfaceContainerLow,
    },
    {
      id: "secondary",
      core: palette.secondaryContainer,
      ring: palette.onSecondaryContainer,
      container: palette.surfaceContainer,
    },
    {
      id: "surface",
      core: palette.surfaceContainerHigh,
      ring: palette.outlineVariant,
      container: palette.surface,
    },
    {
      id: "accent",
      core: palette.tertiary,
      ring: palette.tertiaryContainer,
      container: palette.surfaceContainerLow,
    },
  ];
}

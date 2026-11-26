import "culori/css";
import { converter, parse } from "culori/fn";
import { describe, expect, it } from "vite-plus/test";

import { applyAppearanceContrast, applyLinuxPortalContrast } from "../appearanceContrast";
import { deriveLinuxPortalAccentPalette, getStandardPaintedThemeColors } from "../themePalette";

const toRgb = converter("rgb");

function relativeLuminance(colorString: string): number {
  const parsed = parse(colorString);
  if (!parsed) throw new Error(`Failed to parse CSS color: ${colorString}`);
  const rgb = toRgb(parsed);
  const linearize = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel));
    return clamped <= 0.03928 ? clamped / 12.92 : ((clamped + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

function contrastRatio(first: string, second: string): number {
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("deriveLinuxPortalAccentPalette", () => {
  const samples = [
    { name: "GNOME Adwaita blue", rgb: { r: 0.21, g: 0.52, b: 0.89 } },
    { name: "KDE Breeze cyan", rgb: { r: 0.24, g: 0.68, b: 0.91 } },
    { name: "Ubuntu orange", rgb: { r: 0.91, g: 0.33, b: 0.13 } },
    { name: "extreme neon yellow", rgb: { r: 1, g: 1, b: 0 } },
    { name: "extreme deep navy", rgb: { r: 0.04, g: 0.05, b: 0.2 } },
    { name: "pure white", rgb: { r: 1, g: 1, b: 1 } },
    { name: "pure black", rgb: { r: 0, g: 0, b: 0 } },
  ] as const;

  const cases = (["light", "dark"] as const).flatMap((appearance) =>
    samples.map((sample) => ({ ...sample, appearance })),
  );

  it.each(cases)(
    "maintains WCAG AA (>= 4.5:1) contrast for $name in $appearance mode",
    ({ rgb, appearance }) => {
      const palette = deriveLinuxPortalAccentPalette(rgb, appearance);
      const standard = getStandardPaintedThemeColors(appearance);

      expect(contrastRatio(palette.accent, standard.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette.accentSurfaceForeground, palette.accentSurface),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("applyLinuxPortalContrast", () => {
  it("boosts contrast variables when portal contrast is high without clobbering stronger user contrast", () => {
    const props = new Map<string, string>();
    const fakeRoot = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (key: string, value: string) => props.set(key, value),
      },
    } as unknown as HTMLElement;

    applyAppearanceContrast(fakeRoot, 100);
    expect(props.get("--appearance-contrast-boost")).toBe("0%");

    applyLinuxPortalContrast(fakeRoot, "high");
    expect(fakeRoot.dataset.linuxPortalContrast).toBe("high");
    expect(props.get("--appearance-contrast-boost")).toBe("25%");
    expect(props.get("--appearance-contrast-border-boost")).toBe("6.25%");

    // Stronger user preference wins over portal minimum boost.
    applyAppearanceContrast(fakeRoot, 140);
    expect(props.get("--appearance-contrast-boost")).toBe("40%");

    // Clearing portal high contrast restores user setting cleanly.
    applyAppearanceContrast(fakeRoot, 100);
    applyLinuxPortalContrast(fakeRoot, "no-preference");
    expect(fakeRoot.dataset.linuxPortalContrast).toBeUndefined();
    expect(props.get("--appearance-contrast-boost")).toBe("0%");
  });
});

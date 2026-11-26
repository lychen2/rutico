import type { LinuxPortalContrast } from "@t3tools/contracts";
import type { AppearanceContrast } from "@t3tools/contracts/settings";

const PORTAL_HIGH_CONTRAST_MINIMUM = 125;

let lastUserContrast: AppearanceContrast = 100;
let portalHighContrastActive = false;

function writeContrastVariables(root: HTMLElement, effectiveContrast: number): void {
  root.style.setProperty("--appearance-contrast-base", `${Math.min(effectiveContrast, 100)}%`);
  root.style.setProperty("--appearance-contrast-boost", `${Math.max(effectiveContrast - 100, 0)}%`);
  root.style.setProperty(
    "--appearance-contrast-border-boost",
    `${Math.max(effectiveContrast - 100, 0) / 4}%`,
  );
}

export function applyAppearanceContrast(root: HTMLElement, contrast: AppearanceContrast): void {
  lastUserContrast = contrast;
  const effectiveContrast = portalHighContrastActive
    ? Math.max(contrast, PORTAL_HIGH_CONTRAST_MINIMUM)
    : contrast;
  writeContrastVariables(root, effectiveContrast);
}

export function applyLinuxPortalContrast(
  root: HTMLElement,
  contrast: LinuxPortalContrast | null,
): void {
  portalHighContrastActive = contrast === "high";
  if (portalHighContrastActive) {
    root.dataset.linuxPortalContrast = "high";
  } else {
    delete root.dataset.linuxPortalContrast;
  }
  const effectiveContrast = portalHighContrastActive
    ? Math.max(lastUserContrast, PORTAL_HIGH_CONTRAST_MINIMUM)
    : lastUserContrast;
  writeContrastVariables(root, effectiveContrast);
}

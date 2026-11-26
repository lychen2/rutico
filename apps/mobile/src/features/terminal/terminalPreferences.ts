export const DEFAULT_TERMINAL_FONT_SIZE = 10.5;
export const TERMINAL_FONT_SIZE_STEP = 0.5;
export const MIN_TERMINAL_FONT_SIZE = 6;
export const MAX_TERMINAL_FONT_SIZE = 20;
export const WORKBENCH_TERMINAL_FONT_SIZE_OFFSET = 1;
export const WORKBENCH_TERMINAL_MIN_FONT_SIZE = 10;

export function normalizeTerminalFontSize(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }

  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, value));
}

/** Workbench terminal renders 1sp smaller than fullscreen while honoring a readable floor. */
export function resolveWorkbenchTerminalFontSize(persistedFontSize: number): number {
  return Math.max(
    WORKBENCH_TERMINAL_MIN_FONT_SIZE,
    normalizeTerminalFontSize(persistedFontSize) - WORKBENCH_TERMINAL_FONT_SIZE_OFFSET,
  );
}

/** Maps a workbench display font size back to the persisted fullscreen preference (+1sp offset). */
export function workbenchDisplayToPersistedTerminalFontSize(displayFontSize: number): number {
  const clampedDisplay = Math.max(WORKBENCH_TERMINAL_MIN_FONT_SIZE, displayFontSize);
  return normalizeTerminalFontSize(clampedDisplay + WORKBENCH_TERMINAL_FONT_SIZE_OFFSET);
}

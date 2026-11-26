import type { PendingModifier } from "./terminalInput";

export const STICKY_MODIFIER_DOUBLE_TAP_MS = 350;
export const TRACKPAD_CURSOR_STEP_PX = 18;

export interface StickyModifierState {
  readonly modifier: PendingModifier;
  readonly locked: boolean;
}

/**
 * Transitions a terminal modifier key across off -> one-shot -> sticky-locked -> off.
 * Double-tapping an armed modifier within `STICKY_MODIFIER_DOUBLE_TAP_MS` locks it.
 */
export function nextStickyModifierState(input: {
  readonly current: StickyModifierState | null;
  readonly modifier: PendingModifier;
  readonly nowMs?: number;
  readonly lastTapMs: number;
}): {
  readonly next: StickyModifierState | null;
  readonly didLock: boolean;
  readonly tapMs: number;
} {
  const { current, modifier, lastTapMs } = input;
  const nowMs = input.nowMs ?? Date.now();
  if (current?.modifier === modifier) {
    if (!current.locked && nowMs - lastTapMs <= STICKY_MODIFIER_DOUBLE_TAP_MS) {
      return { next: { modifier, locked: true }, didLock: true, tapMs: nowMs };
    }
    return { next: null, didLock: false, tapMs: nowMs };
  }
  return { next: { modifier, locked: false }, didLock: false, tapMs: nowMs };
}

export function consumeStickyModifierState(
  current: StickyModifierState | null,
): StickyModifierState | null {
  if (current === null || !current.locked) {
    return null;
  }
  return current;
}

export function computeTrackpadCursorSteps(
  accumulatedDx: number,
  stepPx = TRACKPAD_CURSOR_STEP_PX,
): {
  readonly steps: number;
  readonly remainder: number;
  readonly sequence: string;
} {
  if (!Number.isFinite(accumulatedDx) || stepPx <= 0) {
    return { steps: 0, remainder: 0, sequence: "" };
  }
  const steps = Math.trunc(accumulatedDx / stepPx);
  if (steps === 0) {
    return { steps: 0, remainder: accumulatedDx, sequence: "" };
  }
  const remainder = accumulatedDx - steps * stepPx;
  const sequence = (steps > 0 ? "\u001b[C" : "\u001b[D").repeat(Math.abs(steps));
  return { steps, remainder, sequence };
}

import { describe, expect, it } from "vite-plus/test";
import {
  STICKY_MODIFIER_DOUBLE_TAP_MS,
  computeTrackpadCursorSteps,
  consumeStickyModifierState,
  nextStickyModifierState,
} from "./terminalAndroidControls";

describe("terminalAndroidControls", () => {
  it("arms one-shot modifier on first tap and locks on fast second tap", () => {
    const first = nextStickyModifierState({
      current: null,
      modifier: "ctrl",
      nowMs: 1000,
      lastTapMs: 0,
    });
    expect(first).toEqual({
      next: { modifier: "ctrl", locked: false },
      didLock: false,
      tapMs: 1000,
    });

    const locked = nextStickyModifierState({
      current: first.next,
      modifier: "ctrl",
      nowMs: 1000 + STICKY_MODIFIER_DOUBLE_TAP_MS - 50,
      lastTapMs: 1000,
    });
    expect(locked).toEqual({
      next: { modifier: "ctrl", locked: true },
      didLock: true,
      tapMs: 1000 + STICKY_MODIFIER_DOUBLE_TAP_MS - 50,
    });

    // Locked modifier survives consumption; one-shot modifier clears.
    expect(consumeStickyModifierState(locked.next)).toEqual(locked.next);
    expect(consumeStickyModifierState(first.next)).toBeNull();

    // Tapping a locked modifier turns it off.
    const cleared = nextStickyModifierState({
      current: locked.next,
      modifier: "ctrl",
      nowMs: 2000,
      lastTapMs: 1300,
    });
    expect(cleared).toEqual({ next: null, didLock: false, tapMs: 2000 });
  });

  it("disarms one-shot modifier when tapped slowly a second time", () => {
    const cleared = nextStickyModifierState({
      current: { modifier: "ctrl", locked: false },
      modifier: "ctrl",
      nowMs: 2000,
      lastTapMs: 1000,
    });
    expect(cleared).toEqual({ next: null, didLock: false, tapMs: 2000 });
  });

  it("emits left and right ANSI cursor steps with remainder preservation", () => {
    expect(computeTrackpadCursorSteps(10, 18)).toEqual({
      steps: 0,
      remainder: 10,
      sequence: "",
    });
    expect(computeTrackpadCursorSteps(40, 18)).toEqual({
      steps: 2,
      remainder: 4,
      sequence: "\u001b[C\u001b[C",
    });
    expect(computeTrackpadCursorSteps(-22, 18)).toEqual({
      steps: -1,
      remainder: -4,
      sequence: "\u001b[D",
    });
  });
});

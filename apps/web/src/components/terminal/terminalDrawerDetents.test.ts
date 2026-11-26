import { describe, expect, it } from "@effect/vitest";

import {
  nextTerminalDrawerDoubleClickHeight,
  resolveTerminalDrawerDetents,
  resolveTerminalDrawerDragHeight,
  TERMINAL_DRAWER_COLLAPSE_THRESHOLD_PX,
  TERMINAL_DRAWER_COMPACT_HEIGHT,
} from "./terminalDrawerDetents";

describe("terminalDrawerDetents", () => {
  it("resolves Compact, Balanced, and Tall detents from viewport reference height", () => {
    const detents = resolveTerminalDrawerDetents({
      referenceHeight: 1000,
      minHeight: 180,
      maxHeight: 750,
    });
    expect(detents).toEqual([
      { kind: "compact", height: TERMINAL_DRAWER_COMPACT_HEIGHT },
      { kind: "balanced", height: 400 },
      { kind: "tall", height: 650 },
    ]);
  });

  it("snaps within +/-14px and honors Alt bypass", () => {
    const snapped = resolveTerminalDrawerDragHeight({
      rawHeight: 410,
      minHeight: 180,
      maxHeight: 750,
      referenceHeight: 1000,
    });
    expect(snapped).toEqual({
      height: 400,
      snappedDetent: "balanced",
      shouldCollapse: false,
    });

    const bypassed = resolveTerminalDrawerDragHeight({
      rawHeight: 410,
      minHeight: 180,
      maxHeight: 750,
      referenceHeight: 1000,
      bypassSnap: true,
    });
    expect(bypassed).toEqual({
      height: 410,
      snappedDetent: null,
      shouldCollapse: false,
    });
  });

  it("signals collapse below 120px and toggles Compact <-> Tall on double-click", () => {
    const collapse = resolveTerminalDrawerDragHeight({
      rawHeight: TERMINAL_DRAWER_COLLAPSE_THRESHOLD_PX - 5,
      minHeight: 180,
      maxHeight: 750,
      referenceHeight: 1000,
    });
    expect(collapse).toEqual({
      height: 180,
      snappedDetent: null,
      shouldCollapse: true,
    });

    expect(
      nextTerminalDrawerDoubleClickHeight({
        currentHeight: 240,
        minHeight: 180,
        maxHeight: 750,
        referenceHeight: 1000,
      }),
    ).toBe(650);
    expect(
      nextTerminalDrawerDoubleClickHeight({
        currentHeight: 620,
        minHeight: 180,
        maxHeight: 750,
        referenceHeight: 1000,
      }),
    ).toBe(TERMINAL_DRAWER_COMPACT_HEIGHT);
  });
});

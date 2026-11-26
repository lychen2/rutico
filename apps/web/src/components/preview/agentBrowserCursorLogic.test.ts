import { describe, expect, it } from "@effect/vitest";

import { agentBrowserCursorOpacity, computeAgentCursorTiltDeg } from "./agentBrowserCursorLogic";

describe("agentBrowserCursorLogic", () => {
  it("computes directional aerodynamic tilt clamped to ±6 degrees", () => {
    expect(computeAgentCursorTiltDeg(0)).toBe(0);
    expect(computeAgentCursorTiltDeg(0.3)).toBe(0);
    expect(computeAgentCursorTiltDeg(25)).toBeCloseTo(3, 5);
    expect(computeAgentCursorTiltDeg(-25)).toBeCloseTo(-3, 5);
    expect(computeAgentCursorTiltDeg(100)).toBe(6);
    expect(computeAgentCursorTiltDeg(-100)).toBe(-6);
    expect(computeAgentCursorTiltDeg(Number.NaN)).toBe(0);
  });

  it("returns crisp opacity when active and subtle fade when idle", () => {
    expect(agentBrowserCursorOpacity(true, "agent")).toBe(1);
    expect(agentBrowserCursorOpacity(false, "human")).toBe(0.18);
    expect(agentBrowserCursorOpacity(false, "agent")).toBe(0.35);
  });
});

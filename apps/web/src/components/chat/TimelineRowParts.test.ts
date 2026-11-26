import { describe, expect, it } from "vite-plus/test";
import { dotMatrixPhaseDelayRatio, resolveDotMatrixPhase } from "./TimelineRowParts";

describe("Tip 012 4x4 physics dot-matrix fields", () => {
  it("maps working phases into the 4 physics field modes", () => {
    expect(resolveDotMatrixPhase("preparing")).toBe("preparing");
    expect(resolveDotMatrixPhase("starting")).toBe("preparing");
    expect(resolveDotMatrixPhase("thinking")).toBe("thinking");
    expect(resolveDotMatrixPhase("reasoning")).toBe("thinking");
    expect(resolveDotMatrixPhase("tooling")).toBe("tooling");
    expect(resolveDotMatrixPhase("compacting")).toBe("compacting");
  });

  it("produces normalized [0, 1] spatial phase ratios with opposite radial direction for thinking vs compacting", () => {
    const centerThinking = dotMatrixPhaseDelayRatio(1, 1, "thinking");
    const cornerThinking = dotMatrixPhaseDelayRatio(0, 0, "thinking");
    const centerCompacting = dotMatrixPhaseDelayRatio(1, 1, "compacting");
    const cornerCompacting = dotMatrixPhaseDelayRatio(0, 0, "compacting");

    expect(centerThinking).toBeLessThan(cornerThinking);
    expect(centerCompacting).toBeGreaterThan(cornerCompacting);

    for (const phase of ["preparing", "thinking", "tooling", "compacting"] as const) {
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          const ratio = dotMatrixPhaseDelayRatio(row, col, phase);
          expect(ratio).toBeGreaterThanOrEqual(0);
          expect(ratio).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });
});

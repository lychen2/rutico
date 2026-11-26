import { describe, expect, it } from "vite-plus/test";
import {
  assistantLandingKey,
  claimAssistantLandingAnimation,
  claimTurnFoldLandingAnimation,
  markAssistantMessageStreaming,
  markTurnRunActive,
  turnFoldLandingKey,
} from "./turnLandingChoreography";

describe("turnLandingChoreography", () => {
  it("claims assistant landing animation once only for previously streaming messages", () => {
    const key = assistantLandingKey("env:thread-1", "msg-stream-1");
    expect(claimAssistantLandingAnimation(key)).toBe(false);

    markAssistantMessageStreaming(key);
    expect(claimAssistantLandingAnimation(key)).toBe(true);
    // LegendList row recycling for the same identity must never replay.
    expect(claimAssistantLandingAnimation(key)).toBe(false);
  });

  it("claims turn-fold landing animation once only for previously active turns", () => {
    const historicalKey = turnFoldLandingKey("env:thread-2", "run-historical");
    expect(claimTurnFoldLandingAnimation(historicalKey)).toBe(false);

    const liveKey = turnFoldLandingKey("env:thread-2", "run-live-1");
    markTurnRunActive(liveKey);
    expect(claimTurnFoldLandingAnimation(liveKey)).toBe(true);
    expect(claimTurnFoldLandingAnimation(liveKey)).toBe(false);
  });
});

export type BrowserController = "human" | "agent" | "none";

const MAX_AGENT_CURSOR_TILT_DEG = 6;
const AGENT_CURSOR_TILT_FACTOR = 0.12;

export function agentBrowserCursorOpacity(active: boolean, controller: BrowserController): number {
  if (active) return 1;
  return controller === "human" ? 0.18 : 0.35;
}

/** Maps horizontal pointer displacement into a subtle ±6° aerodynamic pointer tilt. */
export function computeAgentCursorTiltDeg(dx: number): number {
  if (!Number.isFinite(dx) || Math.abs(dx) < 0.5) return 0;
  return Math.max(
    -MAX_AGENT_CURSOR_TILT_DEG,
    Math.min(MAX_AGENT_CURSOR_TILT_DEG, dx * AGENT_CURSOR_TILT_FACTOR),
  );
}

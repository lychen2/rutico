import type { UsageProviderKind } from "@t3tools/contracts";

export function providerColors(scheme: "light" | "dark"): Record<UsageProviderKind, string> {
  return {
    claude: "#d97757",
    codex: "#ff5a1f",
    grok: scheme === "dark" ? "#a1a1aa" : "#636366",
    cursor: "#8e8e93",
    opencode: "#5b9bbd",
    antigravity: "#4285f4",
    pi: "#4d9f8a",
    muse: "#7c5ce6",
  };
}

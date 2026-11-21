import type { OrchestrationV2ExecutionNode, OrchestrationV2Run } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type ActivityNode = Pick<
  OrchestrationV2ExecutionNode,
  "parentNodeId" | "runId" | "kind" | "startedAt" | "completedAt"
>;

export function currentRoundActivity(
  run: Pick<OrchestrationV2Run, "id" | "rootNodeId">,
  nodes: readonly ActivityNode[],
) {
  const activity = {
    reasoning: { count: 0, milliseconds: 0, timed: 0 },
    tools: { count: 0, milliseconds: 0, timed: 0 },
  };
  for (const node of nodes) {
    if (node.runId !== run.id || node.parentNodeId !== run.rootNodeId) continue;
    const group =
      node.kind === "reasoning"
        ? activity.reasoning
        : node.kind === "tool_call"
          ? activity.tools
          : null;
    if (!group) continue;
    group.count++;
    if (node.startedAt && node.completedAt) {
      group.milliseconds += Math.max(
        0,
        DateTime.toEpochMillis(node.completedAt) - DateTime.toEpochMillis(node.startedAt),
      );
      group.timed++;
    }
  }
  return activity;
}

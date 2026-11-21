import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  ProviderTurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type ActivityNode = Pick<
  OrchestrationV2ExecutionNode,
  "parentNodeId" | "runId" | "kind" | "startedAt" | "completedAt"
>;

type ActivityItem = Pick<
  OrchestrationV2TurnItem,
  "runId" | "providerTurnId" | "parentItemId" | "type" | "startedAt" | "completedAt"
>;

export function currentRoundActivity(
  run: Pick<OrchestrationV2Run, "id" | "rootNodeId">,
  nodes: readonly ActivityNode[],
  turnItems: readonly ActivityItem[],
  providerTurnId: ProviderTurnId | undefined,
) {
  const activity = {
    reasoning: { count: 0, milliseconds: 0, timed: 0 },
    tools: { count: 0, milliseconds: 0, timed: 0 },
  };
  function count(
    group: typeof activity.reasoning,
    entry: Pick<ActivityItem, "startedAt" | "completedAt">,
  ) {
    group.count++;
    if (entry.startedAt && entry.completedAt) {
      group.milliseconds += Math.max(
        0,
        DateTime.toEpochMillis(entry.completedAt) - DateTime.toEpochMillis(entry.startedAt),
      );
      group.timed++;
    }
  }
  for (const item of turnItems) {
    if (
      item.runId !== run.id ||
      item.parentItemId !== null ||
      (providerTurnId !== undefined && item.providerTurnId !== providerTurnId)
    )
      continue;
    if (item.type === "reasoning") count(activity.reasoning, item);
    if (
      item.type === "command_execution" ||
      item.type === "file_change" ||
      item.type === "dynamic_tool" ||
      item.type === "todo_list"
    )
      count(activity.tools, item);
  }
  // Settled leaf nodes can be omitted from the bounded projection; their turn items survive.
  const useReasoningNodes = activity.reasoning.count === 0;
  const useToolNodes = activity.tools.count === 0;
  if (!useReasoningNodes && !useToolNodes) return activity;
  for (const node of nodes) {
    if (node.runId !== run.id || node.parentNodeId !== run.rootNodeId) continue;
    if (node.kind === "reasoning" && useReasoningNodes) count(activity.reasoning, node);
    if (node.kind === "tool_call" && useToolNodes) count(activity.tools, node);
  }
  return activity;
}

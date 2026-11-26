/**
 * Tracks live streaming/running identities so `LegendList` row recycling never replays
 * turn-completion landing animations on historical messages.
 */

const MAX_TRACKED_KEYS = 400;

const observedStreamingMessages = new Set<string>();
const playedAssistantLandings = new Set<string>();

const observedRunningTurns = new Set<string>();
const playedTurnLandings = new Set<string>();

function addBounded(set: Set<string>, key: string): void {
  if (set.has(key)) return;
  if (set.size >= MAX_TRACKED_KEYS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(key);
}

export function assistantLandingKey(threadKey: string, messageId: string): string {
  return `${threadKey}:${messageId}`;
}

export function turnFoldLandingKey(threadKey: string, runId: string): string {
  return `${threadKey}:turn-fold:${runId}`;
}

export function markAssistantMessageStreaming(key: string): void {
  addBounded(observedStreamingMessages, key);
}

/**
 * Returns `true` exactly once when an assistant message previously seen streaming
 * transitions to landed. Historical or recycled rows always return `false`.
 */
export function claimAssistantLandingAnimation(key: string): boolean {
  if (!observedStreamingMessages.has(key) || playedAssistantLandings.has(key)) {
    return false;
  }
  observedStreamingMessages.delete(key);
  addBounded(playedAssistantLandings, key);
  return true;
}

export function markTurnRunActive(key: string): void {
  addBounded(observedRunningTurns, key);
}

/**
 * Returns `true` exactly once when a turn previously seen active lands as a
 * completed `TurnFoldTimelineRow`. Historical or recycled rows return `false`.
 */
export function claimTurnFoldLandingAnimation(key: string): boolean {
  if (!observedRunningTurns.has(key) || playedTurnLandings.has(key)) {
    return false;
  }
  observedRunningTurns.delete(key);
  addBounded(playedTurnLandings, key);
  return true;
}

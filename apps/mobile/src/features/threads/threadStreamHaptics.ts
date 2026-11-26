// @effect-diagnostics globalDate:off - The tracker runs in an atom subscription, outside an Effect runtime.
import { parseThreadKey, threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

import { isAppActive } from "../../lib/appState";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { environmentThreadDetails } from "../../state/threads";

export interface StreamingMessageMark {
  readonly id: string;
  readonly textLength: number;
}

const STREAM_HAPTIC_THROTTLE_MS = 320;

function latestStreamingAssistantMessage(
  thread: EnvironmentThread | null,
): StreamingMessageMark | null {
  const messages = thread?.projection.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.streaming) {
      return { id: message.id, textLength: message.text.length };
    }
  }
  return null;
}

function hasCompletedAssistantMessage(
  thread: EnvironmentThread | null,
  messageId: string,
): boolean {
  const messages = thread?.projection.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.id === messageId) {
      return message.role === "assistant" && !message.streaming;
    }
  }
  return false;
}

function countCompletedToolItems(thread: EnvironmentThread | null): number {
  const items = thread?.projection.turnItems ?? [];
  let completed = 0;
  for (let index = 0; index < items.length; index += 1) {
    const candidate = items[index] as {
      readonly item?: { readonly type?: string; readonly status?: string };
    };
    const item = candidate?.item;
    if (
      item &&
      item.status === "completed" &&
      item.type !== "assistant_message" &&
      item.type !== "user_message" &&
      item.type !== "reasoning"
    ) {
      completed += 1;
    }
  }
  return completed;
}

function latestFailedRunId(thread: EnvironmentThread | null): string | null {
  const runs = thread?.projection.runs ?? [];
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run?.status === "failed") {
      return String(run.id);
    }
  }
  return null;
}

/**
 * A new stream always ticks; growth of the same stream ticks at most once per
 * throttle window, so a fast stream reads as texture rather than a buzz.
 */
export function shouldTickStreamHaptic(input: {
  readonly previous: StreamingMessageMark | null;
  readonly latest: StreamingMessageMark | null;
  readonly lastTickAt: number;
  readonly now: number;
}): boolean {
  const { previous, latest } = input;
  if (latest === null) return false;
  if (previous?.id !== latest.id) return true;
  if (latest.textLength <= previous.textLength) return false;
  return input.now - input.lastTickAt >= STREAM_HAPTIC_THROTTLE_MS;
}

/** Fires once when an observed streaming assistant reply settles into a completed message. */
export function shouldFireStreamCompleteHaptic(input: {
  readonly previous: StreamingMessageMark | null;
  readonly latest: StreamingMessageMark | null;
  readonly completedMessagePresent: boolean;
}): boolean {
  return input.previous !== null && input.latest === null && input.completedMessagePresent;
}

/** Fires when a newly completed tool activity arrives during an active thread session. */
export function shouldFireToolCompleteHaptic(input: {
  readonly previousCompletedCount: number;
  readonly currentCompletedCount: number;
}): boolean {
  return input.currentCompletedCount > input.previousCompletedCount;
}

/** Fires once when a new run transitions into a failed state. */
export function shouldFireRunFailedHaptic(input: {
  readonly previousFailedRunId: string | null;
  readonly latestFailedRunId: string | null;
}): boolean {
  return input.latestFailedRunId !== null && input.latestFailedRunId !== input.previousFailedRunId;
}

function fireStreamTokenHaptic(): void {
  if (Platform.OS === "android") {
    triggerSemanticHaptic("clockTick", { throttle: false });
    return;
  }
  void Haptics.selectionAsync().catch(() => undefined);
}

function fireToolCompleteHaptic(): void {
  if (Platform.OS === "android") {
    triggerSemanticHaptic("segmentTick", { throttle: false });
    return;
  }
  void Haptics.selectionAsync().catch(() => undefined);
}

function fireTurnCompleteHaptic(): void {
  if (Platform.OS === "android") {
    triggerSemanticHaptic("confirm", { throttle: false });
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

function fireRunFailedHaptic(): void {
  if (Platform.OS === "android") {
    triggerSemanticHaptic("reject", { throttle: false });
    return;
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

const streamHapticsFamily = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  return Atom.make((get) => {
    // The first snapshot only seeds the marks: opening a thread mid-stream is silent.
    let seeded = false;
    let previous: StreamingMessageMark | null = null;
    let previousCompletedTools = 0;
    let previousFailedRunId: string | null = null;
    let lastTickAt = 0;
    // `subscribe`, not `get`: a rebuild per streaming tick would reset the mark.
    get.subscribe(
      environmentThreadDetails.threadAtom(ref),
      (thread) => {
        const latest = latestStreamingAssistantMessage(thread);
        const completedTools = countCompletedToolItems(thread);
        const failedRunId = latestFailedRunId(thread);
        const now = Date.now();
        const prior = previous;
        const priorTools = previousCompletedTools;
        const priorFailedRunId = previousFailedRunId;
        const wasSeeded = seeded;

        seeded = true;
        previous = latest;
        previousCompletedTools = completedTools;
        previousFailedRunId = failedRunId;

        if (!wasSeeded || !isAppActive()) return;

        if (
          shouldFireRunFailedHaptic({
            previousFailedRunId: priorFailedRunId,
            latestFailedRunId: failedRunId,
          })
        ) {
          fireRunFailedHaptic();
          return;
        }
        if (shouldTickStreamHaptic({ previous: prior, latest, lastTickAt, now })) {
          lastTickAt = now;
          fireStreamTokenHaptic();
          return;
        }
        if (
          shouldFireToolCompleteHaptic({
            previousCompletedCount: priorTools,
            currentCompletedCount: completedTools,
          })
        ) {
          fireToolCompleteHaptic();
          return;
        }
        if (
          prior !== null &&
          shouldFireStreamCompleteHaptic({
            previous: prior,
            latest,
            completedMessagePresent: hasCompletedAssistantMessage(thread, prior.id),
          })
        ) {
          fireTurnCompleteHaptic();
        }
      },
      { immediate: true },
    );
  }).pipe(Atom.withLabel(`thread-stream-haptics:${key}`));
});

// A thread without server detail (a draft) has no reply to stream.
const noStreamHaptics = Atom.make<void>(undefined).pipe(
  Atom.withLabel("thread-stream-haptics:none"),
);

/** Mount while the thread is on screen to tick haptics as its reply streams. */
export function threadStreamHaptics(ref: ScopedThreadRef | null): Atom.Atom<void> {
  return ref === null ? noStreamHaptics : streamHapticsFamily(threadKey(ref));
}

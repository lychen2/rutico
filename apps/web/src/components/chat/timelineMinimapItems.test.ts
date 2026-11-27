import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type OrchestrationV2SearchThreadResult,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  formatComposerContextReference,
  toComposerContextId,
} from "@t3tools/shared/composerContextReferences";

import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  annotateTimelineMinimapFindMatches,
  deriveTimelineMinimapItems,
  resolveTimelineMinimapPreview,
} from "./timelineMinimapItems";
import { resolveThreadFindHeatmapCounts } from "./useThreadFind";

describe("deriveTimelineMinimapItems", () => {
  it.each(["", "Ultrathink:\n"])(
    "omits bootstrap text from the minimap label and tooltip (%j)",
    (prefix) => {
      const at = "2026-10-01T00:00:00Z";
      const items = deriveTimelineMinimapItems([
        {
          kind: "message",
          id: "image-only",
          createdAt: at,
          showAssistantMeta: false,
          showAssistantCopyButton: false,
          assistantCopyStreaming: false,
          message: {
            id: MessageId.make("image-only"),
            role: "user",
            text: prefix + ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
            runId: null,
            streaming: false,
            createdAt: at,
            updatedAt: at,
          },
        },
      ]);
      expect(items).toEqual([{ id: "image-only", rowIndex: 0, userText: "", assistantText: null }]);
      expect(resolveTimelineMinimapPreview(items[0]!)?.userText).toBeNull();
    },
  );
});

describe("resolveTimelineMinimapPreview", () => {
  it("previews a thread autolink as prose, not its URL", () => {
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      userText: null,
      assistantText:
        "Started <t3-thread://v2/env-1/thread-1> and [Fix CI](t3-thread://v2/env-1/t2).",
    });
    expect(preview?.assistantText).toBe("Started a thread and Fix CI.");
  });

  it("previews a quote, a context chip and a file link in the user's message as their text", () => {
    const quote = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("assistant-1"),
      text: "The cache misses on a cold start.",
      start: 0,
      end: 33,
      prefix: "",
      suffix: "",
    });
    const file = formatComposerContextReference({
      kind: "file",
      contextId: toComposerContextId("readme"),
      label: "README.md",
    });
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      userText: `${quote}\nWhere do ${file} and [math.ts](src/math.ts) cover this?`,
      assistantText: null,
    });
    expect(preview?.userText).toBe(
      "The cache misses on a cold start. Where do README.md and math.ts cover this?",
    );
  });

  it("does not split a surrogate pair at the preview slice boundary", () => {
    const linkStart = "[Build log](https://example.com/builds/1042/log?sig=";
    const linkEnd = ") ";
    const pad = "a".repeat(1_499 - linkStart.length - linkEnd.length);
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      userText: `${linkStart}${pad}${linkEnd}🎉 the release build passed`,
      assistantText: null,
    });
    expect(preview?.userText).toBe("Build log");
  });
});

describe("annotateTimelineMinimapFindMatches", () => {
  function makeTurnRows(turnCount: number): MessagesTimelineRow[] {
    const at = "2026-10-01T00:00:00Z";
    const rows: MessagesTimelineRow[] = [];
    for (let i = 0; i < turnCount; i += 1) {
      rows.push(
        {
          kind: "message",
          id: `user-${i}`,
          createdAt: at,
          showAssistantMeta: false,
          showAssistantCopyButton: false,
          assistantCopyStreaming: false,
          message: {
            id: MessageId.make(`user-${i}`),
            role: "user",
            text: `Prompt ${i}`,
            runId: null,
            streaming: false,
            createdAt: at,
            updatedAt: at,
          },
        },
        {
          kind: "message",
          id: `assistant-${i}`,
          createdAt: at,
          showAssistantMeta: false,
          showAssistantCopyButton: false,
          assistantCopyStreaming: false,
          message: {
            id: MessageId.make(`assistant-${i}`),
            role: "assistant",
            text: `Answer ${i} needle`,
            runId: null,
            streaming: false,
            createdAt: at,
            updatedAt: at,
          },
        },
      );
    }
    return rows;
  }

  it("keeps minimap dots for all >20 matching turns and only moves the active dot when stepping", () => {
    const turnCount = 24;
    const rows = makeTurnRows(turnCount);
    const items = deriveTimelineMinimapItems(rows);
    const allEntries = Array.from({ length: turnCount }, (_, i) => ({
      entryId: `assistant-${i}`,
      runId: null,
      startIndex: i * 2,
      count: (i % 3) + 1,
    }));
    const fullMatchCounts = allEntries.map(({ entryId, count }) => ({ entryId, count }));

    const resultForSelection = (selectedTurn: number): OrchestrationV2SearchThreadResult => ({
      snapshotSequence: 1,
      totalMatches: fullMatchCounts.reduce((sum, entry) => sum + entry.count, 0),
      activeIndex: selectedTurn,
      match: { entryId: `assistant-${selectedTurn}`, runId: null, occurrence: 0 },
      navigation: Array.from(
        { length: 17 },
        (_, i) => allEntries[(selectedTurn + i - 8 + turnCount) % turnCount]!,
      ),
      matchCounts: fullMatchCounts,
    });

    const atStart = resultForSelection(0);
    const atMiddle = resultForSelection(12);
    const atEnd = resultForSelection(23);

    const annotatedStart = annotateTimelineMinimapFindMatches(
      items,
      rows,
      resolveThreadFindHeatmapCounts(atStart),
      atStart.match?.entryId ?? null,
    );
    const annotatedMiddle = annotateTimelineMinimapFindMatches(
      items,
      rows,
      resolveThreadFindHeatmapCounts(atMiddle),
      atMiddle.match?.entryId ?? null,
    );
    const annotatedEnd = annotateTimelineMinimapFindMatches(
      items,
      rows,
      resolveThreadFindHeatmapCounts(atEnd),
      atEnd.match?.entryId ?? null,
    );

    const expectedCounts = Array.from({ length: turnCount }, (_, i) => (i % 3) + 1);
    expect(annotatedStart.map((item) => item.findMatchCount)).toEqual(expectedCounts);
    expect(annotatedMiddle.map((item) => item.findMatchCount)).toEqual(expectedCounts);
    expect(annotatedEnd.map((item) => item.findMatchCount)).toEqual(expectedCounts);

    expect(annotatedStart.findIndex((item) => item.hasActiveFindMatch)).toBe(0);
    expect(annotatedMiddle.findIndex((item) => item.hasActiveFindMatch)).toBe(12);
    expect(annotatedEnd.findIndex((item) => item.hasActiveFindMatch)).toBe(23);
  });

  it("falls back to navigation when matchCounts is omitted by an older server", () => {
    const rows = makeTurnRows(3);
    const items = deriveTimelineMinimapItems(rows);
    const legacyResult: OrchestrationV2SearchThreadResult = {
      snapshotSequence: 1,
      totalMatches: 2,
      activeIndex: 0,
      match: { entryId: "assistant-0", runId: null, occurrence: 0 },
      navigation: [
        { entryId: "assistant-0", runId: null, startIndex: 0, count: 1 },
        { entryId: "assistant-2", runId: null, startIndex: 1, count: 1 },
      ],
    };

    const annotated = annotateTimelineMinimapFindMatches(
      items,
      rows,
      resolveThreadFindHeatmapCounts(legacyResult),
      legacyResult.match?.entryId ?? null,
    );
    expect(annotated.map((item) => item.findMatchCount)).toEqual([1, undefined, 1]);
    expect(annotated.map((item) => item.hasActiveFindMatch)).toEqual([true, undefined, undefined]);
  });
});

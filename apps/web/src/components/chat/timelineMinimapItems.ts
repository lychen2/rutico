import {
  assistantCitationsToPlainText,
  splitsSurrogatePair,
} from "@t3tools/shared/assistantCitations";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import type { Nodes } from "hast";

import { markdownTree } from "~/markdown/wordsHast";

import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export type TimelineMinimapSemantic = "plan" | "error" | "fork";

export interface TimelineMinimapItem {
  readonly id: string;
  readonly rowIndex: number;
  readonly userText: string | null;
  readonly assistantText: string | null;
  readonly semantic?: TimelineMinimapSemantic | null;
  readonly findMatchCount?: number;
  readonly hasActiveFindMatch?: boolean;
}

export function annotateTimelineMinimapFindMatches(
  items: ReadonlyArray<TimelineMinimapItem>,
  rows: ReadonlyArray<MessagesTimelineRow>,
  findMatchNavigation: ReadonlyArray<{ readonly entryId: string; readonly count: number }> | null,
  activeEntryId: string | null,
): ReadonlyArray<TimelineMinimapItem> {
  if (
    items.length === 0 ||
    ((!findMatchNavigation || findMatchNavigation.length === 0) && activeEntryId === null)
  ) {
    return items;
  }

  // Map every row id to its enclosing user turn index in O(rows).
  const turnIndexByRowId = new Map<string, number>();
  let currentTurn = -1;
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
    const row = rows[rowIdx];
    if (!row) continue;
    if (row.kind === "message" && row.message.role === "user") {
      currentTurn += 1;
    }
    if (currentTurn >= 0 && currentTurn < items.length) {
      turnIndexByRowId.set(row.id, currentTurn);
    }
  }

  const countByTurn = new Map<number, number>();
  if (findMatchNavigation) {
    for (const entry of findMatchNavigation) {
      if (entry.count <= 0) continue;
      const turnIndex = turnIndexByRowId.get(entry.entryId);
      if (turnIndex === undefined) continue;
      countByTurn.set(turnIndex, (countByTurn.get(turnIndex) ?? 0) + entry.count);
    }
  }
  const activeTurnIndex = activeEntryId === null ? undefined : turnIndexByRowId.get(activeEntryId);
  if (activeTurnIndex !== undefined && !countByTurn.has(activeTurnIndex)) {
    countByTurn.set(activeTurnIndex, 1);
  }
  if (countByTurn.size === 0) return items;

  return items.map((item, index) => {
    const count = countByTurn.get(index);
    const isActive = activeTurnIndex === index;
    if (count === undefined && !isActive) return item;
    return {
      ...item,
      ...(count !== undefined ? { findMatchCount: count } : {}),
      ...(isActive ? { hasActiveFindMatch: true } : {}),
    };
  });
}

export function deriveTimelineMinimapItems(
  rows: ReadonlyArray<MessagesTimelineRow>,
): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message" || row.message.role !== "user") {
      continue;
    }

    const semantic = resolveSemanticMarkerForTurn(rows, index);
    items.push({
      id: row.id,
      rowIndex: index,
      userText: isAttachmentOnlyBootstrapPrompt(row.message.text) ? "" : row.message.text,
      assistantText: resolveFinalAssistantTextForTurn(rows, index),
      ...(semantic ? { semantic } : {}),
    });
  }
  return items;
}

function resolveSemanticMarkerForTurn(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowIndex: number,
): TimelineMinimapSemantic | null {
  let hasPlan = false;
  let hasFork = false;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    if (row.kind === "message" && row.message.role === "user") {
      break;
    }
    if (
      (row.kind === "context-compaction" && row.failed) ||
      (row.kind === "event" &&
        (row.projectedItem.item.type === "error" || row.projectedItem.item.status === "failed")) ||
      (row.kind === "work" &&
        row.groupedEntries.some(
          (entry) => entry.tone === "error" || entry.toolLifecycleStatus === "failed",
        )) ||
      (row.kind === "work-live" &&
        (row.entry.tone === "error" || row.entry.toolLifecycleStatus === "failed"))
    ) {
      return "error";
    }
    if (row.kind === "proposed-plan") {
      hasPlan = true;
    } else if (
      row.kind === "attempt-fold" ||
      (row.kind === "event" && row.projectedItem.item.type === "subagent")
    ) {
      hasFork = true;
    }
  }
  if (hasPlan) return "plan";
  if (hasFork) return "fork";
  return null;
}

function resolveFinalAssistantTextForTurn(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowIndex: number,
) {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }
    if (row.message.role === "user") {
      break;
    }
    if (row.message.role === "assistant") {
      finalAssistantText = row.message.text ?? null;
    }
  }
  return finalAssistantText;
}

// Elements whose children run together; every other element is separated by a space.
const INLINE_PARENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "em",
  "strong",
  "del",
  "a",
  "code",
  "span",
  "sup",
  "sub",
]);

function markdownNodeText(node: Nodes): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" && node.tagName === "br") return " ";
  if (node.type === "element" && node.tagName === "img") return String(node.properties.alt ?? "");
  if (node.type !== "element" && node.type !== "root") return "";
  const separator = node.type === "element" && INLINE_PARENTS.has(node.tagName) ? "" : " ";
  const text = node.children.map(markdownNodeText).join(separator);
  // A thread autolink's only text is its URL.
  return node.type === "element" && node.tagName === "a" && parseThreadLinkHref(text) !== null
    ? "a thread"
    : text;
}

/** Markdown as one line of the text it renders, without markup or link targets. */
export function markdownPlainText(markdown: string): string {
  return markdownNodeText(markdownTree(markdown)).replace(/\s+/g, " ").trim();
}

// The tooltip shows a few lines; bound parsing work for long messages and streaming responses.
function markdownMinimapPreview(markdown: string | null) {
  if (markdown === null) return null;
  const compact = markdownPlainText(
    markdown.slice(0, splitsSurrogatePair(markdown, 1_500) ? 1_499 : 1_500),
  );
  return compact.length > 0 ? compact : null;
}

export function resolveTimelineMinimapPreview(
  item: TimelineMinimapItem | null,
): TimelineMinimapItem | null {
  return item === null
    ? null
    : {
        ...item,
        // Before markdown parsing, which would reduce a citation link to "Assistant quote".
        userText: markdownMinimapPreview(
          item.userText === null
            ? null
            : assistantCitationsToPlainText(
                replaceComposerContextReferences(item.userText, (reference) => reference.label),
              ),
        ),
        assistantText: markdownMinimapPreview(item.assistantText),
      };
}

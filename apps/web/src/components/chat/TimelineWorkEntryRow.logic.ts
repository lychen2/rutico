import { msg } from "gt-react";
import type { MarkdownExtensions } from "~/markdown/wordsHast";
import {
  resolveWorkEntryToolPresentation,
  toolGroupAction,
} from "@t3tools/client-runtime/work-log/presentation";
import { splitsSurrogatePair } from "@t3tools/shared/assistantCitations";
import { isJavaScriptReplTool } from "@t3tools/shared/toolActivity";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { m, type MessageResolver } from "../../i18n/messages";
import { type TimelineWorkEntry, type TimelineRow } from "./timelineRowContext";
import { type WorkEntryIconName } from "./TimelineToolActivityIcon";

export function toolGroupSummaryIconName(
  kind: Extract<TimelineRow, { kind: "work-toggle" }>["summaryKind"],
): WorkEntryIconName {
  switch (kind) {
    case "pull-request":
    case "link-pr":
    case "unlink-pr":
    case "list-prs":
    case "watch-pr":
    case "unwatch-pr":
      return "pull-request";
    case "read":
      return "eye";
    case "edit":
      return "square-pen";
    case "command":
      return "terminal";
    case "thread-create":
      return "t3-code";
    case "browser":
      return "browser";
    case "device":
      return "device";
    case "search":
      return "globe";
    case "code-search":
      return "search";
    case "other":
      return "wrench";
    case "dynamic-tool":
      return "hammer";
    case "reasoning":
      return "brain";
    case "agent-tool":
      return "bot";
    case "tone-tool":
      return "zap";
    case "update":
    case "mixed":
      return "hammer";
  }
}

export function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  iconName: WorkEntryIconName;
  className: string;
} {
  if (tone === "error") {
    return {
      iconName: "circle-alert",
      className: "text-foreground/92",
    };
  }
  if (tone === "thinking") {
    return {
      iconName: "brain",
      className: "text-icon-muted",
    };
  }
  if (tone === "info") {
    return {
      iconName: "check",
      className: "text-muted-foreground",
    };
  }
  return {
    iconName: "zap",
    className: "text-foreground/92",
  };
}

export function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

export function buildToolCallExpandedBody(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
  visibleLabel: string,
  viewedImagePath: string | null,
  resolve: MessageResolver = m,
): string | null {
  const blocks: string[] = [];
  const seen = new Set<string>([visibleLabel.trim()]);
  const addBlock = (value: string | null | undefined) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    blocks.push(text);
  };
  if (workEntry.itemType === "dynamic_tool" && workEntry.toolData !== undefined) {
    const input =
      workEntry.structuredPayload?.type === "dynamic_tool"
        ? workEntry.structuredPayload.input
        : workEntry.toolData !== null &&
            typeof workEntry.toolData === "object" &&
            "input" in workEntry.toolData
          ? workEntry.toolData.input
          : undefined;
    if (input !== undefined) {
      addBlock(resolve(msg("Tool input\n{input}", { input: JSON.stringify(input, null, 2) })));
    }
  }
  const command = workEntry.command?.trim();
  const raw = workEntryRawCommand(workEntry);
  if (command === visibleLabel.trim()) {
    seen.add(command);
  } else {
    addBlock(raw ?? command);
  }
  const detail = workEntry.detail?.trim();
  if (detail !== viewedImagePath?.trim()) {
    addBlock(detail);
  }
  const viewedImagePaths = new Set(
    viewedImagePath
      ? [viewedImagePath.trim(), formatWorkspaceRelativePath(viewedImagePath, workspaceRoot)]
      : [],
  );
  const changedFiles = (workEntry.changedFiles ?? []).flatMap((filePath) => {
    const formattedPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
    return viewedImagePaths.has(filePath) ||
      viewedImagePaths.has(formattedPath) ||
      filePath.trim() === detail ||
      formattedPath === detail
      ? []
      : [formattedPath];
  });
  if (changedFiles.length > 0) {
    addBlock([...new Set(changedFiles)].join("\n"));
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

export function workEntryIconName(workEntry: TimelineWorkEntry): WorkEntryIconName {
  if (workEntry.structuredPayload?.type === "notification") {
    if (workEntry.structuredPayload.outcome === "failed") return "circle-alert";
    const source = workEntry.structuredPayload.source;
    switch (source.kind) {
      case "subagent":
      case "delegated_task":
        return "bot";
      case "command":
        return "terminal";
      case "monitor":
        return "eye";
      case "background_task":
      case "thread_wait":
        return "zap";
      case "system":
        return "t3-code";
      default:
        source satisfies never;
        return "zap";
    }
  }
  if (workEntry.itemType === "system_notice") {
    return workEntry.structuredPayload?.type === "system_notice" &&
      workEntry.structuredPayload.level === "info"
      ? "zap"
      : "circle-alert";
  }
  if (workEntry.itemType === "user_input_request" || workEntry.itemType === "approval_request") {
    return "message-circle";
  }
  if (workEntry.itemType === "todo_list") return "list-todo";
  if (workEntry.toolSurface) return workEntry.toolSurface;
  if (
    workEntry.structuredPayload?.type === "dynamic_tool" &&
    isJavaScriptReplTool(workEntry.structuredPayload.toolName)
  )
    return "code";
  const toolPresentation = resolveWorkEntryToolPresentation(workEntry, undefined, m);
  if (toolPresentation) return toolPresentation.icon;
  const action = toolGroupAction(workEntry);
  if (action !== "other") return toolGroupSummaryIconName(action);

  switch (workEntry.itemType) {
    case "dynamic_tool":
      return "wrench";
    case "subagent":
      return "bot";
  }

  return workToneIcon(workEntry.tone).iconName;
}

// Look past the visible label so long destinations and inline delimiters can close.
// This is bounded lookahead, not document-wide Markdown parity: a closing delimiter
// or reference definition beyond this prefix remains unresolved by the parser.
export const THOUGHT_PREVIEW_SOURCE_MAX_LENGTH = 8_192;
export const THOUGHT_PREVIEW_MAX_LENGTH = 2_048;

export function sliceThoughtPreviewSource(text: string): string {
  return text.slice(
    0,
    splitsSurrogatePair(text, THOUGHT_PREVIEW_SOURCE_MAX_LENGTH)
      ? THOUGHT_PREVIEW_SOURCE_MAX_LENGTH - 1
      : THOUGHT_PREVIEW_SOURCE_MAX_LENGTH,
  );
}

const thoughtPreviews = new Map<string, MarkdownExtensions>();

/** Compact reasoning keeps formulas while flattening other Markdown into label text. */
export function thoughtPreviewMarkdown(fallback: string): MarkdownExtensions {
  let extensions = thoughtPreviews.get(fallback);
  if (!extensions) {
    extensions = { preview: { fallback, maxLength: THOUGHT_PREVIEW_MAX_LENGTH } };
    thoughtPreviews.set(fallback, extensions);
  }
  return extensions;
}

// Live thinking windows follow the newest trailing prose instead of freezing at the
// historical summary prefix limit. Keep enough trailing source to preserve recent context
// without splitting surrogate pairs or overflowing render cost.
export const LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH = 16_384;
export const LIVE_THOUGHT_TAIL_PREVIEW_MAX_LENGTH = LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH * 2;

export function sliceLiveThoughtTailSource(
  text: string,
  options?: {
    readonly maxLength?: number;
    readonly startOffset?: number | null;
  },
): { readonly text: string; readonly startOffset: number } {
  const maxLength = options?.maxLength ?? LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH;
  if (options?.startOffset != null && options.startOffset >= 0) {
    const clampedStart = Math.min(options.startOffset, text.length);
    const safeStart = splitsSurrogatePair(text, clampedStart) ? clampedStart + 1 : clampedStart;
    const maxEnd = Math.min(text.length, safeStart + LIVE_THOUGHT_TAIL_PREVIEW_MAX_LENGTH);
    const safeEnd = splitsSurrogatePair(text, maxEnd) ? maxEnd - 1 : maxEnd;
    return { text: text.slice(safeStart, safeEnd), startOffset: safeStart };
  }
  if (text.length <= maxLength) {
    return { text, startOffset: 0 };
  }
  const rawStart = text.length - maxLength;
  const safeStart = splitsSurrogatePair(text, rawStart) ? rawStart + 1 : rawStart;
  return { text: text.slice(safeStart), startOffset: safeStart };
}

const liveThoughtPreviews = new Map<string, MarkdownExtensions>();

/** Live reasoning stream window keeps trailing prose without stalling at the prefix summary cap. */
export function liveThoughtPreviewMarkdown(fallback: string): MarkdownExtensions {
  let extensions = liveThoughtPreviews.get(fallback);
  if (!extensions) {
    extensions = { preview: { fallback, maxLength: LIVE_THOUGHT_TAIL_PREVIEW_MAX_LENGTH } };
    liveThoughtPreviews.set(fallback, extensions);
  }
  return extensions;
}

import type { FileDiffMetadata, SelectedLineRange, SelectionSide } from "@pierre/diffs";

export interface DiffHunkAnchor {
  readonly id: string;
  readonly fileKey: string;
  readonly filePath: string;
  readonly hunkIndex: number;
  readonly side: SelectionSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly range: SelectedLineRange;
}

export interface DiffHunkSourceFile {
  readonly fileKey: string;
  readonly filePath: string;
  readonly fileDiff: FileDiffMetadata;
}

/**
 * Extract ordered logical hunk anchors keyed strictly by `(fileKey, side, line)` — never
 * caching virtualized DOM nodes (Astra P1-4).
 */
export function buildDiffHunkAnchors(files: ReadonlyArray<DiffHunkSourceFile>): DiffHunkAnchor[] {
  const anchors: DiffHunkAnchor[] = [];

  for (const file of files) {
    const { fileDiff, fileKey, filePath } = file;
    // Pending lazy placeholders carry no hunks until hydrated; skip until patch arrives.
    if (fileDiff.cacheKey?.endsWith(":pending")) continue;

    for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex += 1) {
      const hunk = fileDiff.hunks[hunkIndex];
      if (!hunk) continue;

      let additionCursor = hunk.additionStart;
      let deletionCursor = hunk.deletionStart;
      let firstAddStart: number | null = null;
      let lastAddEnd: number | null = null;
      let firstDelStart: number | null = null;
      let lastDelEnd: number | null = null;

      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          additionCursor += content.lines;
          deletionCursor += content.lines;
          continue;
        }
        if (content.additions > 0) {
          if (firstAddStart === null) firstAddStart = additionCursor;
          lastAddEnd = additionCursor + content.additions - 1;
          additionCursor += content.additions;
        }
        if (content.deletions > 0) {
          if (firstDelStart === null) firstDelStart = deletionCursor;
          lastDelEnd = deletionCursor + content.deletions - 1;
          deletionCursor += content.deletions;
        }
      }

      let side: SelectionSide;
      let startLine: number;
      let endLine: number;

      if (firstAddStart !== null && lastAddEnd !== null) {
        side = "additions";
        startLine = firstAddStart;
        endLine = lastAddEnd;
      } else if (firstDelStart !== null && lastDelEnd !== null) {
        side = "deletions";
        startLine = firstDelStart;
        endLine = lastDelEnd;
      } else if (hunk.additionCount > 0) {
        side = "additions";
        startLine = Math.max(1, hunk.additionStart);
        endLine = Math.max(startLine, hunk.additionStart + hunk.additionCount - 1);
      } else if (hunk.deletionCount > 0) {
        side = "deletions";
        startLine = Math.max(1, hunk.deletionStart);
        endLine = Math.max(startLine, hunk.deletionStart + hunk.deletionCount - 1);
      } else {
        continue;
      }

      anchors.push({
        id: `${fileKey}#hunk-${hunkIndex}:${side}:${startLine}-${endLine}`,
        fileKey,
        filePath,
        hunkIndex,
        side,
        startLine,
        endLine,
        range: {
          start: startLine,
          end: endLine,
          side,
          endSide: side,
        },
      });
    }
  }

  return anchors;
}

/**
 * Step across hunk indices cleanly with wrap-around navigation.
 */
export function resolveNextHunkIndex(
  currentIndex: number | null,
  direction: -1 | 1,
  total: number,
): number {
  if (total <= 0) return -1;
  if (currentIndex === null || currentIndex < 0 || currentIndex >= total) {
    return direction > 0 ? 0 : total - 1;
  }
  return (currentIndex + direction + total) % total;
}

const SPOTLIGHT_DURATION_MS = 460;
const activeSpotlightTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

interface SpotlightNodeLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface ShadowRootLike {
  querySelectorAll(selector: string): Iterable<SpotlightNodeLike>;
}

interface ShadowSpotlightTargetItem {
  readonly id: string;
  readonly element?: { readonly shadowRoot?: ShadowRootLike | null } | undefined;
}

function matchesAnchorSide(lineElement: SpotlightNodeLike, side: SelectionSide): boolean {
  const lineType = lineElement.getAttribute("data-line-type");
  if (side === "deletions") {
    return lineType === "change-deletion" || lineType === "context";
  }
  return lineType !== "change-deletion";
}

/**
 * Trigger the 420ms Shadow-DOM magnetic hunk spotlight flash on the currently mounted lines
 * corresponding to `anchor`. Re-reads live Shadow DOM nodes via `renderedItems` instead of
 * retaining virtualized element references (Astra P1-4).
 */
export function flashHunkSpotlightInShadowDom(
  renderedItems: ReadonlyArray<ShadowSpotlightTargetItem> | undefined,
  anchor: Pick<DiffHunkAnchor, "fileKey" | "side" | "startLine" | "endLine">,
  options?: { readonly durationMs?: number },
): number {
  if (!renderedItems || renderedItems.length === 0) return 0;
  const rendered = renderedItems.find((entry) => entry.id === anchor.fileKey);
  const shadowRoot = rendered?.element?.shadowRoot;
  if (!shadowRoot) return 0;

  // Clear any active spotlight attributes in this shadow root so rapid stepping stays crisp.
  for (const existing of shadowRoot.querySelectorAll("[data-hunk-spotlight]")) {
    const existingTimer = activeSpotlightTimers.get(existing);
    if (existingTimer !== undefined) {
      globalThis.clearTimeout(existingTimer);
      activeSpotlightTimers.delete(existing);
    }
    existing.removeAttribute("data-hunk-spotlight");
  }

  // Cap highlighted lines for huge hunks to keep the spotlight beam legible and lightweight.
  const maxHighlightedLine = Math.min(anchor.endLine, anchor.startLine + 24);
  const targets: SpotlightNodeLike[] = [];

  for (let line = anchor.startLine; line <= maxHighlightedLine; line += 1) {
    const lineNodes = shadowRoot.querySelectorAll(
      `[data-line="${line}"], [data-column-number="${line}"]`,
    );
    for (const node of lineNodes) {
      if (matchesAnchorSide(node, anchor.side)) {
        targets.push(node);
      }
    }
  }

  if (targets.length === 0) return 0;

  const durationMs = options?.durationMs ?? SPOTLIGHT_DURATION_MS;
  for (const node of targets) {
    node.setAttribute("data-hunk-spotlight", "true");
    const timer = globalThis.setTimeout(() => {
      node.removeAttribute("data-hunk-spotlight");
      activeSpotlightTimers.delete(node);
    }, durationMs);
    activeSpotlightTimers.set(node, timer);
  }

  return targets.length;
}

export function isEditableOrTerminalEventTarget(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (node.isContentEditable) return true;
    const role = node.getAttribute("role");
    if (role === "textbox" || role === "combobox" || role === "searchbox" || role === "dialog") {
      return true;
    }
    if (
      node.hasAttribute("data-terminal-surface") ||
      node.hasAttribute("data-diff-comment-annotation")
    ) {
      return true;
    }
  }
  return false;
}

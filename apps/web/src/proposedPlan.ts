import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";

interface ProposedPlanOutlineHeading {
  readonly id: string;
  readonly level: 2 | 3;
  readonly text: string;
}

function stripInlineMarkdown(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

/** Extract ATX H2/H3 section headings outside fenced code blocks for quick outline navigation. */
export function extractProposedPlanHeadings(
  planMarkdown: string,
): ReadonlyArray<ProposedPlanOutlineHeading> {
  const lines = stripDisplayedPlanMarkdown(planMarkdown).split(/\r?\n/);
  const headings: ProposedPlanOutlineHeading[] = [];
  const seenCounts = new Map<string, number>();
  let activeFence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (activeFence === null) {
        activeFence = marker[0]!;
      } else if (marker[0] === activeFence) {
        activeFence = null;
      }
      continue;
    }
    if (activeFence !== null) continue;
    const match = line.match(/^\s*(#{2,3})\s+(.+)$/);
    if (!match) continue;
    const level = match[1]!.length === 2 ? 2 : 3;
    const text = stripInlineMarkdown(match[2]!);
    if (text.length > 0) {
      const key = `${level}:${text}`;
      const occurrence = seenCounts.get(key) ?? 0;
      seenCounts.set(key, occurrence + 1);
      headings.push({
        id: occurrence === 0 ? key : `${key}#${occurrence}`,
        level,
        text,
      });
    }
  }
  return headings;
}

function sanitizePlanFileSegment(input: string): string {
  const sanitized = input
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "plan";
}

export const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:\n";

export function buildProposedPlanMarkdownFilename(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown);
  return `${sanitizePlanFileSegment(title ?? "plan")}.md`;
}

export function normalizePlanMarkdownForExport(planMarkdown: string): string {
  return `${planMarkdown.trimEnd()}\n`;
}

export function downloadPlanAsTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

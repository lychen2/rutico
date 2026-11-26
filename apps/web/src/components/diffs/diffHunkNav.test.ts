import { describe, expect, it, vi } from "vite-plus/test";

import { buildFileDiffEntries, getRenderablePatch } from "~/lib/diffRendering";
import {
  buildDiffHunkAnchors,
  flashHunkSpotlightInShadowDom,
  resolveNextHunkIndex,
} from "./diffHunkNav";

function makeFakeElement(initial: Record<string, string>) {
  const attrs = new Map(Object.entries(initial));
  return {
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
  };
}

describe("diffHunkNav", () => {
  it("extracts ordered cross-file logical hunk anchors by file/side/line", () => {
    const patch = [
      "diff --git a/alpha.ts b/alpha.ts",
      "--- a/alpha.ts",
      "+++ a/alpha.ts",
      "@@ -1,2 +1,3 @@",
      " const a = 1;",
      "+const b = 2;",
      " const c = 3;",
      "@@ -20,3 +21,2 @@",
      " const keep = true;",
      "-const oldOnly = false;",
      " const tail = true;",
      "diff --git a/beta.ts b/beta.ts",
      "--- a/beta.ts",
      "+++ a/beta.ts",
      "@@ -5,2 +5,3 @@",
      " export function greet() {",
      "+  return 'hi';",
      " }",
      "",
    ].join("\n");

    const parsed = getRenderablePatch(patch);
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    const entries = buildFileDiffEntries(parsed.files).map((entry) => ({
      fileKey: entry.fileKey,
      filePath: entry.fileDiff.name,
      fileDiff: entry.fileDiff,
    }));

    const anchors = buildDiffHunkAnchors(entries);
    expect(anchors).toHaveLength(3);
    expect(anchors[0]).toMatchObject({
      filePath: "alpha.ts",
      hunkIndex: 0,
      side: "additions",
      startLine: 2,
      endLine: 2,
    });
    expect(anchors[1]).toMatchObject({
      filePath: "alpha.ts",
      hunkIndex: 1,
      side: "deletions",
      startLine: 21,
      endLine: 21,
    });
    expect(anchors[2]).toMatchObject({
      filePath: "beta.ts",
      hunkIndex: 0,
      side: "additions",
      startLine: 6,
      endLine: 6,
    });
  });

  it("wraps hunk navigation indices cleanly across boundaries", () => {
    expect(resolveNextHunkIndex(null, 1, 5)).toBe(0);
    expect(resolveNextHunkIndex(null, -1, 5)).toBe(4);
    expect(resolveNextHunkIndex(4, 1, 5)).toBe(0);
    expect(resolveNextHunkIndex(0, -1, 5)).toBe(4);
    expect(resolveNextHunkIndex(2, 1, 5)).toBe(3);
    expect(resolveNextHunkIndex(0, 1, 0)).toBe(-1);
  });

  it("decorates only matching Shadow DOM lines and cleans up after spotlight duration", () => {
    vi.useFakeTimers();
    try {
      const addedLine = makeFakeElement({
        "data-line": "12",
        "data-line-type": "change-addition",
      });
      const addedGutter = makeFakeElement({
        "data-column-number": "12",
        "data-line-type": "change-addition",
      });
      const deletedLine = makeFakeElement({
        "data-line": "12",
        "data-line-type": "change-deletion",
      });
      const allNodes = [addedLine, addedGutter, deletedLine];

      const fakeShadowRoot = {
        querySelectorAll(selector: string) {
          if (selector === "[data-hunk-spotlight]") {
            return allNodes.filter((n) => n.getAttribute("data-hunk-spotlight") !== null);
          }
          if (selector.includes('data-line="12"')) {
            return allNodes.filter(
              (n) =>
                n.getAttribute("data-line") === "12" ||
                n.getAttribute("data-column-number") === "12",
            );
          }
          return [];
        },
      };

      const count = flashHunkSpotlightInShadowDom(
        [{ id: "file-a", element: { shadowRoot: fakeShadowRoot } }],
        { fileKey: "file-a", side: "additions", startLine: 12, endLine: 12 },
        { durationMs: 420 },
      );

      expect(count).toBe(2);
      expect(addedLine.getAttribute("data-hunk-spotlight")).toBe("true");
      expect(addedGutter.getAttribute("data-hunk-spotlight")).toBe("true");
      expect(deletedLine.getAttribute("data-hunk-spotlight")).toBeNull();

      vi.advanceTimersByTime(420);
      expect(addedLine.getAttribute("data-hunk-spotlight")).toBeNull();
      expect(addedGutter.getAttribute("data-hunk-spotlight")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

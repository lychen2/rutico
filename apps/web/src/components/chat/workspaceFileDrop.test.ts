import { describe, expect, it } from "@effect/vitest";
import { splitTransferredFiles, summarizeDraggedItems } from "./workspaceFileDrop";

describe("splitTransferredFiles", () => {
  it("separates copied folders from files before attachment validation", () => {
    const folder = new File([], "photos.png");
    const emptyFile = new File([], "empty.txt");
    const image = new File(["image"], "photo.png", { type: "image/png" });

    expect(
      splitTransferredFiles({
        files: [folder, emptyFile, image],
        items: [
          {
            kind: "string",
            getAsFile: () => null,
            webkitGetAsEntry: () => null,
          },
          {
            kind: "file",
            getAsFile: () => folder,
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
          {
            kind: "file",
            getAsFile: () => emptyFile,
            webkitGetAsEntry: () => ({ isDirectory: false }),
          },
          {
            kind: "file",
            getAsFile: () => image,
            webkitGetAsEntry: () => null,
          },
        ],
      }),
    ).toEqual({ files: [emptyFile, image], folders: [folder] });
  });

  it("ignores clipboard file items that cannot provide a file", () => {
    expect(
      splitTransferredFiles({
        files: [],
        items: [
          {
            kind: "file",
            getAsFile: () => null,
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
        ],
      }),
    ).toEqual({ files: [], folders: [] });
  });
});

describe("summarizeDraggedItems", () => {
  it("counts images and non-image files from dragged items", () => {
    expect(
      summarizeDraggedItems({
        files: [],
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
            webkitGetAsEntry: () => null,
          },
          { kind: "file", type: "image/png", getAsFile: () => null, webkitGetAsEntry: () => null },
          { kind: "file", type: "image/jpeg", getAsFile: () => null, webkitGetAsEntry: () => null },
          {
            kind: "file",
            type: "application/pdf",
            getAsFile: () => null,
            webkitGetAsEntry: () => null,
          },
        ],
      }),
    ).toEqual({ total: 3, imageCount: 2, fileCount: 1 });
  });
});

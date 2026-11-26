import { describe, expect, it } from "vite-plus/test";

import { composerSuggestionOptionId, splitQueryMatchSegments } from "./ComposerCommandMenu";

describe("composerSuggestionOptionId", () => {
  it("keeps whitespace, escape-like paths, and malformed UTF-16 distinct", () => {
    const paths = [
      "docs/my file.md",
      "docs/my_file.md",
      "docs/my%20file.md",
      "docs/my\tfile.md",
      "docs/\ud800.md",
      "docs/\ud801.md",
      "docs/\udc00.md",
      "docs/\ufffd.md",
      "docs/\\ud800.md",
      "docs/\ud83d\ude80.md",
    ];
    const ids = paths.map((path) => composerSuggestionOptionId("suggestions", `path:file:${path}`));

    expect(new Set(ids).size).toBe(paths.length);
    for (const id of ids) expect(id).not.toMatch(/\s|[\ud800-\udfff]/u);
    expect(composerSuggestionOptionId("other-composer", paths[0]!)).not.toBe(
      composerSuggestionOptionId("suggestions", paths[0]!),
    );
  });
});

describe("splitQueryMatchSegments", () => {
  it("highlights contiguous substring matches and ordered subsequence fuzzy matches", () => {
    expect(splitQueryMatchSegments("ComposerCommandMenu.tsx", "command")).toEqual([
      { text: "Composer", matched: false },
      { text: "Command", matched: true },
      { text: "Menu.tsx", matched: false },
    ]);
    expect(splitQueryMatchSegments("ComposerCommandMenu", "ccm")).toEqual([
      { text: "C", matched: true },
      { text: "omposer", matched: false },
      { text: "C", matched: true },
      { text: "ommand", matched: false },
      { text: "M", matched: true },
      { text: "enu", matched: false },
    ]);
  });
});

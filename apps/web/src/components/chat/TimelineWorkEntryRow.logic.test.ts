import { describe, expect, it } from "vite-plus/test";

import {
  LIVE_THOUGHT_TAIL_PREVIEW_MAX_LENGTH,
  LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH,
  THOUGHT_PREVIEW_MAX_LENGTH,
  THOUGHT_PREVIEW_SOURCE_MAX_LENGTH,
  liveThoughtPreviewMarkdown,
  sliceLiveThoughtTailSource,
  sliceThoughtPreviewSource,
  thoughtPreviewMarkdown,
} from "./TimelineWorkEntryRow.logic";

describe("thought preview prefix vs live tail slicing", () => {
  it("keeps historical thought preview slicing from the prefix at 8,192 / 2,048 chars", () => {
    const source = `PREFIX_HEAD ${"a".repeat(9_000)} TAIL_SENTINEL`;
    const prefix = sliceThoughtPreviewSource(source);
    expect(prefix.length).toBe(THOUGHT_PREVIEW_SOURCE_MAX_LENGTH);
    expect(prefix).toContain("PREFIX_HEAD");
    expect(prefix).not.toContain("TAIL_SENTINEL");
    expect(thoughtPreviewMarkdown("Thought")).toEqual({
      preview: { fallback: "Thought", maxLength: THOUGHT_PREVIEW_MAX_LENGTH },
    });
  });

  it("keeps live thinking tail slicing tracking trailing markers well past 8,192 and 16,384 chars", () => {
    const medium = `PREFIX_HEAD ${"b".repeat(9_500)} TAIL_9K`;
    const mediumTail = sliceLiveThoughtTailSource(medium);
    expect(mediumTail.startOffset).toBe(0);
    expect(mediumTail.text).toContain("TAIL_9K");

    const veryLong = `PREFIX_HEAD ${"c".repeat(25_000)} TAIL_25K`;
    const longTail = sliceLiveThoughtTailSource(veryLong);
    expect(longTail.startOffset).toBe(veryLong.length - LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH);
    expect(longTail.text.length).toBe(LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH);
    expect(longTail.text).toContain("TAIL_25K");
    expect(longTail.text).not.toContain("PREFIX_HEAD");
    expect(liveThoughtPreviewMarkdown("Thinking")).toEqual({
      preview: { fallback: "Thinking", maxLength: LIVE_THOUGHT_TAIL_PREVIEW_MAX_LENGTH },
    });
  });

  it("does not split a surrogate pair at the live tail boundary", () => {
    const prefix = "p".repeat(100);
    const tail = "t".repeat(LIVE_THOUGHT_TAIL_SOURCE_MAX_LENGTH - 1);
    const source = `${prefix}😀${tail}`;
    // rawStart = source.length - MAX = 100 + 2 + MAX - 1 - MAX = 101, which lands between high/low surrogates of 😀.
    const result = sliceLiveThoughtTailSource(source);
    expect(result.startOffset).toBe(102);
    expect(result.text).toBe(tail);
    expect(result.text).not.toContain("\uFFFD");
  });

  it("keeps the start offset anchored when frozen for a scrolled-up reader", () => {
    const base = `${"x".repeat(20_000)} ANCHOR_TEXT `;
    const initial = sliceLiveThoughtTailSource(base);
    const grown = `${base}${"y".repeat(2_000)} NEW_TAIL`;
    const frozen = sliceLiveThoughtTailSource(grown, { startOffset: initial.startOffset });
    expect(frozen.startOffset).toBe(initial.startOffset);
    expect(frozen.text.startsWith(initial.text)).toBe(true);
    expect(frozen.text).toContain("ANCHOR_TEXT");
    expect(frozen.text).toContain("NEW_TAIL");
  });
});

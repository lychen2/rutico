import { describe, expect, it } from "vite-plus/test";
import { extractProposedPlanHeadings } from "./proposedPlan";

describe("extractProposedPlanHeadings", () => {
  it("extracts H2 and H3 ATX headings while ignoring fenced code blocks and stripping inline markdown", () => {
    const markdown = [
      "# Plan Title",
      "",
      "## 1. Architecture & `Core` State",
      "Details here.",
      "### [Router](https://example.com) Integration",
      "```md",
      "## Ignored inside fenced code",
      "### Also ignored",
      "```",
      "## 2. **Verification** Steps ###",
    ].join("\n");

    expect(extractProposedPlanHeadings(markdown)).toEqual([
      { id: "2:1. Architecture & Core State", level: 2, text: "1. Architecture & Core State" },
      { id: "3:Router Integration", level: 3, text: "Router Integration" },
      { id: "2:2. Verification Steps", level: 2, text: "2. Verification Steps" },
    ]);
  });
});

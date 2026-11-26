import { describe, expect, it } from "vite-plus/test";

import { splitNumberSlots } from "./animated-number";
import { ContextualIconSwap, MORPHING_ICON_SHAPES, MorphingIcon } from "./morphing-icon";

describe("AnimatedNumber & MorphingIcon primitives", () => {
  it("splits formatted numbers into right-aligned stable digit slots", () => {
    expect(splitNumberSlots("42")).toEqual([
      { key: "d-1", char: "4", isDigit: true },
      { key: "d-0", char: "2", isDigit: true },
    ]);

    const slots = splitNumberSlots("1,204s");
    expect(slots.map((slot) => slot.char).join("")).toBe("1,204s");
    expect(slots.filter((slot) => slot.isDigit)).toHaveLength(4);
    expect(slots.at(-1)).toEqual({ key: "s-0-s", char: "s", isDigit: false });
  });

  it("defines valid 3-line geometric shapes for every MorphingIcon variant", () => {
    for (const shape of Object.values(MORPHING_ICON_SHAPES)) {
      expect(shape.lines).toHaveLength(3);
      for (const line of shape.lines) {
        expect(Number.isFinite(line.cx)).toBe(true);
        expect(Number.isFinite(line.cy)).toBe(true);
        expect(line.scale).toBeGreaterThan(0);
        expect(line.opacity).toBeGreaterThanOrEqual(0);
        expect(line.opacity).toBeLessThanOrEqual(1);
      }
    }
    expect(typeof MorphingIcon).toBe("function");
    expect(typeof ContextualIconSwap).toBe("function");
  });
});

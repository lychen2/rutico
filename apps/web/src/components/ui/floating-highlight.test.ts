import { describe, expect, it } from "vite-plus/test";

import { isPointInSafeTriangle } from "./floating-highlight";

describe("Tip 002 safe-triangle cascade submenu geometry", () => {
  const subPopupRect = { left: 220, top: 100, right: 380, bottom: 260 };

  it("returns true while cursor moves diagonally toward the open submenu", () => {
    const apex = { x: 140, y: 120 };
    expect(isPointInSafeTriangle({ x: 185, y: 150 }, apex, subPopupRect)).toBe(true);
    expect(isPointInSafeTriangle({ x: 210, y: 210 }, apex, subPopupRect)).toBe(true);
  });

  it("returns false when cursor moves straight down into sibling rows outside the triangle", () => {
    const apex = { x: 140, y: 120 };
    expect(isPointInSafeTriangle({ x: 140, y: 195 }, apex, subPopupRect)).toBe(false);
    expect(isPointInSafeTriangle({ x: 110, y: 160 }, apex, subPopupRect)).toBe(false);
  });

  it("works symmetrically when the submenu opens to the left", () => {
    const leftPopup = { left: 20, top: 100, right: 160, bottom: 260 };
    const apex = { x: 220, y: 130 };
    expect(isPointInSafeTriangle({ x: 185, y: 170 }, apex, leftPopup)).toBe(true);
    expect(isPointInSafeTriangle({ x: 225, y: 210 }, apex, leftPopup)).toBe(false);
  });
});

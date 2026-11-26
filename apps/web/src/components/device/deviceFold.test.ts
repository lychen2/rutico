import { describe, expect, it } from "@effect/vitest";

import {
  ANDROID_FOLD_TABLETOP_ANGLE,
  formatAndroidFoldAngle,
  formatDeviceAxLocator,
} from "./deviceFold";

describe("deviceFold helpers", () => {
  it("formats hinge angles cleanly within 0°..180°", () => {
    expect(formatAndroidFoldAngle(null)).toBe("--");
    expect(formatAndroidFoldAngle(Number.NaN)).toBe("--");
    expect(formatAndroidFoldAngle(0)).toBe("0°");
    expect(formatAndroidFoldAngle(ANDROID_FOLD_TABLETOP_ANGLE)).toBe("90°");
    expect(formatAndroidFoldAngle(180)).toBe("180°");
    expect(formatAndroidFoldAngle(210)).toBe("180°");
    expect(formatAndroidFoldAngle(-12)).toBe("0°");
  });

  it("formats Android accessibility element locators with pixel bounds", () => {
    const formatted = formatDeviceAxLocator(
      {
        id: "com.app:id/submit_btn",
        role: "Button",
        label: "Continue",
        x: 0.1,
        y: 0.5,
        width: 0.8,
        height: 0.05,
      },
      { width: 1080, height: 2400 },
    );
    expect(formatted.boundsLabel).toBe("108,1200 · 864×120px");
    expect(formatted.summary).toBe("Button · Continue · 108,1200 · 864×120px");
    expect(formatted.clipboardText).toContain("role=Button");
    expect(formatted.clipboardText).toContain('label="Continue"');
    expect(formatted.clipboardText).toContain("id=com.app:id/submit_btn");
  });
});

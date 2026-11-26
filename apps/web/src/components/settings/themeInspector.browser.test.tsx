import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ThemeEditorPanel } from "./ThemeEditorPanel";
import { clearThemeInspectorHover, showThemeInspectorHover } from "./themeInspector";

function readContrastBadge() {
  const badge = document.querySelector<HTMLElement>(
    "#theme-inspector-hover [data-theme-inspector-hover-contrast]",
  );
  return {
    text: badge?.textContent ?? "",
    ratio: badge?.dataset.contrastRatio ? Number(badge.dataset.contrastRatio) : null,
    grade: badge?.dataset.contrastGrade ?? "",
  };
}

describe("themeInspector contrast grading", () => {
  it("alpha-composites semi-transparent foregrounds and fails 3.0–4.5 normal body text", async () => {
    await using screen = await render(
      <div style={{ backgroundColor: "#ffffff", padding: 24 }}>
        <p
          data-testid="alpha-black"
          className="text-foreground"
          style={{ color: "rgba(0, 0, 0, 0.25)", fontSize: "14px", fontWeight: 400 }}
        >
          25% black on white
        </p>
        <p
          data-testid="opacity-black"
          className="text-foreground"
          style={{ color: "#000000", opacity: 0.25, fontSize: "14px", fontWeight: 400 }}
        >
          opacity 0.25 black on white
        </p>
        <p
          data-testid="gray-normal"
          className="text-muted-foreground"
          style={{ color: "#888888", fontSize: "14px", fontWeight: 400 }}
        >
          #888888 normal body text
        </p>
        <h2
          data-testid="gray-large"
          className="text-muted-foreground"
          style={{ color: "#888888", fontSize: "24px", fontWeight: 400 }}
        >
          #888888 large heading
        </h2>
        <p
          data-testid="aa-normal"
          className="text-muted-foreground"
          style={{ color: "#767676", fontSize: "14px", fontWeight: 400 }}
        >
          #767676 normal AA
        </p>
        <p
          data-testid="aaa-normal"
          className="text-foreground"
          style={{ color: "#000000", fontSize: "14px", fontWeight: 400 }}
        >
          #000000 normal AAA
        </p>
        <div style={{ backgroundColor: "rgba(0, 0, 0, 0.5)", padding: 8 }}>
          <p
            data-testid="white-on-translucent-bg"
            className="text-foreground"
            style={{ color: "#ffffff", fontSize: "14px", fontWeight: 400 }}
          >
            White over 50% black on white
          </p>
        </div>
      </div>,
    );
    using _cleanup = { [Symbol.dispose]: () => clearThemeInspectorHover() };

    // 1. 25% black on #ffffff must composite to ~1.83:1 and FAIL (never 21:1 AAA).
    showThemeInspectorHover(
      { element: screen.getByTestId("alpha-black").element(), role: "text" },
      "Text",
    );
    const alpha = readContrastBadge();
    expect(alpha.ratio).toBeCloseTo(1.83, 1);
    expect(alpha.grade).toBe("Fail");
    expect(alpha.text).toBe("Fail 1.8:1");
    expect(alpha.text).not.toContain("AA");

    // 1b. CSS opacity 0.25 on opaque black over #ffffff likewise composites to ~1.83:1 Fail.
    showThemeInspectorHover(
      { element: screen.getByTestId("opacity-black").element(), role: "text" },
      "Text",
    );
    const opacityBlack = readContrastBadge();
    expect(opacityBlack.ratio).toBeCloseTo(1.83, 1);
    expect(opacityBlack.grade).toBe("Fail");
    expect(opacityBlack.text).toBe("Fail 1.8:1");

    // 2. #888888 on #ffffff normal body text (~3.54:1) must FAIL normal body text AA.
    showThemeInspectorHover(
      { element: screen.getByTestId("gray-normal").element(), role: "mutedForeground" },
      "Muted",
    );
    const grayNormal = readContrastBadge();
    expect(grayNormal.ratio).toBeCloseTo(3.54, 1);
    expect(grayNormal.grade).toBe("Fail");
    expect(grayNormal.text).toBe("Fail 3.5:1");
    expect(grayNormal.text).not.toContain("AA");

    // 3. #888888 on #ffffff large text (24px) is explicitly labeled AA Large, never normal AA.
    showThemeInspectorHover(
      { element: screen.getByTestId("gray-large").element(), role: "mutedForeground" },
      "Muted",
    );
    const grayLarge = readContrastBadge();
    expect(grayLarge.ratio).toBeCloseTo(3.54, 1);
    expect(grayLarge.grade).toBe("AA Large");
    expect(grayLarge.text).toBe("AA Large 3.5:1");

    // 4. >= 4.5 normal body text passes AA, >= 7.0 passes AAA.
    showThemeInspectorHover(
      { element: screen.getByTestId("aa-normal").element(), role: "mutedForeground" },
      "Muted",
    );
    expect(readContrastBadge()).toEqual({ text: "AA 4.5:1", ratio: 4.54, grade: "AA" });

    showThemeInspectorHover(
      { element: screen.getByTestId("aaa-normal").element(), role: "text" },
      "Text",
    );
    expect(readContrastBadge()).toEqual({ text: "AAA 21.0:1", ratio: 21, grade: "AAA" });

    // 5. Semi-transparent intermediate background (rgba(0,0,0,0.5) over #ffffff -> #808080)
    // composites before measuring white text (~3.98:1 Fail for normal text).
    showThemeInspectorHover(
      { element: screen.getByTestId("white-on-translucent-bg").element(), role: "text" },
      "Text",
    );
    const translucentBg = readContrastBadge();
    expect(translucentBg.ratio).toBeCloseTo(3.98, 1);
    expect(translucentBg.grade).toBe("Fail");
    expect(translucentBg.text).toBe("Fail 4.0:1");
  });

  it("reports real composited contrast badges during ThemeEditorPanel inspect hover", async () => {
    await page.viewport(1280, 900);
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent =
      "[data-theme-editor-panel]{position:fixed;right:16px;top:16px;width:400px;height:300px}";
    using _style = { [Symbol.dispose]: () => style.remove() };
    using _cleanup = { [Symbol.dispose]: () => clearThemeInspectorHover() };

    await using screen = await render(
      <>
        <div style={{ backgroundColor: "#ffffff", padding: 32, width: 420 }}>
          <p
            data-testid="inspect-alpha"
            className="text-foreground"
            style={{ color: "rgba(0, 0, 0, 0.25)", fontSize: "14px" }}
          >
            Faint copy
          </p>
          <p
            data-testid="inspect-gray"
            className="text-muted-foreground"
            style={{ color: "#888888", fontSize: "14px" }}
          >
            Mid-gray copy
          </p>
        </div>
        <ThemeEditorPanel
          open
          onOpenChange={() => {}}
          onSaved={() => true}
          editingTheme={null}
          initialAppearance="light"
          restoreTheme={() => {}}
        />
      </>,
    );

    await userEvent.click(page.getByRole("button", { name: "Inspect app colors" }));

    await userEvent.hover(screen.getByTestId("inspect-alpha"));
    const alphaBadge = readContrastBadge();
    expect(alphaBadge.text).toBe("Fail 1.8:1");
    expect(alphaBadge.ratio).toBeCloseTo(1.83, 1);

    await userEvent.hover(screen.getByTestId("inspect-gray"));
    const grayBadge = readContrastBadge();
    expect(grayBadge.text).toBe("Fail 3.5:1");
    expect(grayBadge.ratio).toBeCloseTo(3.54, 1);
  });
});

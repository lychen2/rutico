import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { Toggle, ToggleGroup } from "./toggle-group";

async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

describe("ToggleGroup segmented dual-layer clip-path", () => {
  it("settles cleanly without runaway MutationObserver rebuilds, preserves P1-3 inert mirror invariants, and updates clipPath on segment switch", async () => {
    await using screen = await render(
      <div className="p-8" data-testid="wrapper">
        <ToggleGroup defaultValue={["first"]} variant="segmented">
          <Toggle value="first">
            <span id="seg-label-first">First</span>
          </Toggle>
          <Toggle value="second">
            <span id="seg-label-second">Second</span>
          </Toggle>
          <Toggle value="third">
            <span id="seg-label-third">Third</span>
          </Toggle>
        </ToggleGroup>
      </div>,
    );

    const group = screen.container.querySelector<HTMLElement>('[data-slot="toggle-group"]')!;
    const clipLayer = screen.container.querySelector<HTMLElement>(
      '[data-slot="toggle-group-clip-layer"]',
    )!;
    expect(group).not.toBeNull();
    expect(clipLayer).not.toBeNull();

    // Observe clipLayer mutations to guarantee zero infinite rebuild loops.
    let mirrorMutationCount = 0;
    const watchObserver = new MutationObserver(() => {
      mirrorMutationCount += 1;
    });
    watchObserver.observe(clipLayer, { childList: true, subtree: true });

    // Let initial ResizeObserver + microtasks settle; must remain bounded (no runaway loop).
    await vi.waitFor(() => {
      expect(clipLayer.style.clipPath).toMatch(/^inset\(/);
      expect(clipLayer.style.opacity).toBe("1");
    });
    await flushMicrotasks();
    const afterMountMutations = mirrorMutationCount;
    expect(afterMountMutations).toBeLessThanOrEqual(2);

    // P1-3 invariants: strictly inert, aria-hidden, pointer-events: none, zero duplicate IDs or buttons.
    expect(clipLayer.getAttribute("aria-hidden")).toBe("true");
    expect(clipLayer.hasAttribute("inert")).toBe(true);
    expect(getComputedStyle(clipLayer).pointerEvents).toBe("none");
    expect(clipLayer.querySelectorAll("button")).toHaveLength(0);
    expect(clipLayer.querySelectorAll("[id]")).toHaveLength(0);
    expect(document.querySelectorAll("#seg-label-first")).toHaveLength(1);
    expect(document.querySelectorAll("#seg-label-second")).toHaveLength(1);
    expect(clipLayer.querySelectorAll('[data-slot="toggle-clip-label"]')).toHaveLength(3);

    const firstClipPath = clipLayer.style.clipPath;

    // Triggering a resize rebuilds cleanly without spiraling into an infinite loop.
    group.style.paddingInline = "6px";
    await vi.waitFor(() => expect(mirrorMutationCount).toBeGreaterThanOrEqual(afterMountMutations));
    await flushMicrotasks();
    const afterResizeMutations = mirrorMutationCount;
    expect(afterResizeMutations - afterMountMutations).toBeLessThanOrEqual(2);

    // Switching to the third segment updates clip-path without triggering mirror childList rebuilds.
    await userEvent.click(page.getByRole("button", { name: "Third" }));
    await vi.waitFor(() => {
      expect(clipLayer.style.clipPath).toMatch(/^inset\(/);
      expect(clipLayer.style.clipPath).not.toBe(firstClipPath);
    });
    await flushMicrotasks();
    expect(mirrorMutationCount).toBe(afterResizeMutations);

    watchObserver.disconnect();
  });
});

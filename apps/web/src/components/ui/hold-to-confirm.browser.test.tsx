import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { HoldToConfirmButton } from "./hold-to-confirm";
import { Kbd } from "./kbd";

describe("HoldToConfirmButton and reactive Kbd", () => {
  it("cancels on early release and commits after holding for durationMs", async () => {
    const onConfirm = vi.fn();
    await using _screen = await render(
      <HoldToConfirmButton durationMs={80} onConfirm={onConfirm}>
        Delete thread
      </HoldToConfirmButton>,
    );

    const button = page.getByRole("button", { name: "Delete thread" }).element();

    // Release early: should not confirm.
    await act(() => {
      button.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }),
      );
    });
    expect(button.getAttribute("data-holding")).toBe("true");
    await act(() => {
      button.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }),
      );
    });
    expect(button.getAttribute("data-holding")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();

    // Hold through full duration: commits once.
    await act(() => {
      button.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 2 }),
      );
    });
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(button.getAttribute("data-holding")).toBeNull();
  });

  it("supports two-step assistive click confirmation without holding", async () => {
    const onConfirm = vi.fn();
    await using _screen = await render(
      <HoldToConfirmButton durationMs={1400} onConfirm={onConfirm}>
        Reset workspace
      </HoldToConfirmButton>,
    );

    const button = page.getByRole("button", { name: "Reset workspace" }).element();
    await act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.getAttribute("data-armed")).toBe("true");

    await act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("data-armed")).toBeNull();
  });

  it("depresses reactive Kbd keycaps while the physical key is held", async () => {
    await using _screen = await render(
      <div>
        <Kbd reactiveKey="Escape">Esc</Kbd>
        <Kbd>Ctrl</Kbd>
      </div>,
    );

    const esc = page.getByText("Esc").element();
    const ctrl = page.getByText("Ctrl").element();
    expect(esc.getAttribute("data-key-pressed")).toBeNull();
    expect(ctrl.getAttribute("data-key-pressed")).toBeNull();

    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    });
    expect(ctrl.getAttribute("data-key-pressed")).toBe("true");
    expect(esc.getAttribute("data-key-pressed")).toBeNull();

    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    });
    expect(ctrl.getAttribute("data-key-pressed")).toBeNull();
  });
});

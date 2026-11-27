import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, page } from "vite-plus/test/browser";

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

  it("does not confirm on held auto-repeating Enter in reduced-motion mode", async () => {
    const originalMatchMedia = window.matchMedia.bind(window);
    using _matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = originalMatchMedia(query);
      if (query === "(prefers-reduced-motion: reduce)") {
        return {
          ...result,
          matches: true,
          media: query,
          addEventListener: result.addEventListener.bind(result),
          removeEventListener: result.removeEventListener.bind(result),
        } as MediaQueryList;
      }
      return result;
    });

    const onConfirm = vi.fn();
    await using _screen = await render(
      <HoldToConfirmButton durationMs={1400} onConfirm={onConfirm}>
        Revert files too
      </HoldToConfirmButton>,
    );

    const button = page.getByRole("button", { name: "Revert files too" }).element() as HTMLElement;
    await act(() => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);

    // Real Chromium trusted keydown sequence: one initial press + auto-repeats while held + keyup.
    await cdp().send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
      autoRepeat: false,
    });
    for (let i = 0; i < 3; i += 1) {
      await cdp().send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: "\r",
        unmodifiedText: "\r",
        autoRepeat: true,
      });
    }
    await cdp().send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });

    await vi.waitFor(() => expect(button.getAttribute("data-armed")).toBe("true"));
    expect(onConfirm).not.toHaveBeenCalled();

    // Repeated Space keydown is also prevented before the reduced-motion return.
    const repeatedSpace = new KeyboardEvent("keydown", {
      key: " ",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      button.dispatchEvent(repeatedSpace);
    });
    expect(repeatedSpace.defaultPrevented).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();

    // A second distinct physical Enter press confirms once.
    await cdp().send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
      autoRepeat: false,
    });
    await cdp().send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
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

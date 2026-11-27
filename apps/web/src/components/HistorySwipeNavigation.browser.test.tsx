import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, render, stubGlobal } from "../../test/render";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";

const navigateHistory = vi.hoisted(() => vi.fn());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

function swipe(target: Element, deltaX: number) {
  for (const delta of [deltaX, 0]) {
    target.dispatchEvent(new WheelEvent("wheel", { deltaX: delta, bubbles: true, composed: true }));
  }
}

describe("HistorySwipeNavigation", () => {
  it.each([
    ["scrolling left inside a shadow-root scroller keeps the thread", "shadow", 100, -130, false],
    ["scrolling right inside a shadow-root scroller keeps the thread", "shadow", 100, 130, false],
    [
      "scrolling after a shadow scroller remount keeps the thread",
      "shadow-remount",
      100,
      130,
      false,
    ],
    ["scrolling left inside a scroller keeps the thread", "light", 100, -130, false],
    ["scrolling at a shadow-root scroller's left edge keeps the thread", "shadow", 0, -130, false],
    [
      "scrolling at a shadow-root scroller's right edge keeps the thread",
      "shadow",
      800,
      130,
      false,
    ],
    ["scrolling at a scroller's left edge keeps the thread", "light", 0, -130, false],
    ["scrolling at a scroller's right edge keeps the thread", "light", 800, 130, false],
    ["scrolling over a preview panel keeps the thread", "preview-panel", 0, -130, false],
    ["scrolling over a desktop preview keeps the thread", "preview-viewport", 0, 130, false],
    ["scrolling over a streamed preview keeps the thread", "server-browser", 0, -130, false],
    ["swiping back over a panel without overflow navigates", "none", 0, -130, true],
    ["a swipe that started in a closed dialog keeps the thread", "closed-dialog", 0, -130, false],
    ["swiping back over an open alert dialog keeps the thread", "alertdialog", 0, -130, false],
  ] as const)("%s", async (_name, scroller, scrollLeft, deltaX, navigates) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const root = scroller.startsWith("shadow") ? panel.attachShadow({ mode: "open" }) : panel;
    const viewport = root.appendChild(document.createElement("div"));
    const noOverflow = !scroller.startsWith("shadow") && scroller !== "light";
    if (scroller === "preview-panel") panel.setAttribute("data-preview-panel-mode", "inline");
    if (scroller === "preview-viewport") panel.setAttribute("data-preview-viewport", "tab");
    if (scroller === "server-browser") panel.setAttribute("data-server-browser-surface", "tab");
    if (scroller === "alertdialog") panel.setAttribute("role", "alertdialog");
    viewport.style.cssText = `width: 200px; overflow-x: ${noOverflow ? "visible" : "auto"}`;
    const content = viewport.appendChild(document.createElement("div"));
    content.style.cssText = `height: 20px; width: ${noOverflow ? 100 : 1000}px`;
    viewport.scrollLeft = scrollLeft;

    if (scroller === "closed-dialog") {
      panel.setAttribute("role", "dialog");
      content.dispatchEvent(new WheelEvent("wheel", { deltaX: -1, bubbles: true, composed: true }));
      panel.remove();
      screen.container.appendChild(viewport);
    }

    if (scroller === "shadow-remount") {
      content.dispatchEvent(new WheelEvent("wheel", { deltaX: 1, bubbles: true, composed: true }));
      const replacement = viewport.cloneNode(true) as HTMLDivElement;
      viewport.replaceWith(replacement);
      replacement.scrollLeft = scrollLeft;
      swipe(replacement, deltaX);
    } else {
      swipe(content, deltaX);
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });

  it("a horizontal mouse wheel tick off macOS keeps the thread", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    await using screen = await render(<HistorySwipeNavigation />);
    const content = screen.container.appendChild(document.createElement("div"));
    content.style.cssText = "height: 20px; width: 100px";

    swipe(content, -120);

    expect(navigateHistory).not.toHaveBeenCalled();
  });

  it.each([
    ["Shift-scroll keeps the thread", [[-130, true]]],
    [
      "pressing Shift during a swipe cancels navigation",
      [
        [-130, false],
        [-1, true],
      ],
    ],
    [
      "releasing Shift during a scroll keeps the thread",
      [
        [-1, true],
        [-130, false],
      ],
    ],
  ] as const)("%s", async (_name, events) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    for (const [deltaX, shiftKey] of [...events, [0, false] as const]) {
      screen.container.dispatchEvent(new WheelEvent("wheel", { deltaX, shiftKey, bubbles: true }));
    }
    expect(navigateHistory).not.toHaveBeenCalled();
  });

  // A vertical scroll 15° off vertical.
  const drift = Array.from({ length: 30 }, () => [-4, 15] as const);
  it.each([
    [
      "a vertical scroll that starts slightly diagonally keeps the thread",
      [[-5, 3], ...drift],
      false,
    ],
    [
      "a swipe that leans diagonally for two events navigates",
      [
        [-5, 3],
        [-2, 2],
        [-150, 0],
      ],
      true,
    ],
    ["a single diagonal event past the trigger keeps the thread", [[-130, 100]], false],
  ] as const)("%s", async (_name, events, navigates) => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    for (const [deltaX, deltaY] of [...events, [0, 0] as const]) {
      panel.dispatchEvent(
        new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, composed: true }),
      );
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });

  it("handles Linux Alt+ArrowLeft/Right deterministically and ignores editable inputs", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(
      <div data-slot="sidebar-inset">
        <input data-testid="editable" type="text" />
        <HistorySwipeNavigation />
      </div>,
    );

    const editable = screen.container.querySelector<HTMLInputElement>('[data-testid="editable"]')!;
    editable.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(navigateHistory).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(navigateHistory).toHaveBeenCalledTimes(1);
    expect(navigateHistory).toHaveBeenLastCalledWith("back");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(navigateHistory).toHaveBeenCalledTimes(2);
    expect(navigateHistory).toHaveBeenLastCalledWith("forward");
  });

  it("enforces single navigation ownership across DOM mouse thumb buttons, Electron app-command, and ServerBrowserSurface", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const menuListeners = new Set<(action: string) => void>();
    const originalBridge = window.desktopBridge;
    window.desktopBridge = {
      ...(originalBridge ?? ({} as NonNullable<typeof window.desktopBridge>)),
      onMenuAction: (listener: (action: string) => void) => {
        menuListeners.add(listener);
        return () => {
          menuListeners.delete(listener);
        };
      },
    } as NonNullable<typeof window.desktopBridge>;

    try {
      await using screen = await render(
        <div data-slot="sidebar-inset">
          <div data-server-browser-surface="tab" data-testid="guest-preview" />
          <div data-testid="workspace-content" />
          <HistorySwipeNavigation />
        </div>,
      );

      // 1. Hardware back click over workspace firing BOTH DOM mouseup(button=3) AND Electron app-command
      // must produce strictly ONE navigation step (Astra P0-2 single navigation owner).
      const workspace = screen.container.querySelector<HTMLElement>(
        '[data-testid="workspace-content"]',
      )!;
      const nowSpy = vi.spyOn(performance, "now");
      nowSpy.mockReturnValue(2_000);
      workspace.dispatchEvent(
        new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true }),
      );
      nowSpy.mockReturnValue(2_015);
      for (const listener of menuListeners) listener("history.app-command:back");
      expect(navigateHistory).toHaveBeenCalledTimes(1);
      expect(navigateHistory).toHaveBeenLastCalledWith("back");

      // 2. Hardware forward click over ServerBrowserSurface must NOT navigate host app history
      // even if Electron also delivers a companion app-command event.
      const guestPreview = screen.container.querySelector<HTMLElement>(
        '[data-testid="guest-preview"]',
      )!;
      nowSpy.mockReturnValue(2_500);
      guestPreview.dispatchEvent(
        new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true }),
      );
      nowSpy.mockReturnValue(2_510);
      for (const listener of menuListeners) listener("history.app-command:forward");
      expect(navigateHistory).toHaveBeenCalledTimes(1);

      // 3. Standalone forward click later (>100ms dedupe window) navigates forward once.
      nowSpy.mockReturnValue(3_000);
      workspace.dispatchEvent(
        new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true }),
      );
      expect(navigateHistory).toHaveBeenCalledTimes(2);
      expect(navigateHistory).toHaveBeenLastCalledWith("forward");
      nowSpy.mockRestore();
    } finally {
      if (originalBridge === undefined) {
        delete window.desktopBridge;
      } else {
        window.desktopBridge = originalBridge;
      }
    }
  });

  it("supports opt-in Linux wheel swipe with direct-DOM parallax cleared on release", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(
      <div data-slot="sidebar-inset" style={{ width: "800px", height: "600px" }}>
        <div data-testid="canvas" style={{ width: "100px", height: "100px" }} />
        <HistorySwipeNavigation enableLinuxWheelSwipe />
      </div>,
    );

    const inset = screen.container.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')!;
    const canvas = screen.container.querySelector<HTMLElement>('[data-testid="canvas"]')!;

    for (const deltaX of [-45, -45, -45]) {
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaX, bubbles: true, composed: true }));
    }
    expect(inset.style.transform).toContain("translate3d(");

    // Zero delta releases the gesture immediately and clears direct-DOM transform cleanly.
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: 0, bubbles: true, composed: true }));
    expect(inset.style.transform).toBe("");
    expect(navigateHistory).toHaveBeenCalledTimes(1);
    expect(navigateHistory).toHaveBeenLastCalledWith("back");
  });

  it("blocks standalone and paired Electron app-command navigation while a dialog is open or just handled a thumb click", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const menuListeners = new Set<(action: string) => void>();
    const originalBridge = window.desktopBridge;
    window.desktopBridge = {
      ...(originalBridge ?? ({} as NonNullable<typeof window.desktopBridge>)),
      onMenuAction: (listener: (action: string) => void) => {
        menuListeners.add(listener);
        return () => {
          menuListeners.delete(listener);
        };
      },
    } as NonNullable<typeof window.desktopBridge>;

    try {
      await using screen = await render(
        <div data-slot="sidebar-inset">
          <div role="dialog" data-testid="open-dialog">
            <button type="button" data-testid="dialog-body">
              Dialog content
            </button>
          </div>
          <HistorySwipeNavigation />
        </div>,
      );

      const dialog = screen.container.querySelector<HTMLElement>('[data-testid="open-dialog"]')!;
      const dialogBody = screen.container.querySelector<HTMLElement>(
        '[data-testid="dialog-body"]',
      )!;
      const nowSpy = vi.spyOn(performance, "now");

      // 1. Standalone Electron app-command Back/Forward with a dialog open must NOT navigate.
      nowSpy.mockReturnValue(1_000);
      for (const listener of menuListeners) listener("history.app-command:back");
      nowSpy.mockReturnValue(1_200);
      for (const listener of menuListeners) listener("history.app-command:forward");
      expect(navigateHistory).not.toHaveBeenCalled();

      // 2. Hardware thumb mouseup inside dialog followed by companion Electron app-command
      // must NOT navigate, even if the dialog closes between the DOM event and the IPC event.
      nowSpy.mockReturnValue(2_000);
      dialogBody.dispatchEvent(
        new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true }),
      );
      dialog.remove();
      nowSpy.mockReturnValue(2_015);
      for (const listener of menuListeners) listener("history.app-command:back");
      expect(navigateHistory).not.toHaveBeenCalled();

      // 3. Once the dialog is gone and the dedupe window has elapsed, app-command navigates normally.
      nowSpy.mockReturnValue(2_500);
      for (const listener of menuListeners) listener("history.app-command:back");
      expect(navigateHistory).toHaveBeenCalledTimes(1);
      expect(navigateHistory).toHaveBeenLastCalledWith("back");

      nowSpy.mockRestore();
    } finally {
      if (originalBridge === undefined) {
        delete window.desktopBridge;
      } else {
        window.desktopBridge = originalBridge;
      }
    }
  });

  it("resets macOS wheel gesture state and clears parallax after a quiet period across consecutive gestures without desktopBridge", async () => {
    navigateHistory.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    using _bridge = stubGlobal("desktopBridge", undefined);
    using _timers = fakeTimers();

    await using screen = await render(
      <div data-slot="sidebar-inset" style={{ width: "800px", height: "600px" }}>
        <div data-testid="mac-canvas" style={{ width: "100px", height: "100px" }} />
        <HistorySwipeNavigation />
      </div>,
    );

    const inset = screen.container.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')!;
    const canvas = screen.container.querySelector<HTMLElement>('[data-testid="mac-canvas"]')!;

    // 1. Vertical scroll enters ignored state; quiet period must reset it for subsequent gestures.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 0, deltaY: 60, bubbles: true, composed: true }),
    );
    vi.advanceTimersByTime(200);
    expect(navigateHistory).not.toHaveBeenCalled();

    // 2. Short horizontal swipe with no zero-delta/momentum tail translates sidebar inset,
    // then quiet period clears the parallax transform without navigating.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaX: -40, deltaY: 0, bubbles: true, composed: true }),
    );
    expect(inset.style.transform).toContain("translate3d(");
    vi.advanceTimersByTime(200);
    expect(inset.style.transform).toBe("");
    expect(navigateHistory).not.toHaveBeenCalled();

    // 3. Subsequent full horizontal swipe in the same mount navigates and clears parallax.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaX: -65, deltaY: 0, bubbles: true, composed: true }),
    );
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaX: -70, deltaY: 0, bubbles: true, composed: true }),
    );
    expect(inset.style.transform).toContain("translate3d(");
    vi.advanceTimersByTime(200);
    expect(inset.style.transform).toBe("");
    expect(navigateHistory).toHaveBeenCalledTimes(1);
    expect(navigateHistory).toHaveBeenLastCalledWith("back");
  });
});

import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AnchoredToastProvider, ToastProvider, anchoredToastManager, toastManager } from "./toast";

describe("toastManager", () => {
  it("shows a toast added before any provider mounted", async () => {
    toastManager.add({ type: "info", title: "Raised before the first render" });

    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);

    await expect.element(page.getByText("Raised before the first render")).toBeVisible();
  });

  it("exposes one Notifications landmark when both toast providers mount", async () => {
    await using _screen = await render(
      <ToastProvider>
        <AnchoredToastProvider>{null}</AnchoredToastProvider>
      </ToastProvider>,
    );

    const notifications = page.getByRole("region", { name: "Notifications" });
    await expect.element(notifications.first()).toBeInTheDocument();
    expect(
      notifications.elements(),
      "only the corner toast viewport should be a Notifications landmark",
    ).toHaveLength(1);
    await expect.element(notifications).toHaveAttribute("data-slot", "toast-viewport");

    const anchoredViewport = document.querySelector("[data-slot=toast-viewport-anchored]");
    expect(anchoredViewport).toHaveAttribute("aria-live", "polite");
  });

  it("morphs loading to success in place and plays completion sheen only for terminal non-action toasts", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);

    const loadingId = toastManager.add({
      type: "loading",
      title: "Saving workspace…",
      timeout: 0,
    });
    await expect.element(page.getByText("Saving workspace…")).toBeVisible();

    const findRootByText = (text: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast-root"]')).find((node) =>
        node.textContent?.includes(text),
      ) ?? null;

    const loadingRoot = findRootByText("Saving workspace…");
    expect(loadingRoot).not.toBeNull();
    expect(loadingRoot?.querySelector('[data-slot="animated-height"]')).not.toBeNull();
    expect(loadingRoot?.querySelector('[data-slot="toast-completion-sheen"]')).toBeNull();

    toastManager.update(loadingId, {
      type: "success",
      title: "Workspace saved",
      description: "All settings persisted cleanly.",
      timeout: 0,
    });
    await expect.element(page.getByText("Workspace saved")).toBeVisible();

    const updatedRoot = findRootByText("Workspace saved");
    expect(updatedRoot).toBe(loadingRoot);
    const sheen = updatedRoot?.querySelector<HTMLElement>('[data-slot="toast-completion-sheen"]');
    expect(sheen).not.toBeNull();
    expect(sheen?.dataset.toastSheenType).toBe("success");

    toastManager.close(loadingId);

    const actionId = toastManager.add({
      type: "success",
      title: "Thread archived",
      actionProps: { children: "Undo", onClick: () => {} },
      timeout: 0,
    });
    await expect.element(page.getByText("Thread archived")).toBeVisible();
    const actionRoot = findRootByText("Thread archived");
    expect(actionRoot?.querySelector('[data-slot="toast-completion-sheen"]')).toBeNull();
    toastManager.close(actionId);
  });

  it("assigns 3-layer Sonner depth stack attributes across stacked toasts", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);

    const ids = [
      toastManager.add({ type: "info", title: "Stack item 1", timeout: 0 }),
      toastManager.add({ type: "info", title: "Stack item 2", timeout: 0 }),
      toastManager.add({ type: "info", title: "Stack item 3", timeout: 0 }),
      toastManager.add({ type: "info", title: "Stack item 4", timeout: 0 }),
    ];

    await expect.element(page.getByText("Stack item 4")).toBeVisible();
    const layers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="toast-root"]'),
    ).map((node) => node.dataset.toastLayer);
    expect(layers).toContain("0");
    expect(layers).toContain("1");
    expect(layers).toContain("2");
    expect(layers).toContain("3");

    for (const id of ids) {
      toastManager.close(id);
    }
  });

  it("renders a pauseable semantic countdown hairline for timed toasts and omits it when timeout is 0", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);

    const timedId = toastManager.add({
      type: "info",
      title: "Timed notification",
      timeout: 4200,
    });
    const persistentId = toastManager.add({
      type: "warning",
      title: "Persistent notification",
      timeout: 0,
    });

    await expect.element(page.getByText("Timed notification")).toBeVisible();
    await expect.element(page.getByText("Persistent notification")).toBeVisible();

    const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast-root"]'));
    const timedRoot = roots.find((node) => node.textContent?.includes("Timed notification"));
    const persistentRoot = roots.find((node) =>
      node.textContent?.includes("Persistent notification"),
    );

    const hairline = timedRoot?.querySelector<HTMLElement>('[data-slot="toast-countdown"]');
    expect(hairline).not.toBeNull();
    expect(hairline?.style.getPropertyValue("--toast-countdown-duration")).toBe("4200ms");
    expect(hairline?.dataset.toastCountdownType).toBe("info");
    expect(persistentRoot?.querySelector('[data-slot="toast-countdown"]')).toBeNull();

    toastManager.close(timedId);
    toastManager.close(persistentId);
  });

  it("dismisses a toast on a quick horizontal flick meeting the 0.11px/ms threshold", async () => {
    await using _screen = await render(<ToastProvider position="top-right">{null}</ToastProvider>);

    const toastId = toastManager.add({
      type: "info",
      title: "Swipeable toast",
      timeout: 0,
    });
    await expect.element(page.getByText("Swipeable toast")).toBeVisible();

    const root = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="toast-root"]'),
    ).find((node) => node.textContent?.includes("Swipeable toast"))!;
    expect(root).not.toBeNull();
    // Base UI calls setPointerCapture on pointerdown; synthetic PointerEvents have no native active pointer.
    vi.spyOn(root, "setPointerCapture").mockImplementation(() => {});
    vi.spyOn(root, "releasePointerCapture").mockImplementation(() => {});
    vi.spyOn(root, "hasPointerCapture").mockReturnValue(true);

    const startTime = 1_000;
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(startTime);
    root.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 7,
        clientX: 100,
        clientY: 20,
      }),
    );

    nowSpy.mockReturnValue(startTime + 20);
    root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        pointerId: 7,
        clientX: 112,
        clientY: 20,
      }),
    );
    expect(root.style.getPropertyValue("--toast-swipe-tilt")).not.toBe("");

    nowSpy.mockReturnValue(startTime + 40);
    root.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 7,
        clientX: 124,
        clientY: 20,
      }),
    );
    nowSpy.mockRestore();

    await expect.element(page.getByText("Swipeable toast")).not.toBeInTheDocument();
    toastManager.close(toastId);
  });

  it("ignores a 4px/30ms jitter click on both the toast body and a child action button without firing onClose", async () => {
    await using _screen = await render(<ToastProvider position="top-right">{null}</ToastProvider>);

    const onClose = vi.fn();
    const onActionClick = vi.fn();
    const toastId = toastManager.add({
      type: "warning",
      title: "New device connected",
      timeout: 0,
      actionProps: { children: "Review", onClick: onActionClick },
      data: { onClose },
    });
    await expect.element(page.getByText("New device connected")).toBeVisible();

    const root = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="toast-root"]'),
    ).find((node) => node.textContent?.includes("New device connected"))!;
    const actionButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Review"),
    )!;
    expect(actionButton).not.toBeUndefined();

    vi.spyOn(root, "setPointerCapture").mockImplementation(() => {});
    vi.spyOn(root, "releasePointerCapture").mockImplementation(() => {});
    vi.spyOn(root, "hasPointerCapture").mockReturnValue(true);

    const nowSpy = vi.spyOn(performance, "now");

    // 1. 4px / 30ms jitter on the toast body (0.133 px/ms > 0.11 px/ms, but below minimum travel).
    nowSpy.mockReturnValue(2_000);
    root.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 11,
        clientX: 100,
        clientY: 20,
      }),
    );
    nowSpy.mockReturnValue(2_030);
    root.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 11,
        clientX: 104,
        clientY: 20,
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    await expect.element(page.getByText("New device connected")).toBeVisible();

    // 2. Pointer gesture starting on a child action button (even with >= 24px movement) must not swipe-dismiss.
    nowSpy.mockReturnValue(3_000);
    actionButton.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 12,
        clientX: 100,
        clientY: 20,
      }),
    );
    nowSpy.mockReturnValue(3_030);
    actionButton.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 12,
        clientX: 132,
        clientY: 20,
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    await expect.element(page.getByText("New device connected")).toBeVisible();

    // 3. Deliberate horizontal flick on the toast body (>= 24px travel and >= 0.11 px/ms) dismisses and calls onClose.
    nowSpy.mockReturnValue(4_000);
    root.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 13,
        clientX: 100,
        clientY: 20,
      }),
    );
    nowSpy.mockReturnValue(4_020);
    root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        pointerId: 13,
        clientX: 116,
        clientY: 20,
      }),
    );
    nowSpy.mockReturnValue(4_040);
    root.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 13,
        clientX: 132,
        clientY: 20,
      }),
    );
    nowSpy.mockRestore();

    expect(onClose).toHaveBeenCalledOnce();
    await expect.element(page.getByText("New device connected")).not.toBeInTheDocument();
    toastManager.close(toastId);
  });

  it("renders a directional AnchoredToast micro-pill with crisp emerald check mark on success", async () => {
    await using screen = await render(
      <AnchoredToastProvider>
        <button data-testid="copy-anchor" type="button">
          Copy
        </button>
      </AnchoredToastProvider>,
    );

    const anchor = screen.container.querySelector<HTMLButtonElement>(
      '[data-testid="copy-anchor"]',
    )!;
    const anchoredId = anchoredToastManager.add({
      type: "success",
      title: "Copied!",
      timeout: 0,
      positionerProps: { anchor, side: "top" },
      data: { tooltipStyle: true },
    });

    await expect.element(page.getByText("Copied!")).toBeVisible();
    const pill = document.querySelector<HTMLElement>('[data-toast-micro-pill="true"]');
    expect(pill).not.toBeNull();
    expect(pill?.querySelector('[data-slot="toast-micro-check"]')).not.toBeNull();
    anchoredToastManager.close(anchoredId);
  });
});

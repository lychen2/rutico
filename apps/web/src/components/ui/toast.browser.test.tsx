import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AnchoredToastProvider, ToastProvider, toastManager } from "./toast";

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
});

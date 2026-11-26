import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { ScrollToEndButton } from "./TimelineOverlays";

it("keeps the jump button on the right of the composer lane at both widths", async () => {
  const jump = vi.fn();
  await using screen = await render(
    <div className="fixed inset-0">
      <div className="chat-composer-lane">
        <div
          data-testid="composer"
          className="mx-auto h-10 w-full max-w-(--chat-content-max-width)"
        />
      </div>
      <ScrollToEndButton bottom={16} summary="2 tasks" onScrollToEnd={jump} />
    </div>,
  );
  const button = screen.getByRole("button", { name: /Scroll to end.*2 tasks/ });
  for (const width of [360, 1280]) {
    await page.viewport(width, 800);
    for (const animation of screen.container.getAnimations({ subtree: true })) animation.finish();
    const lane = screen.getByTestId("composer").element().getBoundingClientRect();
    const bounds = button.element().getBoundingClientRect();
    expect(Math.abs(bounds.right - lane.right)).toBeLessThan(1);
    expect(bounds.left).toBeGreaterThan(lane.left + lane.width / 2);
  }
  await button.click();
  expect(jump).toHaveBeenCalledOnce();
  expect(screen.container.querySelector('[data-scroll-to-end-indicator="true"]')).not.toBeNull();

  await screen.rerender(
    <div className="fixed inset-0">
      <div className="chat-composer-lane">
        <div
          data-testid="composer"
          className="mx-auto h-10 w-full max-w-(--chat-content-max-width)"
        />
      </div>
      <ScrollToEndButton bottom={16} summary={null} onScrollToEnd={jump} />
    </div>,
  );
  expect(screen.container.querySelector('[data-scroll-to-end-indicator="true"]')).toBeNull();
});

it("morphs into an expanded live-status capsule while the agent is working and collapses when idle", async () => {
  await using screen = await render(
    <div className="fixed inset-0">
      <div className="chat-composer-lane">
        <div
          data-testid="composer"
          className="mx-auto h-10 w-full max-w-(--chat-content-max-width)"
        />
      </div>
      <ScrollToEndButton bottom={16} summary={null} isWorking onScrollToEnd={() => {}} />
    </div>,
  );
  const button = screen.getByRole("button", { name: /Scroll to end.*Thinking/ });
  expect(button.element().getAttribute("data-scroll-to-end-expanded")).toBe("true");
  expect(
    screen.container.querySelector(
      '[data-scroll-to-end-indicator="true"][data-scroll-to-end-live="true"]',
    ),
  ).not.toBeNull();

  await screen.rerender(
    <div className="fixed inset-0">
      <div className="chat-composer-lane">
        <div
          data-testid="composer"
          className="mx-auto h-10 w-full max-w-(--chat-content-max-width)"
        />
      </div>
      <ScrollToEndButton bottom={16} summary={null} isWorking={false} onScrollToEnd={() => {}} />
    </div>,
  );
  const collapsed = screen.getByRole("button", { name: "Scroll to end" });
  expect(collapsed.element().getAttribute("data-scroll-to-end-expanded")).toBe("false");
  expect(screen.container.querySelector('[data-scroll-to-end-indicator="true"]')).toBeNull();
});

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
    const lane = screen.getByTestId("composer").element().getBoundingClientRect();
    const bounds = button.element().getBoundingClientRect();
    expect(Math.abs(bounds.right - lane.right)).toBeLessThan(1);
    expect(bounds.left).toBeGreaterThan(lane.left + lane.width / 2);
  }
  await button.click();
  expect(jump).toHaveBeenCalledOnce();
});

import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { ThreadFindBar } from "./ThreadFindBar";
import { TimelineMinimap } from "./TimelineMinimap";
import type { TimelineMinimapItem } from "./timelineMinimapItems";

const MINIMAP_ITEMS: readonly TimelineMinimapItem[] = [
  { id: "row-turn-1", rowIndex: 0, userText: "First prompt", assistantText: "First reply" },
  { id: "row-turn-2", rowIndex: 2, userText: "Second prompt", assistantText: "Second reply" },
  { id: "row-turn-3", rowIndex: 4, userText: "Third prompt", assistantText: "Third reply" },
];

it("pulses a subtle arrival highlight on minimap jumps and clears when finished", async () => {
  const onSelect = vi.fn();
  await using screen = await render(
    <div data-assistant-citation-viewport="true" className="relative h-96 w-full">
      <div data-timeline-row-id="row-turn-1" className="h-12">
        First prompt
      </div>
      <div data-timeline-row-id="row-turn-2" className="h-12">
        Second prompt
      </div>
      <TimelineMinimap
        hasPersistentGutter
        hitStripWidth={24}
        currentIndex={1}
        atEnd={false}
        items={MINIMAP_ITEMS}
        stripMap={new Map()}
        onWheel={() => {}}
        onSelect={onSelect}
      />
    </div>,
    { router: false },
  );

  const row1 = screen.container.querySelector<HTMLElement>('[data-timeline-row-id="row-turn-1"]')!;
  const animateSpy = vi.spyOn(row1, "animate");

  const previousButton = screen.getByRole("button", { name: "Previous turn" });
  await previousButton.click();

  expect(onSelect).toHaveBeenCalledWith(MINIMAP_ITEMS[0]);
  await vi.waitFor(() => {
    expect(animateSpy).toHaveBeenCalledOnce();
    expect(row1.getAttribute("data-timeline-arrival-highlight")).toBe("true");
  });
  expect(animateSpy.mock.calls[0]?.[1]).toEqual({ duration: 600, easing: "ease-out" });

  // Finish the animation and verify the transient attribute is removed.
  const animation = animateSpy.mock.results[0]?.value as Animation | undefined;
  animation?.finish();
  await vi.waitFor(() => {
    expect(row1.getAttribute("data-timeline-arrival-highlight")).toBeNull();
  });
});

it("skips the arrival highlight under prefers-reduced-motion", async () => {
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

  await using screen = await render(
    <div data-assistant-citation-viewport="true" className="relative h-96 w-full">
      <div data-timeline-row-id="row-turn-1" className="h-12">
        First prompt
      </div>
      <TimelineMinimap
        hasPersistentGutter
        hitStripWidth={24}
        currentIndex={1}
        atEnd={false}
        items={MINIMAP_ITEMS}
        stripMap={new Map()}
        onWheel={() => {}}
        onSelect={() => {}}
      />
    </div>,
    { router: false },
  );

  const row1 = screen.container.querySelector<HTMLElement>('[data-timeline-row-id="row-turn-1"]')!;
  const animateSpy = vi.spyOn(row1, "animate");
  const rafSpy = vi.spyOn(window, "requestAnimationFrame");

  await screen.getByRole("button", { name: "Previous turn" }).click();

  expect(rafSpy).not.toHaveBeenCalled();
  expect(animateSpy).not.toHaveBeenCalled();
  expect(row1.getAttribute("data-timeline-arrival-highlight")).toBeNull();
});

it("pulses the active row on ThreadFindBar jumps and skips repeat pulses on the same row", async () => {
  const baseFindProps = {
    open: true,
    query: "alpha",
    matchCount: 3,
    counting: false,
    status: null,
    onRetry: () => {},
    activeIndex: 0,
    navigationId: 1,
    settled: true,
    focusRequestId: 1,
    onQueryChange: () => {},
    onNext: () => {},
    onPrevious: () => {},
    onClose: () => {},
  } as const;

  await using screen = await render(
    <div data-assistant-citation-viewport="true" className="relative h-96 w-full">
      <div data-timeline-row-id="row-a" className="h-12">
        alpha one alpha two
      </div>
      <div data-timeline-row-id="row-b" className="h-12">
        alpha three
      </div>
      <ThreadFindBar {...baseFindProps} />
    </div>,
    { router: false },
  );

  const rowA = screen.container.querySelector<HTMLElement>('[data-timeline-row-id="row-a"]')!;
  const rowB = screen.container.querySelector<HTMLElement>('[data-timeline-row-id="row-b"]')!;
  const animateA = vi.spyOn(rowA, "animate");
  const animateB = vi.spyOn(rowB, "animate");

  const setActiveHighlight = (row: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(row.firstChild!);
    CSS.highlights.set("t3-thread-find-active", new Highlight(range));
  };

  setActiveHighlight(rowA);
  try {
    await vi.waitFor(() => expect(animateA).toHaveBeenCalledOnce());

    // Stepping to another match on the same row should not re-pulse rowA.
    await screen.rerender(
      <div data-assistant-citation-viewport="true" className="relative h-96 w-full">
        <div data-timeline-row-id="row-a" className="h-12">
          alpha one alpha two
        </div>
        <div data-timeline-row-id="row-b" className="h-12">
          alpha three
        </div>
        <ThreadFindBar {...baseFindProps} activeIndex={1} navigationId={2} />
      </div>,
    );
    await expect.element(screen.getByText("2/3").first()).toBeInTheDocument();

    // Stepping to a different row pulses rowB without ever re-pulsing rowA.
    setActiveHighlight(rowB);
    await screen.rerender(
      <div data-assistant-citation-viewport="true" className="relative h-96 w-full">
        <div data-timeline-row-id="row-a" className="h-12">
          alpha one alpha two
        </div>
        <div data-timeline-row-id="row-b" className="h-12">
          alpha three
        </div>
        <ThreadFindBar {...baseFindProps} activeIndex={2} navigationId={3} />
      </div>,
    );
    await vi.waitFor(() => expect(animateB).toHaveBeenCalledOnce());
    expect(animateA).toHaveBeenCalledOnce();
  } finally {
    CSS.highlights.delete("t3-thread-find-active");
  }
});

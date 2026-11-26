import { EnvironmentId, RunId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { MessagesTimeline } from "./MessagesTimeline";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const LIVE_RUN_ID = RunId.make("run-live-thinking");
const CREATED_AT = "2026-03-17T19:12:28.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

function baseProps(routeKey: string): Omit<TimelineProps, "timelineEntries"> {
  return {
    isWorking: true,
    listRef: createRef<LegendListRef | null>(),
    latestRun: {
      runId: LIVE_RUN_ID,
      status: "running",
      startedAt: CREATED_AT,
      completedAt: null,
    },
    runningRunId: LIVE_RUN_ID,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: routeKey,
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    onAnchorSizeChanged: () => {},
    contentInsetEndAdjustment: 0,
    emptyPlaceholderInset: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
  };
}

function reasoningEntry(
  id: string,
  detail: string,
  status: "inProgress" | "completed" = "inProgress",
  runId: RunId | null = status === "inProgress" ? LIVE_RUN_ID : null,
): Entry {
  return {
    id,
    kind: "work",
    createdAt: CREATED_AT,
    entry: {
      id,
      createdAt: CREATED_AT,
      runId,
      label: status === "inProgress" ? "Thinking" : "Thought",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: status,
      detail,
    },
  } as Entry;
}

function repeatParagraphs(count: number, tag: string): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${tag} line ${index}: inspecting workspace modules and tracing state transitions.`,
  ).join("\n");
}

describe("Live thinking window tail following and historical prefix summary (A09)", () => {
  it("streams trailing sentinel markers past 2,048, 8,192, and 16,384 chars without stealing user scroll-up position", async () => {
    const routeKey = `environment-local:live-thinking-${Math.random().toString(36).slice(2)}`;
    const props = baseProps(routeKey);
    const container = document.createElement("div");
    container.style.cssText = "height: 800px; width: 640px; display: flex; flex-direction: column;";

    const over3k = `${repeatParagraphs(50, "phase-3k")}\nSENTINEL_3K_END`;
    expect(over3k.length).toBeGreaterThan(3_000);

    await using screen = await render(
      <MessagesTimeline
        {...props}
        isWorking
        timelineEntries={[reasoningEntry("thought-live", over3k, "inProgress")]}
      />,
      { container },
    );

    const getWindow = () =>
      container.querySelector<HTMLElement>('[data-live-reasoning-window="true"]');

    await vi.waitFor(() => {
      const win = getWindow();
      expect(win).not.toBeNull();
      expect(win!.textContent).toContain("SENTINEL_3K_END");
      expect(win!.scrollHeight).toBeGreaterThan(win!.clientHeight);
      expect(win!.scrollHeight - win!.scrollTop - win!.clientHeight).toBeLessThanOrEqual(6);
    });

    // Stream past 8,192 chars (> 9,000 chars) -> trailing sentinel must appear and stay scrolled to bottom.
    const over9k = `${over3k}\n${repeatParagraphs(90, "phase-9k")}\nSENTINEL_9K_END`;
    expect(over9k.length).toBeGreaterThan(9_000);

    await screen.rerender(
      <MessagesTimeline
        {...props}
        isWorking
        timelineEntries={[reasoningEntry("thought-live", over9k, "inProgress")]}
      />,
    );

    await vi.waitFor(() => {
      const win = getWindow()!;
      expect(win.textContent).toContain("SENTINEL_9K_END");
      expect(win.scrollHeight - win.scrollTop - win.clientHeight).toBeLessThanOrEqual(6);
    });

    // Stream past 16,384 chars (> 20,000 chars) -> live tail window keeps newest sentinel visible.
    const over20k = `${over9k}\n${repeatParagraphs(170, "phase-20k")}\nSENTINEL_20K_END`;
    expect(over20k.length).toBeGreaterThan(20_000);

    await screen.rerender(
      <MessagesTimeline
        {...props}
        isWorking
        timelineEntries={[reasoningEntry("thought-live", over20k, "inProgress")]}
      />,
    );

    await vi.waitFor(() => {
      const win = getWindow()!;
      expect(win.textContent).toContain("SENTINEL_20K_END");
      expect(win.scrollHeight - win.scrollTop - win.clientHeight).toBeLessThanOrEqual(6);
    });

    // User scrolls up inside the live thinking window -> new appended tokens must NOT yank scroll back down.
    const scroller = getWindow()!;
    const pinnedScrollTop = 24;
    scroller.scrollTop = pinnedScrollTop;
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));

    const scrollHeightBeforeAppend = scroller.scrollHeight;
    const appendedAfterScrollUp = `${over20k}\n${repeatParagraphs(12, "phase-after-scroll-up")}\nSENTINEL_AFTER_SCROLL_UP`;

    await screen.rerender(
      <MessagesTimeline
        {...props}
        isWorking
        timelineEntries={[reasoningEntry("thought-live", appendedAfterScrollUp, "inProgress")]}
      />,
    );

    await vi.waitFor(() => {
      const win = getWindow()!;
      expect(win.textContent).toContain("SENTINEL_AFTER_SCROLL_UP");
      expect(win.scrollHeight).toBeGreaterThan(scrollHeightBeforeAppend);
    });
    expect(getWindow()!.scrollTop).toBe(pinnedScrollTop);

    // Scrolling back down to the bottom re-engages live tail following.
    const resumedScroller = getWindow()!;
    resumedScroller.scrollTop = resumedScroller.scrollHeight;
    resumedScroller.dispatchEvent(new Event("scroll", { bubbles: false }));

    const afterResume = `${appendedAfterScrollUp}\n${repeatParagraphs(8, "phase-resumed")}\nSENTINEL_RESUMED_TAIL`;
    await screen.rerender(
      <MessagesTimeline
        {...props}
        isWorking
        timelineEntries={[reasoningEntry("thought-live", afterResume, "inProgress")]}
      />,
    );

    await vi.waitFor(() => {
      const win = getWindow()!;
      expect(win.textContent).toContain("SENTINEL_RESUMED_TAIL");
      expect(win.scrollHeight - win.scrollTop - win.clientHeight).toBeLessThanOrEqual(6);
    });
  });

  it("keeps collapsed historical reasoning summaries displaying the prefix rather than the tail", async () => {
    const routeKey = `environment-local:historical-thinking-${Math.random().toString(36).slice(2)}`;
    const props = baseProps(routeKey);
    const container = document.createElement("div");
    container.style.cssText = "height: 800px; width: 640px; display: flex; flex-direction: column;";

    const longCompletedThought = `HISTORICAL_PREFIX_START ${repeatParagraphs(140, "body")}\nHISTORICAL_TAIL_OMITTED`;
    expect(longCompletedThought.length).toBeGreaterThan(9_000);

    await using screen = await render(
      <MessagesTimeline
        {...props}
        isWorking={false}
        latestRun={null}
        runningRunId={null}
        timelineEntries={[reasoningEntry("thought-done", longCompletedThought, "completed")]}
      />,
      { container },
    );

    await vi.waitFor(() => {
      expect(screen.container.textContent).toContain("HISTORICAL_PREFIX_START");
    });
    expect(screen.container.textContent).not.toContain("HISTORICAL_TAIL_OMITTED");
    expect(container.querySelector('[data-live-reasoning-window="true"]')).toBeNull();
  });
});

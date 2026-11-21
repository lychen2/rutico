import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerThreadContext } from "./ComposerThreadContext";

it("opens context details by keyboard and returns focus when dismissed", async () => {
  await using screen = await render(
    <ComposerThreadContext
      usage={null}
      run={null}
      stepCount={null}
      turnUsage={null}
      contextStatus="mc: 131.7K (65%) · ⚠ historian failed"
    />,
  );
  const trigger = screen.getByRole("button", { name: /Context/ });
  await userEvent.tab();
  await expect.element(trigger).toHaveFocus();
  await userEvent.keyboard("{Enter}");

  const details = page.getByRole("dialog", { name: "Overview" });
  await expect.element(details.getByText("Not reported")).toBeVisible();
  await details.getByText("Diagnostics").click();
  await expect.element(details.getByText(/historian failed/)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(details).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

it("keeps round token and cache totals separate from the current context window", async () => {
  const startedAt = DateTime.makeUnsafe("2026-11-20T12:00:00Z");
  await using screen = await render(
    <ComposerThreadContext
      key="first"
      usage={deriveLatestContextWindowSnapshot([], {
        usedTokens: 42_000,
        maxTokens: 200_000,
        updatedAt: "2026-11-20T12:00:14Z",
      })}
      run={{
        ordinal: 7,
        status: "completed",
        startedAt,
        workStartedAt: DateTime.add(startedAt, { seconds: 2 }),
        completedAt: DateTime.add(startedAt, { seconds: 14 }),
      }}
      stepCount={3}
      activity={{
        tools: { count: 2, milliseconds: 3000, timed: 2 },
        reasoning: { count: 1, milliseconds: 2000, timed: 1 },
      }}
      turnUsage={{
        usageScope: "main_agent",
        usageStatus: "complete",
        hasSubagents: true,
        inputTokens: 1_000,
        outputTokens: 200,
        cachedInputTokens: 750,
        cacheCreationTokens: 100,
      }}
    />,
  );

  const trigger = screen.getByRole("button", { name: /Round 7/ });
  for (const value of ["3 steps", "1,200 tokens", "Cache 75%"]) {
    await expect.element(trigger.getByText(value, { exact: true })).toBeVisible();
  }
  await userEvent.click(trigger);
  const details = page.getByRole("dialog", { name: "Overview" });
  await expect.element(details.getByText("2 · Σ 3s")).toBeVisible();
  await expect.element(details.getByText("16.7 tok/s")).toBeVisible();
  await expect.element(details.getByText("12s")).toBeVisible();
  await expect.element(details.getByText("Completed")).toBeVisible();
  await expect.element(details.getByText("42,000 of 200,000 tokens · 21%")).toBeVisible();
  await expect.element(details.getByText("Round token usage")).toBeVisible();
  await expect.element(details.getByText("750", { exact: true })).toBeVisible();
  await expect.element(details.getByText("100", { exact: true })).toBeVisible();

  await screen.rerender(
    <ComposerThreadContext
      key="second"
      usage={null}
      run={{ ordinal: 1, status: "starting", startedAt: null, completedAt: null }}
      stepCount={0}
      turnUsage={null}
    />,
  );
  await expect.element(details).not.toBeInTheDocument();
  const nextTrigger = screen.getByRole("button", { name: /Round 1/ });
  await expect.element(nextTrigger.getByText("0 steps", { exact: true })).toBeVisible();
  await userEvent.click(nextTrigger);
  await expect.element(details.getByText("Starting")).toBeVisible();
  await expect.element(details.getByText("Not reported").first()).toBeVisible();
  await expect.element(details.getByText("Round token usage")).not.toBeInTheDocument();
});

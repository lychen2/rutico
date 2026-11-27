import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { MessageId, ProviderTurnId, NodeId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import appCss from "../../index.css?inline";
import { ComposerThreadContext } from "./ComposerThreadContext";
import { currentRoundActivity } from "./currentRoundActivity";

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
  const trigger = screen.getByRole("button", { name: /Context 65%/ });
  await userEvent.tab();
  await userEvent.tab();
  await expect.element(trigger).toHaveFocus();
  await userEvent.keyboard("{Enter}");

  const details = page.getByRole("dialog", { name: "Round token usage" });
  await expect.element(details.getByText("≈131.7K tokens used · 65%")).toBeVisible();
  await details.getByText("Diagnostics").click();
  await expect.element(details.getByText(/historian failed/)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(details).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

it("keeps round token and cache totals separate from the current context window", async () => {
  using stack = new DisposableStack();
  const style = document.createElement("style");
  style.textContent = `${appCss}\n:root { --glass-blur: 16px; }`;
  document.head.append(style);
  stack.defer(() => style.remove());
  const startedAt = DateTime.makeUnsafe("2026-11-20T12:00:00Z");
  const runId = RunId.make("run-7");
  const providerTurnId = ProviderTurnId.make("turn-7");
  const run = {
    id: runId,
    rootNodeId: NodeId.make("run-root"),
    ordinal: 7,
    status: "completed",
    startedAt,
    workStartedAt: DateTime.add(startedAt, { seconds: 2 }),
    completedAt: DateTime.add(startedAt, { seconds: 14 }),
  } as const;
  const reply = {
    id: TurnItemId.make("reply"),
    threadId: ThreadId.make("thread"),
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt,
    completedAt: DateTime.add(startedAt, { seconds: 9 }),
    updatedAt: DateTime.add(startedAt, { seconds: 9 }),
    type: "assistant_message",
    messageId: MessageId.make("reply"),
    text: "中😀".repeat(14),
    streaming: false,
  } as const;
  const reasoning = { ...reply, id: TurnItemId.make("reasoning"), type: "reasoning" } as const;
  const tool = {
    ...reply,
    id: TurnItemId.make("tool"),
    completedAt: DateTime.add(startedAt, { seconds: 3 }),
    type: "dynamic_tool",
    toolName: "read",
    input: {},
  } as const;
  await using screen = await render(
    <ComposerThreadContext
      key="first"
      usage={deriveLatestContextWindowSnapshot([], {
        usedTokens: 42_000,
        maxTokens: 200_000,
        updatedAt: "2026-11-20T12:00:14Z",
      })}
      contextStatus="mc: 131.7K (65%) · Ready"
      run={run}
      stepCount={2}
      activity={{
        tools: { count: 2, milliseconds: 3000, timed: 2 },
        reasoning: { count: 0, milliseconds: 0, timed: 0 },
      }}
      turnUsage={{
        usageScope: "main_agent",
        usageStatus: "complete",
        hasSubagents: true,
        inputTokens: 1_000,
        outputTokens: 200,
        cachedInputTokens: 750,
        cacheCreationTokens: 100,
        reasoningTokens: 30,
      }}
    />,
  );

  const trigger = screen.getByRole("button", { name: /Round 7/ });
  const tokensTrigger = screen.getByRole("button", { name: /Cache hit 75%/ });
  for (const value of ["1,200 tokens", "Cache hit 75%", "Context 21%"]) {
    await expect.element(tokensTrigger.getByText(value, { exact: true })).toBeVisible();
  }
  for (const value of ["2 steps", "14.3 tokens/s"]) {
    await expect.element(trigger.getByText(value, { exact: true })).toBeVisible();
  }
  await userEvent.click(trigger);
  const details = page.getByRole("dialog", { name: "Overview" });
  await expect.element(details.getByText("2 · Σ 3s")).toBeVisible();
  await expect.element(details.getByText("30 tokens", { exact: true })).toBeVisible();
  await expect.element(details.getByText("Not reported", { exact: true }).first()).toBeVisible();
  await expect.element(details.getByText("14s")).toBeVisible();
  await expect.element(details.getByText("Completed")).toBeVisible();
  const overviewStyles = getComputedStyle(details.element());
  expect(overviewStyles.backdropFilter).toContain("blur(12px)");
  expect(overviewStyles.transitionProperty).not.toMatch(/all|filter/);
  await userEvent.keyboard("{Escape}");
  await userEvent.click(tokensTrigger);
  const tokensDialog = page.getByRole("dialog", { name: "Round token usage" });
  await expect.element(tokensDialog.getByText("42,000 of 200,000 tokens · 21%")).toBeVisible();
  await expect.element(tokensDialog.getByText("Round token usage")).toBeVisible();
  await expect.element(tokensDialog.getByText("750", { exact: true })).toBeVisible();
  await expect.element(tokensDialog.getByText("100", { exact: true })).toBeVisible();
  const tokenStyles = getComputedStyle(tokensDialog.element());
  expect(tokenStyles.backdropFilter).toContain("blur(12px)");
  expect(tokenStyles.transitionProperty).not.toMatch(/all|filter/);

  await screen.rerender(
    <ComposerThreadContext
      key="history"
      usage={null}
      activity={currentRoundActivity(
        run,
        [],
        [
          tool,
          reasoning,
          { ...tool, providerTurnId: ProviderTurnId.make("old") },
          { ...reasoning, parentItemId: tool.id },
        ],
        providerTurnId,
      )}
      run={run}
      stepCount={null}
      turnUsage={null}
    />,
  );
  const historyTrigger = screen.getByRole("button", { name: /Round 7/ });
  await expect.element(historyTrigger.getByText(/tokens\/s/)).not.toBeInTheDocument();
  await userEvent.click(historyTrigger);
  await expect.element(details.getByText("Reasoning", { exact: true })).toBeVisible();
  await expect.element(details.getByText("1 · Σ 9s", { exact: true })).toBeVisible();
  await expect.element(details.getByText("1 · Σ 3s", { exact: true })).toBeVisible();

  using _now = vi.spyOn(Date, "now").mockReturnValue(DateTime.toEpochMillis(startedAt) + 5000);
  const liveRun = { ...run, status: "running", completedAt: null } as const;
  await screen.rerender(
    <ComposerThreadContext
      key="live"
      usage={null}
      run={liveRun}
      stepCount={null}
      turnUsage={null}
    />,
  );
  const liveTrigger = screen.getByRole("button", { name: /Round 7/ });
  await expect.element(liveTrigger.getByText("Time to first output –")).toBeVisible();
  for (const value of ["Cache hit –", "Context –"]) {
    await expect.element(screen.getByText(value, { exact: true })).toBeVisible();
  }
  await userEvent.click(liveTrigger);
  await expect.element(details.getByText("Not reported").first()).toBeVisible();
  const firstOutputAtMs = DateTime.toEpochMillis(startedAt) + 2500;
  const firstOutput = { firstOutputAtMs, sampledDurationMs: 0, sampledCharacters: 0 };
  await screen.rerender(
    <ComposerThreadContext
      key="live"
      usage={null}
      run={liveRun}
      modelOutputTiming={firstOutput}
      stepCount={null}
      turnUsage={null}
    />,
  );
  await expect.element(details.getByText("Time to first output")).toBeVisible();
  await expect.element(details.getByText("2.5s", { exact: true })).toBeVisible();
  await expect.element(liveTrigger.getByText(/tokens\/s/)).not.toBeInTheDocument();

  const measuredOutput = { ...firstOutput, sampledDurationMs: 1500, sampledCharacters: 15 };
  await screen.rerender(
    <ComposerThreadContext
      key="live"
      usage={null}
      run={liveRun}
      modelOutputTiming={measuredOutput}
      stepCount={null}
      turnUsage={{
        usageScope: "main_agent",
        usageStatus: "partial",
        hasSubagents: false,
        outputTokens: 70,
      }}
    />,
  );
  await expect.element(liveTrigger.getByText("14 tokens/s")).toBeVisible();
  await expect.element(liveTrigger.getByText("Time to first output 2.5s")).toBeVisible();
  await expect.element(details.getByText("14 tokens/s", { exact: true })).toBeVisible();
  await expect.element(details.getByText("2.5s", { exact: true })).toBeVisible();

  await screen.rerender(
    <ComposerThreadContext
      key="live"
      usage={null}
      run={{ ...run, completedAt: DateTime.makeUnsafe(DateTime.toEpochMillis(startedAt) + 500) }}
      stepCount={null}
      turnUsage={{
        usageScope: "main_agent",
        usageStatus: "partial",
        hasSubagents: false,
        outputTokens: 70,
      }}
    />,
  );
  await expect.element(details.getByText("140 tokens/s", { exact: true })).toBeVisible();

  await screen.rerender(
    <ComposerThreadContext
      key="second"
      usage={null}
      run={{
        id: RunId.make("next"),
        ordinal: 1,
        status: "starting",
        startedAt: null,
        completedAt: null,
      }}
      activity={currentRoundActivity(run, [], [], providerTurnId)}
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
  await expect.element(details.getByText("Reasoning", { exact: true })).not.toBeInTheDocument();
  await expect.element(details.getByText("Round token usage")).not.toBeInTheDocument();
});

it("keeps horizontal layout without collapsing inside a flex-end container in compact mode", async () => {
  using stack = new DisposableStack();
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());

  const startedAt = DateTime.makeUnsafe("2026-11-20T12:00:00Z");
  const runId = RunId.make("run-5");
  const run = {
    id: runId,
    rootNodeId: NodeId.make("run-5-root"),
    ordinal: 5,
    status: "completed",
    startedAt,
    workStartedAt: DateTime.add(startedAt, { seconds: 1 }),
    completedAt: DateTime.add(startedAt, { seconds: 12 }),
  } as const;

  await using screen = await render(
    <div className="flex w-[720px] justify-end px-2 pt-2">
      <ComposerThreadContext
        compact
        usage={deriveLatestContextWindowSnapshot([], {
          usedTokens: 42_000,
          maxTokens: 200_000,
          updatedAt: "2026-11-20T12:00:12Z",
        })}
        run={run}
        stepCount={3}
        turnUsage={{
          usageScope: "main_agent",
          usageStatus: "complete",
          hasSubagents: false,
          inputTokens: 350_000,
          outputTokens: 5_933,
          cachedInputTokens: 262_500,
        }}
      />
    </div>,
  );

  const roundTrigger = screen.getByRole("button", { name: /Round 5/ });
  const tokensTrigger = screen.getByRole("button", { name: /Cache hit 75%/ });
  await expect.element(roundTrigger).toBeVisible();
  await expect.element(tokensTrigger.getByText("355,933 tokens", { exact: true })).toBeVisible();
  await expect.element(tokensTrigger.getByText("Context 21%", { exact: true })).toBeVisible();

  const footer = roundTrigger.element().closest("[data-session-footer]");
  expect(footer).toBeInstanceOf(HTMLElement);
  const footerRect = (footer as HTMLElement).getBoundingClientRect();
  const roundRect = roundTrigger.element().getBoundingClientRect();
  const tokensRect = tokensTrigger.element().getBoundingClientRect();

  expect(footerRect.width).toBeGreaterThan(200);
  expect(footerRect.height).toBeLessThanOrEqual(36);
  expect(Math.abs(roundRect.top - tokensRect.top)).toBeLessThan(8);
});

import { RegistryContext } from "@effect/atom-react";
import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import {
  MessageId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
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
  const runId = RunId.make("run-7");
  const providerTurnId = ProviderTurnId.make("turn-7");
  const run = {
    id: runId,
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
  const turnItemsAtom = Atom.make<readonly OrchestrationV2TurnItem[]>([
    reply,
    { ...reply, id: TurnItemId.make("earlier"), runId: RunId.make("run-6") },
    { ...reply, id: TurnItemId.make("child"), parentItemId: reply.id },
    {
      ...reply,
      id: TurnItemId.make("previous-attempt"),
      providerTurnId: ProviderTurnId.make("old"),
    },
    { ...reply, id: TurnItemId.make("reasoning"), type: "reasoning" },
  ]);
  await using screen = await render(
    <ComposerThreadContext
      key="first"
      usage={deriveLatestContextWindowSnapshot([], {
        usedTokens: 42_000,
        maxTokens: 200_000,
        updatedAt: "2026-11-20T12:00:14Z",
      })}
      run={run}
      providerTurnId={providerTurnId}
      turnItemsAtom={turnItemsAtom}
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
  for (const value of ["3 steps", "· 14.3 tok/s", "1,200 tokens", "Cache 75%"]) {
    await expect.element(trigger.getByText(value, { exact: true })).toBeVisible();
  }
  await userEvent.click(trigger);
  const details = page.getByRole("dialog", { name: "Overview" });
  await expect.element(details.getByText("2 · Σ 3s")).toBeVisible();
  await expect.element(details.getByText("14.3 tok/s", { exact: true })).toBeVisible();
  await expect.element(details.getByText("14s")).toBeVisible();
  await expect
    .element(details.getByText("End-to-end average, including tools and waiting."))
    .toBeVisible();
  await expect.element(details.getByText("Completed")).toBeVisible();
  await expect.element(details.getByText("42,000 of 200,000 tokens · 21%")).toBeVisible();
  await expect.element(details.getByText("Round token usage")).toBeVisible();
  await expect.element(details.getByText("750", { exact: true })).toBeVisible();
  await expect.element(details.getByText("100", { exact: true })).toBeVisible();

  await screen.rerender(
    <ComposerThreadContext
      key="history"
      usage={null}
      run={run}
      providerTurnId={providerTurnId}
      turnItemsAtom={turnItemsAtom}
      stepCount={null}
      turnUsage={null}
    />,
  );
  const historyTrigger = screen.getByRole("button", { name: /Round 7/ });
  await expect.element(historyTrigger.getByText("· 2 chars/s", { exact: true })).toBeVisible();
  await userEvent.click(historyTrigger);
  await expect.element(details.getByText("2 chars/s", { exact: true })).toBeVisible();

  const registry = AtomRegistry.make();
  using _now = vi.spyOn(Date, "now").mockReturnValue(DateTime.toEpochMillis(run.completedAt));
  const liveRun = { ...run, status: "running", completedAt: null } as const;
  registry.set(turnItemsAtom, []);
  await screen.rerender(
    <RegistryContext.Provider value={registry}>
      <ComposerThreadContext
        key="live"
        usage={null}
        run={liveRun}
        providerTurnId={providerTurnId}
        turnItemsAtom={turnItemsAtom}
        stepCount={null}
        turnUsage={null}
      />
    </RegistryContext.Provider>,
  );
  const liveTrigger = screen.getByRole("button", { name: /Round 7/ });
  await userEvent.click(liveTrigger);
  await expect.element(details.getByText("Not reported").first()).toBeVisible();
  await act(() => registry.set(turnItemsAtom, [{ ...reply, streaming: true }]));
  await expect.element(liveTrigger.getByText("· 2 chars/s", { exact: true })).toBeVisible();
  await expect.element(details.getByText("2 chars/s", { exact: true })).toBeVisible();

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

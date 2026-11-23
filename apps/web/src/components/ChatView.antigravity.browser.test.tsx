import { createMemoryHistory } from "@tanstack/react-router";
import {
  NodeId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnItemId,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startI18n, whenLocaleReady } from "~/i18n/runtime";
import "~/index.css";
import { getRouter } from "~/router";
import {
  assistantItem,
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  emitThreadEvent,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
// Preload the lazy route before the test timeout starts.
import "./ChatView";

// Keep the real chat route, projection store, and composer; replace only the socket.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it("shows Antigravity tool activity, reported tasks, and whole-round statistics around the composer", async () => {
  const antigravityId = ProviderInstanceId.make("local-antigravity");
  const antigravity = {
    ...CODEX_PROVIDER,
    instanceId: antigravityId,
    driver: ProviderDriverKind.make("antigravity"),
  };
  const thread = threadWithHistory("antigravity-task-trail", 1, {
    instanceId: antigravityId,
    model: "antigravity-default",
  });
  const startedAt = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
  const completedAt = DateTime.makeUnsafe("2026-03-17T19:12:38.000Z");
  const run = { ...thread.runs[0]!, startedAt, completedAt };
  const reply = assistantItem(thread.id, run.id, "antigravity-answer", 4, "答🙂 text");
  const { messageId: _messageId, text: _text, streaming: _streaming, ...base } = reply;
  const tool = {
    ...base,
    id: TurnItemId.make("antigravity-call"),
    type: "command_execution",
    title: "Read workspace",
    input: "ls",
    ordinal: 2,
  } satisfies OrchestrationV2TurnItem;
  const secondTool = {
    ...tool,
    id: TurnItemId.make("antigravity-second-call"),
    input: "ls src",
    ordinal: 3,
  };
  using _environment = installFakeEnvironment(
    [{ ...thread, runs: [run], items: [thread.items[0]!, tool, secondTool, reply] }],
    { providers: [antigravity] },
  );
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  startI18n();
  await whenLocaleReady();
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await page.viewport(360, 760);
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  const stats = page.getByRole("button", { name: /Round 1.*0\.7 chars\/s/ });
  await expect.element(stats).toBeVisible();
  expect(stats.element().closest("form")).toBeNull();
  await stats.click();
  await expect.element(page.getByText("Overview", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Tool calls", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  const summary = page.getByRole("region", { name: "Task progress" });
  await summary.getByRole("button", { name: /Completed/ }).click();
  await summary.getByRole("button", { name: /Inspect & search workspace/ }).click();
  await expect.element(summary.getByText("ls src", { exact: true })).toBeVisible();

  const plan = {
    kind: "todo_list",
    id: PlanId.make("acp-reported-plan"),
    threadId: thread.id,
    runId: run.id,
    nodeId: NodeId.make("antigravity-plan-node"),
    status: "active",
    steps: [
      { id: "check", text: "Check the rendered view", status: "running" },
      { id: "ship", text: "Package the result", status: "pending" },
    ],
  } satisfies OrchestrationV2PlanArtifact;
  await emitThreadEvent(thread.id, { type: "plan.updated", payload: plan });
  await emitThreadEvent(thread.id, {
    type: "turn-item.updated",
    payload: {
      ...base,
      type: "todo_list",
      id: TurnItemId.make("acp-plan-mirror"),
      nodeId: plan.nodeId,
      ordinal: 5,
      planId: plan.id,
      steps: [{ id: "old", text: "Stale mirrored step", status: "pending" }],
    },
  });
  const trigger = summary.getByRole("button", { name: /Check the rendered view.*0\/2/ });
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(page.getByText("Stale mirrored step", { exact: true }))
    .not.toBeInTheDocument();
  await trigger.click();
  const list = summary.getByRole("list", { name: "Reported task steps" });
  await expect.element(list.getByText("Package the result")).toBeVisible();
  const bounds = summary.element().getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(360);
  await userEvent.keyboard("{Escape}");
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
});

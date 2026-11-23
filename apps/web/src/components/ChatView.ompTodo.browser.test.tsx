import { createMemoryHistory } from "@tanstack/react-router";
import {
  NodeId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  TurnItemId,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2ProviderThread,
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
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  emitThreadEvent,
  installFakeEnvironment,
  isThreadSubscribed,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
// Preload the lazy route before the test timeout starts.
import "./ChatView";
import { extensionStatusBannerItem } from "./chat/ThreadActivityBanners";

// Keep the real chat route, projection store, and composer; replace only the socket.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

const instanceId = ProviderInstanceId.make("local-omp");
const driver = ProviderDriverKind.make("omp");
const provider = { ...CODEX_PROVIDER, instanceId, driver };
const modelSelection = { instanceId, model: "gpt-5.4" };

it("shows OMP tool intent in the floating capsule and folds calls into overall todo stages", async () => {
  const thread = threadWithHistory("omp-todo-footer", 1, modelSelection);
  const other = threadWithHistory("omp-todo-neighbor", 1, modelSelection);
  const at = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
  const activeRun = {
    ...thread.runs[0]!,
    status: "running" as const,
    startedAt: at,
    completedAt: null,
  };
  const providerThread: OrchestrationV2ProviderThread = {
    id: ProviderThreadId.make("provider-thread-omp-todo"),
    driver,
    providerInstanceId: instanceId,
    providerSessionId: null,
    appThreadId: thread.id,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    contextUsage: { usedTokens: 24_600, maxTokens: 100_000 },
    createdAt: at,
    updatedAt: at,
  };
  const planId = PlanId.make(`omp-todo:${thread.id}`);
  const itemBase = {
    threadId: thread.id,
    runId: activeRun.id,
    nodeId: NodeId.make("omp-todo-node"),
    providerThreadId: providerThread.id,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
  const firstSnapshot = {
    ...itemBase,
    id: TurnItemId.make("omp-todo-update-1"),
    type: "todo_list",
    ordinal: 2,
    status: "completed",
    planId,
    steps: [
      { id: "first", text: "校对仪表盘\n检查桌面布局", status: "running" },
      { id: "second", text: "检查窄屏显示", status: "pending" },
      { id: "dropped", text: "已放弃的任务\n[abandoned]", status: "pending" },
    ],
  } satisfies OrchestrationV2TurnItem;
  const firstCall = {
    ...itemBase,
    id: TurnItemId.make("omp-call-1"),
    type: "command_execution",
    ordinal: 3,
    status: "completed",
    title: "bash",
    toolPurpose: "检索用量页样式文件",
    input: "rg usagePresentation apps/web/src",
  } satisfies OrchestrationV2TurnItem;
  const secondSnapshot = {
    ...firstSnapshot,
    id: TurnItemId.make("omp-todo-update-2"),
    ordinal: 4,
    steps: [
      { id: "first", text: "校对仪表盘\n检查桌面布局", status: "completed" },
      { id: "second", text: "检查窄屏显示", status: "running" },
      { id: "dropped", text: "已放弃的任务\n[abandoned]", status: "pending" },
    ],
  } satisfies OrchestrationV2TurnItem;
  const liveCall = {
    ...itemBase,
    id: TurnItemId.make("omp-call-2"),
    type: "file_change",
    ordinal: 5,
    status: "running",
    completedAt: null,
    fileName: "apps/web/src/components/usage/costTokensV9.css",
    toolPurpose: "适配主题卡片变量",
  } satisfies OrchestrationV2TurnItem;
  using _environment = installFakeEnvironment(
    [
      {
        ...thread,
        runs: [activeRun],
        providerThreads: [providerThread],
        items: [thread.items[0]!, firstSnapshot, firstCall, secondSnapshot, liveCall],
      },
      other,
    ],
    { providers: [provider] },
  );
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "zh",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  startI18n();
  await whenLocaleReady();
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await page.viewport(1280, 800);
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });

  const status = page.getByRole("button", { name: /上下文 25%/ });
  await expect.element(status).toBeVisible();
  expect(status.element().closest("form")).toBeNull();
  await status.click();
  await expect.element(page.getByText(/24,600.*100,000|100,000.*24,600/)).toBeVisible();
  await userEvent.keyboard("{Escape}");

  // Before an overall todo plan arrives, OMP's live tool intent still renders in the floating capsule.
  const capsule = page.getByRole("region", { name: "任务进度" });
  await expect.element(capsule.getByRole("button", { name: /适配主题卡片变量/ })).toBeVisible();

  const plan: OrchestrationV2PlanArtifact = {
    kind: "todo_list",
    id: planId,
    threadId: thread.id,
    runId: activeRun.id,
    nodeId: NodeId.make("omp-todo-node"),
    status: "active",
    steps: secondSnapshot.steps,
  };
  // Neighbor thread's omp-todo plan must stay isolated from this thread.
  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: {
      ...plan,
      id: PlanId.make(`omp-todo:${other.id}`),
      steps: [{ id: "neighbor", text: "相邻会话的待办快照", status: "running" }],
    },
  });
  await emitThreadEvent(thread.id, { type: "plan.updated", payload: plan });
  await expect.element(page.getByText("相邻会话的待办快照")).not.toBeInTheDocument();
  expect(document.querySelector("[data-omp-todo]")).toBeNull();

  // Collapsed bar displays live tool intent alongside overall todo counter (1/2).
  const trigger = capsule.getByRole("button", { name: /适配主题卡片变量.*1\/2/ });
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  expect(capsule.element().closest('[data-chat-composer-stack="true"]')).not.toBeNull();
  expect(capsule.element().closest(".messages-timeline-scroll")).toBeNull();

  // Opening reveals the overall todo stages with tool intents folded under each stage.
  await trigger.click();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  const stages = capsule.getByRole("list");
  await expect.element(stages.getByText("校对仪表盘")).toBeVisible();
  await expect.element(stages.getByText("检查窄屏显示")).toBeVisible();
  await expect.element(stages.getByText("已放弃的任务")).not.toBeInTheDocument();

  await stages.getByRole("button", { name: /校对仪表盘/ }).click();
  await expect.element(stages.getByText("检索用量页样式文件", { exact: true })).toBeVisible();

  await stages.getByRole("button", { name: /检查窄屏显示/ }).click();
  await expect.element(stages.getByText("适配主题卡片变量", { exact: true })).toBeVisible();

  await page.viewport(360, 760);
  const bounds = capsule.element().getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(360);

  await userEvent.keyboard("{Escape}");
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");

  // Switching to a neighbor thread with no activity hides this thread's capsule.
  await router.navigate({ to: `/${ENVIRONMENT_ID}/${other.id}` });
  await vi.waitFor(() => expect(isThreadSubscribed(other.id)).toBe(true));
  await expect.element(capsule).not.toBeInTheDocument();
  await page.viewport(1280, 800);
});

it("hides only known idle OMP chatter and retains meaningful extension status", () => {
  const idle = [
    { key: "magic-context", text: "mc: 142.4K (70%) · idle" },
    { key: "bansos", text: "中继: 关闭" },
  ];
  expect(extensionStatusBannerItem(idle, true)).toBeNull();
  expect(extensionStatusBannerItem(idle, false)).not.toBeNull();
  expect(
    extensionStatusBannerItem(
      [{ key: "magic-context", text: "mc: 131.7K (65%) · ⚠ historian failed" }],
      true,
    ),
  ).toBeNull();
  for (const status of [
    { key: "bansos", text: "中继: 连接失败" },
    { key: "unified-exec.sessions", text: "unified-exec：1 个会话正在运行" },
  ]) {
    expect(extensionStatusBannerItem([...idle, status], true)).not.toBeNull();
  }
});

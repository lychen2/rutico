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

it("keeps one current OMP checklist immediately above the composer, outside message history", async () => {
  const thread = threadWithHistory("omp-todo-footer", 1, modelSelection);
  const other = threadWithHistory("omp-todo-neighbor", 1, modelSelection);
  const at = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
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
  using _environment = installFakeEnvironment(
    [{ ...thread, providerThreads: [providerThread] }, other],
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

  const checklist = page.getByRole("region", { name: "待办清单" });
  const trigger = checklist.getByRole("button", { name: /^待办清单/ });
  const steps = checklist.getByRole("list");
  const status = page.getByRole("button", { name: /^(上下文|第.*轮)/ });
  await expect.element(status).toBeVisible();
  expect(status.element().closest("form")).toBeNull();
  await status.click();
  await expect.element(page.getByText(/24,600.*100,000|100,000.*24,600/)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(checklist).not.toBeInTheDocument();

  const plan: OrchestrationV2PlanArtifact = {
    kind: "todo_list",
    id: PlanId.make(`omp-todo:${thread.id}`),
    threadId: thread.id,
    runId: thread.runs[0]!.id,
    nodeId: NodeId.make("omp-todo-node"),
    status: "active",
    steps: [
      { id: "first", text: "校对仪表盘\n检查桌面布局", status: "running" },
      { id: "second", text: "检查窄屏显示", status: "pending" },
      { id: "third", text: "打包\n[blocked] 等待验收", status: "pending" },
      { id: "dropped", text: "已放弃的任务\n[abandoned]", status: "pending" },
    ],
  };
  const mirroredSnapshot = {
    id: TurnItemId.make("omp-todo-update"),
    type: "todo_list",
    threadId: thread.id,
    runId: plan.runId,
    nodeId: plan.nodeId,
    providerThreadId: providerThread.id,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 2,
    status: "completed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    planId: plan.id,
    steps: [{ id: "old", text: "旧 OMP 待办快照", status: "running" }],
  } satisfies OrchestrationV2TurnItem;
  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: {
      ...plan,
      id: PlanId.make(`omp-todo:${other.id}`),
      steps: [{ id: "neighbor", text: "相邻会话的待办快照", status: "running" }],
    },
  });
  await emitThreadEvent(thread.id, { type: "plan.updated", payload: plan });
  await emitThreadEvent(thread.id, { type: "turn-item.updated", payload: mirroredSnapshot });
  await emitThreadEvent(thread.id, {
    type: "turn-item.updated",
    payload: {
      ...mirroredSnapshot,
      id: TurnItemId.make("different-todo-update"),
      ordinal: 3,
      planId: PlanId.make("other-provider-plan"),
      steps: [{ id: "other", text: "其他提供方的任务", status: "running" }],
    },
  });
  await page.getByText(/^工作了/).click();
  await expect.element(page.getByText(/其他提供方的任务/)).toBeVisible();
  await expect
    .element(page.getByText(/旧 OMP 待办快照|相邻会话的待办快照/))
    .not.toBeInTheDocument();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await expect.element(trigger.getByText(/校对仪表盘/)).toBeVisible();
  await expect.element(trigger.getByText("0/3", { exact: true })).toBeVisible();
  expect(checklist.element().closest('[data-chat-composer-overlay="true"]')).not.toBeNull();
  expect(checklist.element().closest(".messages-timeline-scroll")).toBeNull();
  await expect.element(steps).not.toBeInTheDocument();
  await trigger.click();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  await expect.element(steps.getByText("检查桌面布局", { exact: true })).toBeVisible();
  await expect.element(steps.getByText("等待验收", { exact: true })).toBeVisible();
  await expect.element(steps.getByText("已阻塞", { exact: true })).toBeVisible();
  await expect.element(steps.getByText("待处理", { exact: true })).toBeVisible();
  await expect.element(steps.getByText("已放弃的任务")).not.toBeInTheDocument();

  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: {
      ...plan,
      steps: plan.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? "completed" : index === 1 ? "running" : step.status,
      })),
    },
  });
  await expect.element(trigger.getByText(/检查窄屏显示/)).toBeVisible();
  await expect.element(trigger.getByText("1/3", { exact: true })).toBeVisible();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  await expect
    .element(steps.getByRole("listitem").filter({ hasText: "检查窄屏显示" }).getByText("进行中"))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await expect.element(steps).not.toBeInTheDocument();

  await page.viewport(360, 760);
  await trigger.click();
  await expect.element(steps).toBeVisible();
  const bounds = checklist.element().getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(360);
  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: {
      ...plan,
      steps: plan.steps.slice(0, 3).map((step) => ({ ...step, status: "completed" })),
    },
  });
  await expect.element(trigger.getByText("已完成", { exact: true })).toBeVisible();
  await expect.element(trigger.getByText("3/3", { exact: true })).toBeVisible();

  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: { ...plan, status: "completed", steps: [] },
  });
  await expect.element(checklist).not.toBeInTheDocument();
  await expect.element(page.getByText(/旧 OMP 待办快照/)).not.toBeInTheDocument();
  await page.viewport(1280, 800);
  await expect.element(status).toBeVisible();
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

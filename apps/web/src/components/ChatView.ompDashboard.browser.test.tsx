import { createMemoryHistory } from "@tanstack/react-router";
import {
  NodeId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2ProviderThread,
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

it("updates the open Chinese checklist from native OMP plan events in the current composer", async () => {
  const thread = threadWithHistory("omp-dashboard", 1, modelSelection);
  const other = threadWithHistory("omp-dashboard-neighbor", 1, modelSelection);
  const at = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
  const providerThread: OrchestrationV2ProviderThread = {
    id: ProviderThreadId.make("provider-thread-dashboard"),
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
  await using _app = await render(<AppRoot router={router} />, { router: false });

  await expect
    .element(page.getByText("暂无待办", { exact: true }), { timeout: 3000 })
    .toBeVisible();
  await expect
    .element(page.getByText("已使用 24,600 token", { exact: true }), { timeout: 1500 })
    .toBeVisible();
  await expect
    .element(page.getByText("已使用 25%", { exact: true }), { timeout: 1500 })
    .toBeVisible();

  const plan: OrchestrationV2PlanArtifact = {
    kind: "todo_list",
    id: PlanId.make(`omp-todo:${thread.id}`),
    threadId: thread.id,
    runId: null,
    nodeId: NodeId.make("omp-todo-dashboard"),
    status: "active",
    steps: [
      { id: "first", text: "校对仪表盘\n检查桌面布局", status: "running" },
      { id: "second", text: "检查窄屏显示", status: "pending" },
      { id: "third", text: "打包\n[blocked] 等待验收", status: "pending" },
      { id: "dropped", text: "已放弃的任务\n[abandoned]", status: "pending" },
    ],
  };
  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: { ...plan, id: PlanId.make(`omp-todo:${other.id}`) },
  });
  await emitThreadEvent(thread.id, { type: "plan.updated", payload: plan });
  const trigger = page.getByRole("button", { name: /待办清单 已完成 0\/3 校对仪表盘/ });
  await expect.element(trigger, { timeout: 1500 }).toBeVisible();
  await trigger.click();
  const checklist = page.getByRole("dialog", { name: "待办清单" });
  await expect
    .element(checklist.getByText("检查桌面布局", { exact: true }), { timeout: 1500 })
    .toBeVisible();
  await expect.element(checklist.getByText("等待验收", { exact: true })).toBeVisible();
  await expect.element(checklist.getByText("已放弃的任务")).not.toBeInTheDocument();

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
  await expect.element(checklist.getByText("已完成 1/3", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(checklist).not.toBeInTheDocument();

  await page.viewport(360, 760);
  const narrowTrigger = page.getByRole("button", { name: /待办清单 已完成 1\/3 检查窄屏显示/ });
  await expect.element(narrowTrigger).toBeVisible();
  await narrowTrigger.click();
  await expect.element(checklist.getByText("进行中", { exact: true })).toBeVisible();
  const popup = checklist.element().getBoundingClientRect();
  expect(popup.left).toBeGreaterThanOrEqual(0);
  expect(popup.right).toBeLessThanOrEqual(360);
  expect(popup.bottom).toBeLessThanOrEqual(760);

  await emitThreadEvent(thread.id, {
    type: "plan.updated",
    payload: { ...plan, status: "completed", steps: [] },
  });
  await expect.element(page.getByText("暂无待办", { exact: true })).toBeVisible();
  await expect.element(checklist).not.toBeInTheDocument();
});

it("hides only known idle OMP chatter and retains meaningful extension status", () => {
  const idle = [
    { key: "magic-context", text: "mc: 142.4K (70%) · idle" },
    { key: "bansos", text: "中继: 关闭" },
  ];
  expect(extensionStatusBannerItem(idle, true)).toBeNull();
  expect(extensionStatusBannerItem(idle, false)).not.toBeNull();
  for (const status of [
    { key: "magic-context", text: "mc: 241K (28%) · historian" },
    { key: "bansos", text: "中继: 连接失败" },
    { key: "unified-exec.sessions", text: "unified-exec：1 个会话正在运行" },
  ]) {
    expect(extensionStatusBannerItem([...idle, status], true)).not.toBeNull();
  }
});

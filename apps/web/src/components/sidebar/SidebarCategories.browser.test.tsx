import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { LocalApi } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import appCss from "../../index.css?inline";
import * as localApi from "../../localApi";
import { useProjects, useQuietThreadShells, useServerConfigs } from "../../state/entities";
import { makeThreadFixture } from "../../test-fixtures";
import type { Project } from "../../types";
import Sidebar from "../Sidebar";
import { SidebarProvider } from "../ui/sidebar";
import { SIDEBAR_CATEGORIES_STORAGE_KEY } from "./SidebarCategories";

vi.mock("../../state/entities", { spy: true });
vi.mock("../../hooks/useHandleNewThread", { spy: true });
vi.mock("../../hooks/useThreadRouteTarget", { spy: true });
vi.mock("../../localApi", { spy: true });
vi.mock("./SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

it("files loaded old and new threads without overriding a saved manual choice in either environment", async () => {
  using stack = new DisposableStack();
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());
  const saved = localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
  stack.defer(() => {
    if (saved === null) localStorage.removeItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
    else localStorage.setItem(SIDEBAR_CATEGORIES_STORAGE_KEY, saved);
  });
  localStorage.setItem(
    SIDEBAR_CATEGORIES_STORAGE_KEY,
    JSON.stringify({
      categories: [{ id: "release", name: "Release work" }],
      assignments: {},
      collapsed: [],
    }),
  );
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote");
  const projectId = ProjectId.make("shared-project-id");
  const threadId = ThreadId.make("shared-thread-id");
  const commonProject = {
    id: projectId,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  } satisfies Omit<Project, "environmentId" | "title" | "workspaceRoot">;
  vi.mocked(useProjects).mockReturnValue([
    { ...commonProject, environmentId: local, title: "公司管理", workspaceRoot: "/projects/local" },
    { ...commonProject, environmentId: remote, title: "交易", workspaceRoot: "/projects/remote" },
  ]);
  const config = {
    scratchWorkspaceRoot: null,
    shellThreadFamilies: false,
    environment: { capabilities: {} },
  } as unknown as EnvironmentServerConfig;
  vi.mocked(useServerConfigs).mockReturnValue(
    new Map([
      [local, config],
      [remote, config],
    ]),
  );
  const older = {
    id: threadId,
    projectId,
    settledOverride: "settled",
    settledAt: "2026-01-02T00:00:00.000Z",
  } as const;
  const localOld = makeThreadFixture({ ...older, environmentId: local, title: "本地旧会话" });
  const remoteOld = makeThreadFixture({ ...older, environmentId: remote, title: "远端旧会话" });
  vi.mocked(useQuietThreadShells).mockReturnValue([localOld, remoteOld]);
  const threadRef = scopeThreadRef(local, threadId);
  vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef });
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn(),
    routeDraftId: null,
    routeThreadRef: threadRef,
  });
  const show = vi.fn<LocalApi["contextMenu"]["show"]>().mockResolvedValue("move-to-category");
  using _api = vi.spyOn(localApi, "readLocalApi").mockReturnValue({
    contextMenu: { show },
  } as unknown as LocalApi);
  const tree = () => (
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>
  );
  const expectParent = async (title: string, parent: string) => {
    const label = page.getByText(title, { exact: true }).first();
    await expect.element(label).toBeVisible();
    const row = label.element().closest("[data-sidebar-row]");
    expect(row?.getAttribute("data-sidebar-parent")).toBe(parent);
  };
  const move = page.getByRole("dialog", { name: "Move to category" });
  const renamedTitle = "公众号重写后的标题";
  const newThread = makeThreadFixture({
    environmentId: local,
    projectId,
    title: "Claude 视频抖音发布",
  });
  {
    await using screen = await render(tree());
    await expectParent(localOld.title, "category:company");
    await expectParent(remoteOld.title, "category:invest");
    await userEvent.click(screen.getByText(localOld.title, { exact: true }).first(), {
      button: "right",
    });
    await expect
      .element(move.getByRole("button", { name: "Company operations" }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(move.getByRole("button", { name: "Uncategorized" }));
    await expect.element(move).not.toBeInTheDocument();
    vi.mocked(useQuietThreadShells).mockReturnValue([
      makeThreadFixture({ ...older, environmentId: local, title: renamedTitle }),
      remoteOld,
      newThread,
    ]);
  }
  await using restored = await render(tree());
  await expectParent(renamedTitle, "shelf:settled");
  await expectParent(remoteOld.title, "category:invest");
  await expectParent(newThread.title, "category:douyin-other");
  const localRow = restored.getByText(renamedTitle, { exact: true }).first();
  await userEvent.click(localRow, { button: "right" });
  await expect
    .element(move.getByRole("button", { name: "Uncategorized" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.click(move.getByRole("button", { name: "Release work" }));
  await expectParent(renamedTitle, "category:release");
  await userEvent.click(localRow, { button: "right" });
  await userEvent.click(move.getByRole("button", { name: "Restore automatic categorization" }));
  await expectParent(renamedTitle, "category:wechat");
  await expectParent(remoteOld.title, "category:invest");
});

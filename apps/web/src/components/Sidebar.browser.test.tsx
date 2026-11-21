import appCss from "../index.css?inline";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as shelfHooks from "../state/olderSettledShelf";
import { createWorkspaceFocusController, workspaceAreaProps } from "../lib/workspaceFocus";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type LocalApi,
  ProjectId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { makeThreadFixture } from "../test-fixtures";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useProjects, useServerConfigs, useQuietThreadShells } from "../state/entities";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { readLocalApi } from "../localApi";
import * as localApi from "../localApi";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS } from "./Sidebar.logic";
import { SIDEBAR_REDUCED_MOTION } from "./Sidebar.motion";
import { SIDEBAR_CATEGORIES_STORAGE_KEY } from "./sidebar/SidebarCategories";
import { SidebarOverview } from "./sidebar/SidebarOverview";
import { SortableThreadRow } from "./sidebar/SidebarThreadRow";
import { SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

vi.mock(import("../state/olderSettledShelf"), async (original) => {
  const actual = await original();
  return { ...actual, useOlderSettledShelf: vi.fn(actual.useOlderSettledShelf) };
});
vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useNowMinute", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("./sidebar/SidebarThreadRow", { spy: true });
vi.mock("../state/session", { spy: true });
vi.mock("../state/use-orchestration-command", { spy: true });
vi.mock("../localApi", { spy: true });
vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  // The desktop defaults: holding Mod alone already matches a thread jump.
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+1", command: "thread.jump.1" },
    { key: "mod+2", command: "thread.jump.2" },
    { key: "mod+shift+[", command: "thread.previous" },
  ]);
  return { ...(await original()), primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      defaultProjectFallbackReady: true,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

// regression: #38623 unsent drafts are listed above threads but mod+1..9 skipped them
describe("sidebar numbered jumps", () => {
  it("numbers the unsent draft at the top before the threads below it", async () => {
    const initial = useComposerDraftStore.getState();
    using stack = new DisposableStack();
    stack.defer(() => useComposerDraftStore.setState(initial, true));
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const web = project("web");
    vi.mocked(useProjects).mockReturnValue([web]);
    const thread = threadShell(web.id, 0);
    vi.mocked(useQuietThreadShells).mockReturnValue([thread]);
    const threadRef = scopeThreadRef(thread.environmentId, thread.id);
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
    const draftId = DraftId.make("unsent-draft");
    initial.setProjectDraftThreadId(scopeProjectRef(web.environmentId, web.id), draftId, {
      threadId: ThreadId.make("unsent-draft-thread"),
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    initial.setPrompt(draftId, "Unsent prompt");

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const draftRow = screen.getByTestId("sidebar-draft-row");
    await expect.element(draftRow).toBeInTheDocument();
    await expect.element(screen.getByText("Thread 0").first()).toBeInTheDocument();
    await userEvent.keyboard("{Control>}");
    await expect.element(screen.getByText("Ctrl+1")).toBeVisible();
    await expect.element(draftRow.getByText("Ctrl+1")).toBeVisible();
    await expect.element(screen.getByText("Ctrl+2")).toBeVisible();
    await userEvent.keyboard("{/Control}");

    // Previous thread from the open thread steps up to the draft above it.
    await userEvent.keyboard("{Control>}{Shift>}{BracketLeft}{/Shift}{/Control}");
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).toBe(`/draft/${draftId}`),
    );
    await userEvent.keyboard("{Control>}2{/Control}");
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).not.toBe(`/draft/${draftId}`),
    );
    await userEvent.keyboard("{Control>}1{/Control}");
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).toBe(`/draft/${draftId}`),
    );
  });
});

function threadShell(projectId: ProjectId, index: number): EnvironmentThreadShell {
  return makeThreadFixture({
    environmentId: EnvironmentId.make("local"),
    id: ThreadId.make(`thread-${index}`),
    projectId,
    title: `Thread ${index}`,
  });
}

function pauseSidebarAnimations() {
  const animate = Element.prototype.animate;
  return vi.spyOn(Element.prototype, "animate").mockImplementation(function (
    this: Element,
    frames,
    options,
  ) {
    const animation = animate.call(this, frames, options);
    animation.pause();
    return animation;
  });
}

it("expands the only running section and opens a pending remote child without routing to its parent", async () => {
  const group = project("overview-test");
  const parent = threadShell(group.id, 0);
  const child = makeThreadFixture({
    environmentId: EnvironmentId.make("remote"),
    projectId: group.id,
    id: ThreadId.make("overview-child"),
    title: "Approval for child work",
    delegatedFrom: { ...scopeThreadRef(parent.environmentId, parent.id), title: parent.title },
    hasPendingApprovals: true,
  });
  const parentRef = scopeThreadRef(parent.environmentId, parent.id);
  const earlier = [1, 2, 3].map((index) => ({
    ...threadShell(group.id, index),
    createdAt: "2025-12-01T00:00:00.000Z",
    hasPendingUserInput: true,
  }));
  vi.mocked(useProjects).mockReturnValue([group]);
  vi.mocked(useQuietThreadShells).mockReturnValue([...earlier, parent, child]);
  vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: parentRef });
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: scopeProjectRef(group.environmentId, group.id),
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn(),
    routeDraftId: null,
    routeThreadRef: parentRef,
  });
  await using screen = await render(
    <SidebarProvider>
      <style>{appCss}</style>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
    { router: `/${parent.environmentId}/${parent.id}` },
  );
  const running = screen.getByRole("region", { name: "Running now" });
  expect(running.elements()).toHaveLength(1);
  await expect.element(screen.getByRole("button", { name: /^Running\b/ })).not.toBeInTheDocument();
  await expect
    .element(running.getByRole("button", { name: /Approval for child work/ }))
    .not.toBeInTheDocument();
  using _animations = pauseSidebarAnimations();
  await userEvent.click(running.getByRole("button", { name: /Show all 5 running tasks/ }));
  await expect
    .element(running.getByRole("button", { name: /Approval for child work.*Needs approval/ }))
    .toBeVisible();
  const childButton = running.getByRole("button", {
    name: /Approval for child work.*Needs approval/,
  });
  const entry = childButton.element().closest("ul")?.closest("li")?.getAnimations()[0];
  expect(entry?.effect?.getTiming()).toMatchObject({ duration: 150, iterations: 1 });
  entry?.finish();
  const subtasks = running.getByRole("button", { name: `Subtasks of ${parent.title}` });
  await userEvent.click(subtasks);
  await expect.element(subtasks).toHaveAttribute("aria-expanded", "false");
  await expect.element(childButton).not.toBeInTheDocument();
  const ghost = running.element().querySelector<HTMLElement>("[data-sidebar-motion-exit]");
  expect(ghost?.inert).toBe(true);
  expect(ghost?.textContent).toContain(child.title);
  await userEvent.click(subtasks);
  await expect.element(childButton).toBeVisible();
  expect(ghost?.isConnected).toBe(false);
  const attention = screen.getByRole("region", { name: "Needs my attention" });
  await userEvent.click(attention.getByRole("button", { name: /Needs approval/ }));
  await vi.waitFor(() => {
    expect(screen.router!.state.location.pathname).toBe(`/${child.environmentId}/${child.id}`);
  });
});

it("bounces changed overview counts once and cancels Attention exits with reduced motion", async () => {
  const matchMedia = window.matchMedia.bind(window);
  const preference = matchMedia(SIDEBAR_REDUCED_MOTION);
  using matches = vi.spyOn(preference, "matches", "get").mockReturnValue(false);
  using _query = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      query === SIDEBAR_REDUCED_MOTION ? preference : matchMedia(query),
    );
  const group = project("overview-motion");
  const threads = Array.from({ length: 6 }, (_, index) => ({
    ...threadShell(group.id, index),
    hasPendingApprovals: true,
  }));
  const view = (items: readonly EnvironmentThreadShell[]) => (
    <TooltipProvider>
      <SidebarOverview
        threads={items}
        activeKey={null}
        now="2026-01-01T00:00:00.000Z"
        providers={new Map()}
        projectNames={new Map()}
        onNavigate={vi.fn()}
      />
    </TooltipProvider>
  );
  await using screen = await render(view(threads), { router: false }); // This case drives live list updates without navigating.
  using animations = pauseSidebarAnimations();
  const attention = screen.getByRole("region", { name: "Needs my attention" });
  const overflow = attention.getByRole("button", { name: /Thread 5/ });
  await userEvent.click(attention.getByRole("button", { name: "Show 1 more" }));
  await expect.element(overflow).toBeVisible();
  await userEvent.click(attention.getByRole("button", { name: "Collapse" }));
  await expect.element(overflow).not.toBeInTheDocument();

  await screen.rerender(view(threads.slice(1)));
  const badge = attention.getByText("5", { exact: true }).element();
  const [bounce] = badge.getAnimations();
  expect(bounce?.effect).toBeInstanceOf(KeyframeEffect);
  if (!(bounce?.effect instanceof KeyframeEffect))
    throw new Error("Expected the live badge bounce");
  expect(bounce.effect.getTiming()).toMatchObject({ duration: 300, iterations: 1 });
  expect(bounce.effect.getKeyframes().map((frame) => frame.transform)).toEqual([
    "scale(1)",
    "scale(1.25)",
    "scale(1)",
  ]);
  const first = attention.getByRole("button", { name: /Thread 0/ });
  await expect.element(first).not.toBeInTheDocument();
  const ghosts = [
    ...attention.element().querySelectorAll<HTMLElement>("[data-sidebar-motion-exit]"),
  ];
  const leaving = ghosts.find((ghost) => ghost.textContent?.includes("Thread 0"));
  expect(leaving?.inert).toBe(true);
  const [exit] = leaving?.getAnimations() ?? [];
  expect(exit?.effect?.getTiming()).toMatchObject({ duration: 350, iterations: 1 });
  expect(
    exit?.effect instanceof KeyframeEffect && exit.effect.getKeyframes().at(-1)?.transform,
  ).toBe("translateX(-16px)");

  animations.mockClear();
  await screen.rerender(view(threads.slice(1)));
  expect(animations).not.toHaveBeenCalled();
  matches.mockReturnValue(true);
  preference.dispatchEvent(new Event("change"));
  expect(leaving?.isConnected).toBe(false);
  expect(bounce.playState).toBe("idle");
  await screen.rerender(view([]));
  await expect.element(attention).not.toBeInTheDocument();
  expect(screen.container.querySelector("[data-sidebar-motion-exit]")).toBeNull();
  expect(animations).not.toHaveBeenCalled();
});

describe("sidebar render isolation", () => {
  // regression: #33100 Cmd+J re-rendered every sidebar row, which took hundreds of ms with many threads
  it("does not re-render thread rows when a quick Mod shortcut opens and focuses the terminal", async () => {
    using stack = new DisposableStack();
    const activeProject = project("active");
    const threads = Array.from({ length: 5 }, (_, index) => threadShell(activeProject.id, index));
    const routeThreadRef: ScopedThreadRef = {
      environmentId: activeProject.environmentId,
      threadId: threads[0]!.id,
    };
    threads.unshift(threadShell(activeProject.id, 100));
    // A real wall-clock minute tick mid-test re-renders every row and reads as a leak.
    vi.mocked(useNowMinute).mockReturnValue("2026-01-01T00:00");
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: routeThreadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef,
    });
    const terminal = document.createElement("div");
    terminal.dataset.terminalOwner = "drawer";
    const terminalInput = document.createElement("textarea");
    terminal.append(terminalInput);
    document.body.append(terminal);
    stack.defer(() => terminal.remove());
    stack.defer(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, false));
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(screen.getByText("Thread 4").first()).toBeInTheDocument();
    const rowRenders = () => vi.mocked(SortableThreadRow).mock.calls.length;

    using _timers = fakeTimers();
    const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
    const beforeShortcut = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, true));
    await act(() => terminalInput.focus());
    await userEvent.keyboard(`{/${modifier}}`);
    await act(() => terminalInput.blur());
    expect(
      rowRenders() - beforeShortcut,
      "thread rows re-rendered while opening the terminal with a quick Mod shortcut",
    ).toBe(0);

    const jumpLabelsSince = (start: number) =>
      vi
        .mocked(SortableThreadRow)
        .mock.calls.slice(start)
        .map(([props]) => props.jumpLabel)
        .filter((label) => label !== null);
    const beforeHold = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS));
    expect(jumpLabelsSince(beforeHold), "holding Mod showed no jump hints").toHaveLength(2);
    const beforeRelease = rowRenders();
    await userEvent.keyboard(`{/${modifier}}`);
    expect(rowRenders()).toBeGreaterThan(beforeRelease);
    expect(jumpLabelsSince(beforeRelease)).toEqual([]);
  });
});

describe("sidebar thread rename", () => {
  // regression: #35151 an untouched rename wrote back the title it opened with over a newer one
  it.each(["{Enter}", "{Tab}"])(
    "ending an untouched rename with %s keeps a title that arrived while it was open",
    async (finish) => {
      const activeProject = project("active");
      const routeThreadRef: ScopedThreadRef = {
        environmentId: activeProject.environmentId,
        threadId: ThreadId.make("thread-0"),
      };
      const shellTitled = (title: string) => ({ ...threadShell(activeProject.id, 0), title });
      const updateMetadata = vi.fn().mockResolvedValue({ _tag: "Success" });
      vi.mocked(useOrchestrationCommand).mockReturnValue(updateMetadata);
      vi.mocked(readEnvironmentScope).mockReturnValue(true);
      vi.mocked(useEnvironmentScope).mockReturnValue(true);
      vi.mocked(useProjects).mockReturnValue([activeProject]);
      vi.mocked(useQuietThreadShells).mockReturnValue([shellTitled("Fix the login redirect")]);
      vi.mocked(useThreadRouteTarget).mockReturnValue({
        kind: "server",
        threadRef: routeThreadRef,
      });
      vi.mocked(useHandleNewThread).mockReturnValue({
        activeDraftThread: null,
        activeThread: null,
        defaultProjectRef: {
          environmentId: activeProject.environmentId,
          projectId: activeProject.id,
        },
        defaultProjectFallbackReady: true,
        handleNewThread: vi.fn().mockResolvedValue(null),
        routeDraftId: null,
        routeThreadRef,
      });
      const tree = () => (
        <SidebarProvider>
          <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
        </SidebarProvider>
      );
      await using screen = await render(tree());
      await userEvent.dblClick(screen.getByText("Fix the login redirect").first());
      const input = screen.getByRole("textbox", { name: "Thread title" });
      await expect.element(input).toHaveValue("Fix the login redirect");

      vi.mocked(useQuietThreadShells).mockReturnValue([shellTitled("Generated title")]);
      await screen.rerender(tree());
      await userEvent.keyboard(finish);

      await expect.element(input).not.toBeInTheDocument();
      expect(updateMetadata).not.toHaveBeenCalled();
    },
  );
});

describe("sidebar thread menu", () => {
  it("tells the menu whether the keyboard opened it", async () => {
    const activeProject = project("active");
    const thread = threadShell(activeProject.id, 0);
    const threadRef = { environmentId: activeProject.environmentId, threadId: thread.id };
    const show = vi.fn().mockResolvedValue(null);
    vi.mocked(readLocalApi).mockReturnValue({ contextMenu: { show } } as unknown as LocalApi);
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue([thread]);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: threadRef,
    });
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const row = screen.getByText("Thread 0").first();
    await expect.element(row).toBeInTheDocument();
    row.element().closest<HTMLElement>("[data-sidebar-row]")!.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show.mock.lastCall?.[2]).toBe("keyboard");
    await userEvent.click(row, { button: "right" });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    expect(show.mock.lastCall?.[2]).toBe("mouse");
  });
});

it("restores category assignments and collapse state without moving the same ID in another environment", async () => {
  using stack = new DisposableStack();
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());
  const saved = localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
  localStorage.removeItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
  stack.defer(() => {
    if (saved === null) localStorage.removeItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
    else localStorage.setItem(SIDEBAR_CATEGORIES_STORAGE_KEY, saved);
  });
  const local = project("local-project");
  const remote = { ...project("remote-project"), environmentId: EnvironmentId.make("remote") };
  const thread = threadShell(local.id, 0);
  const remoteThread = makeThreadFixture({
    environmentId: remote.environmentId,
    projectId: remote.id,
    id: thread.id,
    title: "Remote session",
  });
  const show = vi.fn<LocalApi["contextMenu"]["show"]>().mockResolvedValue("move-to-category");
  using _api = vi.spyOn(localApi, "readLocalApi").mockReturnValue({
    contextMenu: { show },
  } as unknown as LocalApi);
  vi.mocked(useProjects).mockReturnValue([local, remote]);
  vi.mocked(useQuietThreadShells).mockReturnValue([thread, remoteThread]);
  const localRef = scopeThreadRef(local.environmentId, thread.id);
  vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: localRef });
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: scopeProjectRef(local.environmentId, local.id),
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn(),
    routeDraftId: null,
    routeThreadRef: localRef,
  });
  const tree = () => (
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>
  );
  {
    await using screen = await render(tree());
    await userEvent.click(screen.getByRole("button", { name: "New category" }));
    const create = page.getByRole("dialog", { name: "New category" });
    await userEvent.fill(create.getByRole("textbox", { name: "Category name" }), "Release work");
    await userEvent.click(create.getByRole("button", { name: "Create category" }));
    const remoteRow = screen.getByRole("button", { name: /Remote session/ });
    await userEvent.click(remoteRow, { button: "right" });
    const move = page.getByRole("dialog", { name: "Move to category" });
    await userEvent.click(move.getByRole("button", { name: "Release work" }));
    await expect.element(move).not.toBeInTheDocument();
    using _animations = pauseSidebarAnimations();
    const category = screen.getByRole("button", { name: "Release work", exact: true });
    category.element().focus();
    await userEvent.keyboard("{ArrowLeft}");
    const exit = screen.container.querySelector<HTMLElement>("[data-sidebar-motion-exit][inert]");
    expect(exit?.textContent).toContain("Remote session");
    expect(exit?.querySelector("[data-sidebar-row]")).toBeNull();
    expect(exit?.getAnimations()[0]?.effect?.getTiming()).toMatchObject({
      duration: 150,
      iterations: 1,
    });
    await expect.element(remoteRow).not.toBeInTheDocument();
    await expect.element(screen.getByText(thread.title).first()).toBeVisible();
    const localRow = screen.getByText(thread.title).first().element().closest("[data-sidebar-row]");
    expect(localRow?.getAttribute("data-sidebar-parent")).toBe("category:uncategorized");
    const movement = localRow?.closest("li")?.getAnimations()[0]?.effect;
    expect(movement instanceof KeyframeEffect && movement.getKeyframes()[0]?.transform).toMatch(
      /^translateY\([1-9]\d*px\)$/,
    );
  }
  await using restored = await render(tree());
  const category = restored.getByRole("button", { name: /^Release work/ });
  const remoteRow = restored.getByRole("button", { name: /Remote session/ });
  await expect.element(category).toHaveAttribute("aria-expanded", "false");
  await expect.element(remoteRow).not.toBeInTheDocument();
  await userEvent.click(category);
  await expect.element(remoteRow).toBeVisible();
  await userEvent.click(remoteRow, { button: "right" });
  const move = page.getByRole("dialog", { name: "Move to category" });
  await userEvent.click(move.getByRole("button", { name: "Uncategorized" }));
  await expect.element(move).not.toBeInTheDocument();
  await userEvent.click(category);
  await expect.element(remoteRow).toBeVisible();
});

describe("sidebar settled pagination", () => {
  it("keeps the viewport in place when showing more settled threads", async () => {
    using stack = new DisposableStack();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    stack.defer(() => style.remove());
    const focusController = createWorkspaceFocusController(document);
    stack.defer(() => focusController.dispose());
    let loading = false;
    const originalShelf = vi.mocked(shelfHooks.useOlderSettledShelf).getMockImplementation()!;
    using _shelf = vi.spyOn(shelfHooks, "useOlderSettledShelf").mockImplementation((input) => ({
      ...originalShelf(input),
      loading,
      retry: () => {
        loading = true;
      },
    }));
    const activeProject = project("active");
    const threads = Array.from({ length: 70 }, (_, index) =>
      makeThreadFixture({
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
        id: ThreadId.make(`settled-${index}`),
        title: `Settled thread ${index}`,
        settledOverride: "settled",
        settledAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    threads.unshift(threadShell(activeProject.id, 100));
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: { environmentId: activeProject.environmentId, threadId: threads[0]!.id },
    });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: { environmentId: activeProject.environmentId, threadId: threads[0]!.id },
    });
    vi.mocked(useServerConfigs).mockReturnValue(
      new Map([
        [
          activeProject.environmentId,
          {
            scratchWorkspaceRoot: null,
            shellThreadFamilies: false,
          } as unknown as EnvironmentServerConfig,
        ],
      ]),
    );
    await using screen = await render(
      <SidebarProvider
        {...workspaceAreaProps("sidebar", 0, "Threads")}
        style={{ height: 400, minHeight: 400 }}
      >
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const shelf = screen.container.querySelector<HTMLElement>(
      '[data-sidebar-row="shelf:settled"]',
    )!;
    if (shelf.getAttribute("aria-expanded") === "false") await act(() => shelf.click());
    const more = screen.getByRole("button", { name: "Show 25 more", exact: true });
    await expect.element(more).toBeInTheDocument();
    const moreButton = more.element() as HTMLButtonElement;
    const viewport = moreButton.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    viewport.style.height = "300px";
    viewport.style.maxHeight = "300px";
    moreButton.scrollIntoView({ block: "nearest" });
    const before = viewport.scrollTop;
    expect(before).toBeGreaterThan(0);
    moreButton.focus({ preventScroll: true });
    await act(() => moreButton.click());
    await expect
      .element(screen.getByRole("button", { name: "Loading", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Loading", exact: true }))
      .toHaveFocus();
    expect(viewport.scrollTop).toBe(before);
    const loadedRows = screen.container.querySelectorAll("[data-thread-item]").length;
    await act(() => moreButton.click());
    expect(screen.container.querySelectorAll("[data-thread-item]")).toHaveLength(loadedRows);
  });
});

import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import type { ServerProvider } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import "../../index.css";
import { environmentPresentations } from "../../state/presentation";
import { makeThreadFixture } from "../../test-fixtures";
import { SidebarProvider } from "../ui/sidebar";
import { SIDEBAR_CATEGORIES_STORAGE_KEY, useSidebarCategories } from "./SidebarCategories";
import { SidebarCategorySuggestions } from "./SidebarCategorySuggestions";

const send = vi.hoisted(() => vi.fn());

vi.mock("@t3tools/client-runtime/state/runtime", async (load) => {
  const runtime = await load<typeof import("@t3tools/client-runtime/state/runtime")>();
  return {
    ...runtime,
    createEnvironmentRpcCommand: (
      ...args: Parameters<typeof runtime.createEnvironmentRpcCommand>
    ) => {
      const command = runtime.createEnvironmentRpcCommand(...args);
      return args[1].tag === WS_METHODS.serverSuggestSidebarCategories
        ? { ...command, permissionAtom: () => Atom.make(true) }
        : command;
    },
    runAtomCommand: (...args: Parameters<typeof runtime.runAtomCommand>) =>
      args[1].label === "sidebar:category-suggestions"
        ? send(args[2])
        : runtime.runAtomCommand(...args),
  };
});

vi.mock("../../state/presentation", async (load) => {
  const presentation = await load<typeof import("../../state/presentation")>();
  return {
    ...presentation,
    environmentPresentations: {
      ...presentation.environmentPresentations,
      providersByEnvironmentAtom: Atom.make<ReadonlyMap<EnvironmentId, readonly ServerProvider[]>>(
        new Map(),
      ),
    },
  };
});

const laptop = EnvironmentId.make("laptop");
const remote = EnvironmentId.make("remote");
const instanceId = ProviderInstanceId.make("test-model-provider");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-22T00:00:00.000Z",
  models: [{ slug: "test-model", name: "Test model", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
};
const sharedId = ThreadId.make("same-session-id");
const localTitle = "Laptop title";
const remoteTitle = "Remote title";
const uncheckedTitle = "Remote title to skip";
const threads = [
  makeThreadFixture({ environmentId: laptop, id: sharedId, title: localTitle }),
  makeThreadFixture({ environmentId: remote, id: sharedId, title: remoteTitle }),
  makeThreadFixture({
    environmentId: remote,
    id: ThreadId.make("unchecked"),
    title: uncheckedTitle,
  }),
];
const categories = [
  { id: "research", name: "Research" },
  { id: "development", name: "Development" },
];

function Suggestions() {
  const { state, assignCategories, selectSuggestionModel } = useSidebarCategories();
  return (
    <SidebarCategorySuggestions
      threads={threads}
      categories={categories}
      connected={[laptop, remote]}
      primary={laptop}
      labels={
        new Map([
          [laptop, "Laptop"],
          [remote, "Remote"],
        ])
      }
      models={state.suggestionModels}
      onSelectModel={selectSuggestionModel}
      onConfirm={assignCategories}
    />
  );
}

it("sends only the selected environment's titles and saves only reviewed, checked rows on confirmation", async () => {
  using cleanup = new DisposableStack();
  const saved = localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
  localStorage.removeItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
  cleanup.defer(() => {
    if (saved === null) localStorage.removeItem(SIDEBAR_CATEGORIES_STORAGE_KEY);
    else localStorage.setItem(SIDEBAR_CATEGORIES_STORAGE_KEY, saved);
  });
  const registry = AtomRegistry.make({
    initialValues: [
      [
        environmentPresentations.providersByEnvironmentAtom,
        new Map([
          [laptop, [provider]],
          [remote, [provider]],
        ]),
      ],
    ],
  });
  cleanup.defer(() => registry.dispose());
  send.mockResolvedValue({
    _tag: "Success",
    value: {
      model: "test-model",
      suggestions: [
        { titleIndex: 0, categoryIndex: 0, reason: "First reason" },
        { titleIndex: 1, categoryIndex: 0, reason: "Second reason" },
      ],
    },
  });
  await using _screen = await render(
    <RegistryContext.Provider value={registry}>
      <SidebarProvider>
        <Suggestions />
      </SidebarProvider>
    </RegistryContext.Provider>,
  );

  const trigger = page.getByRole("button", { name: "Suggest categories" });
  const dialog = page.getByRole("dialog", { name: "Suggested categories" });
  const requestRemote = async () => {
    await userEvent.click(trigger);
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Environment" }), remote);
    await userEvent.click(dialog.getByRole("button", { name: "Get suggestions" }));
    await expect.element(dialog.getByText("First reason")).toBeVisible();
  };
  await requestRemote();
  expect(send).toHaveBeenCalledExactlyOnceWith({
    environmentId: remote,
    input: {
      titles: [remoteTitle, uncheckedTitle],
      categories: ["Research", "Development"],
      modelSelection: null,
      language: "en",
    },
  });
  await expect.element(dialog.getByText(localTitle, { exact: true })).not.toBeInTheDocument();
  expect(localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY)).toBeNull();
  await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY)).toBeNull();

  await requestRemote();
  await userEvent.selectOptions(
    dialog.getByRole("combobox", { name: `Category for ${remoteTitle}`, exact: true }),
    "development",
  );
  await userEvent.click(dialog.getByRole("checkbox", { name: `Include ${uncheckedTitle}` }));
  expect(localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY)).toBeNull();
  await userEvent.click(dialog.getByRole("button", { name: "Move 1 threads" }));
  expect(JSON.parse(localStorage.getItem(SIDEBAR_CATEGORIES_STORAGE_KEY) ?? "null")).toEqual(
    expect.objectContaining({
      assignments: { [scopedThreadKey(scopeThreadRef(remote, sharedId))]: "development" },
    }),
  );
});

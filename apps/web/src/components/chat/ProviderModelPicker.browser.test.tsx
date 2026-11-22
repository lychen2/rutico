import {
  DEFAULT_CLIENT_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

it("keeps each registry image when adding a model from another ACP agent", async () => {
  const icons = [
    "https://cdn.agentclientprotocol.com/registry/icons/picker-explicit.svg",
    "https://cdn.agentclientprotocol.com/registry/v1/latest/picker-by-id.svg",
  ];
  const cache = await caches.open("t3-acp-registry-icons-v1");
  await using _cachedIcons = {
    async [Symbol.asyncDispose]() {
      await Promise.all(icons.map((url) => cache.delete(url)));
    },
  };
  for (const [index, url] of icons.entries()) {
    await cache.put(
      url,
      new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${11 + index * 6}" height="10"><path d="M0 0h10v10H0z"/></svg>`,
        { headers: { "content-type": "image/svg+xml" } },
      ),
    );
  }
  const entries = deriveProviderInstanceEntries(
    ["First", "Second"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: `${name} agent`,
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  ).map((entry, index) => ({
    ...entry,
    ...(index === 0 ? { acpRegistryIconUrl: icons[0] } : { acpRegistryAgentId: "picker-by-id" }),
  }));
  const first = { instanceId: entries[0]!.instanceId, model: "first" };
  const options = new Map(entries.map((entry) => [entry.instanceId, entry.models]));

  function Picker() {
    const [selection, setSelection] = useState<ReadonlyArray<ModelSelection>>([first]);
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={first.instanceId}
        model={first.model}
        {...(selection.length > 1 ? { selectedModels: selection } : {})}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        onToggleModel={(instanceId, model) => setSelection([...selection, { instanceId, model }])}
        onInstanceModelChange={(instanceId, model) => setSelection([{ instanceId, model }])}
      />
    );
  }

  await using screen = await render(<Picker />);
  const imageWidths = () =>
    Array.from(
      screen.container.querySelectorAll<HTMLImageElement>("[data-chat-provider-model-picker] img"),
      (image) => image.naturalWidth,
    );
  await vi.waitFor(() => expect(imageWidths()).toEqual([11]));
  await screen.getByRole("button", { name: "First model", exact: true }).click();
  await page.getByRole("button", { name: "Second agent", exact: true }).click();
  await userEvent.keyboard("{Shift>}");
  try {
    await page.getByRole("option", { name: /Second model/ }).click();
  } finally {
    await userEvent.keyboard("{/Shift}");
  }
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(imageWidths()).toEqual([11, 17]));
});

it("keeps a docked picker open after a pick and hands focus to that model's effort", async () => {
  const instanceId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      [
        { slug: "original", name: "Original model" },
        { slug: "second", name: "Second model" },
        { slug: "plain", name: "Plain model" },
      ],
    ],
  ]);
  // The last level is the selected one; "plain" has no effort to pick.
  const levels: Record<string, ReadonlyArray<string>> = {
    original: ["Low", "High"],
    second: ["Medium"],
    plain: [],
  };

  function Picker() {
    const [model, setModel] = useState("original");
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={instanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        triggerAriaLabel="Choose model"
        onInstanceModelChange={(_, selected) => setModel(selected)}
        effortColumn={(levels[model] ?? []).map((level, index, all) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={index === all.length - 1}
            data-effort-row
            data-effort-level
          >
            {level}
          </button>
        ))}
      />
    );
  }

  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("radio", { name: "High" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(search).toHaveFocus();

  await page.getByRole("option", { name: /Second model/ }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();

  await page.getByRole("option", { name: /Plain model/ }).click();
  await page.getByRole("option", { name: /Second model/ }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(search).not.toBeInTheDocument();
});

it("lists a model reported twice by one provider once, with contiguous jump shortcuts", async () => {
  const instanceId = ProviderInstanceId.make("claude");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("claudeAgent"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      ["a", "b", "c", "c", "d", "d"].map((slug) => ({
        slug,
        name: `Model ${slug.toUpperCase()}`,
      })),
    ],
  ]);
  const keybindings = compileResolvedKeybindingsConfig(
    ([1, 2, 3, 4, 5, 6] as const).map((index) => ({
      key: `mod+${index}`,
      command: `modelPicker.jump.${index}` as const,
      when: "modelPickerOpen",
    })),
  );

  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={instanceId}
      model="a"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={options}
      keybindings={keybindings}
      triggerAriaLabel="Choose model"
      onInstanceModelChange={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Choose model" }).click();
  await expect.element(page.getByRole("option", { name: /Model A/ })).toBeVisible();
  await vi.waitFor(() =>
    expect(
      page
        .getByRole("option")
        .elements()
        .map((row) => [
          row.textContent?.match(/Model [A-Z]/)?.[0],
          row.querySelector("kbd")?.textContent?.slice(-1),
        ]),
    ).toEqual([
      ["Model A", "1"],
      ["Model B", "2"],
      ["Model C", "3"],
      ["Model D", "4"],
    ]),
  );
});

it("opens on the active provider when every favorite belongs to a disabled provider", async () => {
  const entries = deriveProviderInstanceEntries(
    ["Codex", "Claude"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make(name.toLowerCase()),
      enabled: name === "Codex",
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  );
  const [codex, claude] = entries;
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    favorites: [{ provider: claude!.instanceId, model: "claude" }],
  });
  using _settings = {
    [Symbol.dispose]: () => __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS),
  };

  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={codex!.instanceId}
      model="codex"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={new Map(entries.map((entry) => [entry.instanceId, entry.models]))}
      triggerAriaLabel="Choose model"
      onInstanceModelChange={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Choose model" }).click();
  await expect.element(page.getByRole("option", { name: /Codex model/ })).toBeVisible();
});

it("keeps the popup height while switching providers and selecting a custom model by keyboard", async () => {
  const entries = deriveProviderInstanceEntries(
    [
      { id: "codex", label: "OpenAI work", driver: "codex", count: 2 },
      { id: "claude", label: "Claude work", driver: "claudeAgent", count: 7 },
    ].map(({ id, label, driver, count }) => ({
      instanceId: ProviderInstanceId.make(id),
      driver: ProviderDriverKind.make(driver),
      displayName: label,
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: Array.from({ length: count }, (_, index) => ({
        slug: `${id}-${index}`,
        name: id === "codex" ? `OpenAI model ${index}` : `Custom review ${index}`,
        isCustom: id === "claude",
        capabilities: {},
      })),
      slashCommands: [],
      skills: [],
    })),
  );
  const [codex, claude] = entries;
  const options = new Map(entries.map((entry) => [entry.instanceId, entry.models]));

  function Picker() {
    const [selection, setSelection] = useState({ instanceId: codex!.instanceId, model: "codex-0" });
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        onInstanceModelChange={(instanceId, model) => setSelection({ instanceId, model })}
      />
    );
  }

  const { innerWidth, innerHeight } = window;
  await page.viewport(1000, 740);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(innerWidth, innerHeight),
  };
  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "OpenAI model 0" }).click();
  const search = page.getByRole("combobox");
  const activeProvider = page.getByRole("button", { name: "OpenAI work", pressed: true });
  const otherProvider = page.getByRole("button", { name: "Claude work" });
  await expect.element(activeProvider.getByText("OpenAI work", { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("option", { name: /OpenAI model 0/, selected: true }))
    .toBeVisible();
  await expect.element(search).toHaveFocus();
  const content = search.element().closest<HTMLElement>("[data-model-picker-content]")!;
  const before = content.offsetHeight;
  expect(before).toBeGreaterThan(0);

  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(activeProvider).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(otherProvider).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(otherProvider).toHaveAttribute("aria-pressed", "true");
  await expect.element(search).toHaveFocus();
  await expect.element(page.getByRole("option", { name: /Custom review 6/ })).toBeVisible();
  expect(content.offsetHeight).toBe(before);

  await search.fill("Custom review 6");
  await expect.element(page.getByRole("option", { name: /Custom review 6/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(search).not.toBeInTheDocument();
  const chosenTrigger = screen.getByRole("button", { name: "Custom review 6" });
  await expect.element(chosenTrigger).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("button", { name: claude!.displayName, pressed: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("option", { name: /Custom review 6/, selected: true }))
    .toBeVisible();
});

it("keeps the touch keyboard down while choosing a provider", async () => {
  const entries = deriveProviderInstanceEntries(
    ["Codex", "Claude"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make(name.toLowerCase()),
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  );
  const [codex] = entries;
  const { innerWidth, innerHeight } = window;
  await page.viewport(375, 740);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(innerWidth, innerHeight),
  };
  const matchMedia = window.matchMedia.bind(window);
  using _touch = vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query === "(pointer: coarse)"
      ? ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList)
      : matchMedia(query),
  );

  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={codex!.instanceId}
      model="codex"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={new Map(entries.map((entry) => [entry.instanceId, entry.models]))}
      triggerAriaLabel="Choose model"
      onInstanceModelChange={() => {}}
    />,
  );
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  const popup = search.element().closest('[data-slot="popover-popup"]');
  await vi.waitFor(() => expect(document.activeElement).toBe(popup));
  const bounds = popup?.getBoundingClientRect();
  expect(bounds?.left).toBeGreaterThanOrEqual(0);
  expect(bounds?.right).toBeLessThanOrEqual(375);
  await expect
    .element(page.getByRole("button", { name: /^Claude/ }).getByText(/^Claude/))
    .not.toBeVisible();

  await page.getByRole("button", { name: /^Claude/ }).click();
  await expect.element(page.getByRole("option", { name: /Claude model/ })).toBeVisible();
  await expect.element(search).not.toHaveFocus();
});

it("keeps a docked list fixed while scrolling and shows only the row's levels and quota", async () => {
  const workId = ProviderInstanceId.make("codex-work");
  const personalId = ProviderInstanceId.make("codex-personal");
  const checkedAt = "2026-11-20T12:00:00.000Z";
  vi.setSystemTime(new Date(checkedAt));
  using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
  const native = {
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready" as const,
    auth: { status: "authenticated" as const },
    checkedAt,
    slashCommands: [],
    skills: [],
  };
  const entries = deriveProviderInstanceEntries([
    {
      ...native,
      instanceId: workId,
      displayName: "Work Codex",
      usageLimits: {
        checkedAt,
        windows: [{ id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 87 }],
      },
      models: Array.from({ length: 7 }, (_, index) => ({
        slug: `work-${index}`,
        name: `Work model ${index}`,
        isCustom: false,
        capabilities:
          index === 0
            ? createModelCapabilities({
                optionDescriptors: [
                  {
                    id: "thought_level",
                    label: "Thinking",
                    role: "reasoning",
                    type: "select",
                    options: [
                      { id: "low", label: "Low" },
                      { id: "high", label: "High" },
                      { id: "ultrathink", label: "Ultrathink" },
                    ],
                    promptInjectedValues: ["ultrathink"],
                  },
                ],
              })
            : {},
      })),
    },
    {
      ...native,
      instanceId: personalId,
      displayName: "Personal Codex",
      models: [{ slug: "personal", name: "Personal model", isCustom: false, capabilities: {} }],
    },
  ]);
  const { innerWidth, innerHeight } = window;
  await page.viewport(1000, 740);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(innerWidth, innerHeight),
  };
  await using screen = await render(
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={workId}
      model="work-0"
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={new Map(entries.map((entry) => [entry.instanceId, entry.models]))}
      effortColumn={<div />}
      onInstanceModelChange={vi.fn()}
    />,
  );
  await screen.getByRole("button", { name: "Work model 0" }).click();
  const workRow = page.getByRole("option", { name: /Work model 0/ });
  await expect.element(workRow.getByText(/2 levels.*13% left/)).toBeVisible();
  const search = page.getByRole("combobox");
  const list = search
    .element()
    .closest("[data-model-picker-content]")!
    .querySelector<HTMLElement>("[data-model-picker-list]")!;
  const scroller = list.querySelector<HTMLElement>(".scrollbar-gutter-stable")!;
  expect(list.clientHeight).toBe(146);
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
  await vi.waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));

  await page.getByRole("button", { name: "Personal Codex", exact: true }).click();
  const personalRow = page.getByRole("option", { name: /Personal model/ });
  await expect.element(personalRow).toBeVisible();
  expect(list.clientHeight).toBe(146);
  await expect.element(personalRow.getByText(/levels|% left/)).not.toBeInTheDocument();

  await search.fill("Work model 0");
  await expect.element(workRow.getByText(/2 levels.*13% left/)).toBeVisible();
  expect(list.clientHeight).toBe(146);
});

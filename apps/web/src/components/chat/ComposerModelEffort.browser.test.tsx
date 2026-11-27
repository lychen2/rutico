import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { resolveRuntimeModeOption } from "./runtimeModeConfig";
import type { TraitsSelectionInput } from "./TraitsPicker";

// Shaped like Devin over ACP: its session mode comes first, and its reasoning id is its own.
const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "fusion",
    name: "Fusion (Claude Opus 5.5 Medium + SWE-2 High)",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "mode",
          label: "Session Mode",
          type: "select",
          currentValue: "bypass",
          options: [
            { id: "code", label: "Code" },
            { id: "plan", label: "Plan" },
            { id: "bypass", label: "Bypass Permissions" },
          ],
        },
        {
          id: "thought_level",
          label: "Thinking",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
        {
          id: "speed",
          label: "Speed",
          type: "select",
          currentValue: "standard",
          options: [
            { id: "standard", label: "Standard" },
            { id: "fast", label: "Fast" },
          ],
        },
        { id: "auto_approve", label: "Auto-approve tools", type: "boolean", currentValue: false },
      ],
    }),
  },
];

function traitsInput(
  modelOptions: ReadonlyArray<ProviderOptionSelection>,
  onModelOptionsChange: (next: ReadonlyArray<ProviderOptionSelection> | undefined) => void,
): TraitsSelectionInput {
  return {
    provider: ProviderDriverKind.make("acpRegistry"),
    instanceId: ProviderInstanceId.make("devin"),
    models,
    model: "fusion",
    modelOptions,
    onModelOptionsChange,
  };
}

function Column() {
  const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([]);
  const traits = traitsInput(options, (next) => setOptions(next ?? []));
  return (
    <>
      <div data-model-picker-effort>
        <ComposerEffortColumn traits={traits} />
      </div>
      <p role="status">{describeComposerEffort(traits, "bars", "sm").suffix}</p>
    </>
  );
}

it("draws an agent's reasoning as bars and keeps its mode out of the levels", async () => {
  await using screen = await render(<Column />, { router: false }); // no routes involved
  const status = screen.getByRole("status");
  expect(status.element().querySelector("[data-composer-effort-glyph]")).not.toBeNull();
  await expect.element(status).toHaveTextContent("");

  const levels = screen.getByRole("radiogroup", { name: "Thinking" });
  await expect.element(levels.getByRole("radio")).toHaveLength(3);
  await expect.element(screen.getByRole("radio", { name: "Plan" })).not.toBeInTheDocument();

  // Up and Down walk from the levels through the option rows without opening their menus.
  await userEvent.tab();
  await expect.element(screen.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  const speed = screen.getByRole("button", { name: "Speed: Standard" });
  await expect.element(speed).toHaveFocus();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitemradio", { name: "Standard" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
  await expect.element(speed).toHaveFocus();

  await userEvent.click(screen.getByText("Auto-approve tools"));
  await expect
    .element(screen.getByRole("switch", { name: "Auto-approve tools" }))
    .toHaveAttribute("aria-checked", "true");

  await userEvent.click(screen.getByRole("button", { name: "Session Mode: Bypass Permissions" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "Plan" }));
  await expect
    .element(screen.getByRole("button", { name: "Session Mode: Plan" }))
    .toBeInTheDocument();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
});

it("stacks providers, models, effort and permissions without clipping the provider strip", async () => {
  const driver = ProviderDriverKind.make("acpRegistry");
  const entries = deriveProviderInstanceEntries(
    Array.from({ length: 13 }, (_, index) => ({
      instanceId: ProviderInstanceId.make(`agent-${index}`),
      driver,
      displayName: `Agent ${index}`,
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: models.map((model) => ({ ...model, name: `${model.name} ${index}` })),
      slashCommands: [],
      skills: [],
    })),
  );
  const first = entries[0]!;
  const optionsByInstance = new Map(entries.map((entry) => [entry.instanceId, entry.models]));
  const permissions = [
    resolveRuntimeModeOption("approval-required"),
    resolveRuntimeModeOption("full-access"),
  ];

  function Picker() {
    const [instanceId, setInstanceId] = useState(first.instanceId);
    const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([]);
    const [mode, setMode] = useState<RuntimeMode>("approval-required");
    const traits = { ...traitsInput(options, (next) => setOptions(next ?? [])), instanceId };
    return (
      <div className="fixed bottom-12 left-6">
        <ProviderModelPicker
          environmentId={null}
          activeInstanceId={instanceId}
          model="fusion"
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={optionsByInstance}
          triggerAriaLabel="Choose model"
          onInstanceModelChange={setInstanceId}
          isComposerOwned
          effortColumn={<ComposerEffortColumn traits={traits} />}
          footer={
            <ComposerPickerFooter
              traits={traits}
              runtimeMode={mode}
              runtimeModeOptions={permissions}
              onRuntimeModeChange={setMode}
            />
          }
        />
      </div>
    );
  }

  const { innerWidth, innerHeight } = window;
  await page.viewport(1000, 740);
  await using _viewport = { [Symbol.asyncDispose]: () => page.viewport(innerWidth, innerHeight) };
  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByRole("combobox");
  const toolbar = page.getByRole("toolbar", { name: "Providers" });
  const levels = page.getByRole("radiogroup", { name: "Thinking" });
  const permission = page.getByRole("button", { name: "Permissions: Supervised" });
  await expect.element(search).toHaveFocus();
  await expect.element(levels.getByRole("radio", { name: "Medium" })).toBeVisible();
  const popup = search.element().closest<HTMLElement>('[data-slot="popover-popup"]')!;
  const geometry = () => {
    const provider = toolbar.element().getBoundingClientRect();
    const list = search.element().getBoundingClientRect();
    const model = page
      .getByRole("option", { name: /Fusion/ })
      .element()
      .getBoundingClientRect();
    const effort = levels.element().getBoundingClientRect();
    return {
      width: popup.offsetWidth,
      searchAboveProviders: list.bottom <= provider.top,
      modelAboveEffort: model.bottom <= effort.top,
      effortAbovePermissions: effort.bottom <= permission.element().getBoundingClientRect().top,
      levelsOnOneLine: levels
        .getByRole("radio")
        .elements()
        .every(
          (level) =>
            level.getBoundingClientRect().top ===
            levels.getByRole("radio").first().element().getBoundingClientRect().top,
        ),
    };
  };
  const track = popup.querySelector<HTMLElement>("[data-cosmic-track]")!;
  const canvas = track.querySelector("canvas")!;
  await vi.waitFor(() => {
    expect(canvas.dataset.renderState).toBe("active");
    expect(canvas.getContext("2d")?.getImageData(30, 20, 1, 1).data[3]).toBe(255);
  });
  await vi.waitFor(() => expect(canvas.dataset.renderState).toBe("sleeping"), { timeout: 4_000 });
  await vi.waitFor(() =>
    expect(geometry()).toEqual({
      width: 380,
      searchAboveProviders: true,
      modelAboveEffort: true,
      effortAbovePermissions: true,
      levelsOnOneLine: true,
    }),
  );

  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(toolbar.getByRole("button", { name: "Agent 0" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(toolbar.getByRole("button", { name: "Agent 1" })).toHaveFocus();
  await userEvent.keyboard("{End}");
  const last = toolbar.getByRole("button", { name: "Agent 12" });
  await expect.element(last).toHaveFocus();
  await vi.waitFor(() =>
    expect(last.element().getBoundingClientRect().right).toBeLessThanOrEqual(
      toolbar.element().getBoundingClientRect().right,
    ),
  );
  await userEvent.keyboard("{Enter}");
  await expect.element(last).toHaveAttribute("aria-pressed", "true");
  await expect.element(search).toHaveFocus();
  await search.fill("Fusion");
  await expect.element(toolbar).not.toBeInTheDocument();
  await search.fill("");
  await expect.element(last).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("option", { name: /Fusion.*12/ }).click();
  await expect.element(levels.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}{Space}");
  await expect.element(levels.getByRole("radio", { name: "High", checked: true })).toHaveFocus();
  await vi.waitFor(() => expect(canvas.dataset.renderState).toBe("active"));
  const highStory = popup.querySelector("[data-cosmic-story]")?.textContent;
  const session = cdp();
  try {
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    expect(getComputedStyle(popup).transitionDuration).toBe("0s");
    await vi.waitFor(() => expect(canvas.dataset.renderState).toBe("sleeping"));
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    const bounds = track.getBoundingClientRect();
    const frame = window.frameElement?.getBoundingClientRect();
    const x = Math.round(bounds.left + (frame?.left ?? 0));
    const y = Math.round(bounds.top + bounds.height / 2 + (frame?.top ?? 0));
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: x + Math.round(bounds.width * 0.75), y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 16, y }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.element(levels.getByRole("radio", { name: /Low/, checked: true })).toBeVisible();
    expect(popup.querySelector("[data-cosmic-story]")?.textContent).not.toBe(highStory);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
  const supervisedColor = getComputedStyle(permission.element()).backgroundColor;
  await permission.click();
  await page.getByRole("menuitemradio", { name: /Full access/ }).click();
  await expect
    .element(page.getByRole("button", { name: "Permissions: Full access" }))
    .toBeVisible();
  expect(
    getComputedStyle(page.getByRole("button", { name: "Permissions: Full access" }).element())
      .backgroundColor,
  ).not.toBe(supervisedColor);
  await page.viewport(360, 520);
  await vi.waitFor(() => {
    const bounds = popup.getBoundingClientRect();
    expect(bounds.width).toBeLessThanOrEqual(336);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(360);
    expect(track.getBoundingClientRect().width).toBeGreaterThan(250);
  });
});

it("focuses a reasoning level by its first letter without selecting it", async () => {
  await using screen = await render(<Column />, { router: false }); // no routes involved
  await userEvent.tab();
  await expect.element(screen.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("l");
  await expect.element(screen.getByRole("radio", { name: "Low" })).toHaveFocus();
  await expect
    .element(screen.getByRole("radio", { name: "Medium" }))
    .toHaveAttribute("aria-checked", "true");
  for (const key of ["{Control>}h{/Control}", "{Meta>}h{/Meta}", "{Alt>}h{/Alt}", "{Delete}"]) {
    await userEvent.keyboard(key);
    await expect.element(screen.getByRole("radio", { name: "Low" })).toHaveFocus();
  }
  await userEvent.keyboard("H");
  await expect.element(screen.getByRole("radio", { name: "High" })).toHaveFocus();
  // Wraps past the last level back to the first match.
  await userEvent.keyboard("m");
  await expect.element(screen.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("h{Enter}");
  await expect
    .element(screen.getByRole("radio", { name: "High" }))
    .toHaveAttribute("aria-checked", "true");
});

it("commits effort slider drags once on release and ignores cancelled drags", async () => {
  const onModelOptionsChange = vi.fn();
  function TrackedColumn() {
    const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([]);
    const traits = traitsInput(options, (next) => {
      onModelOptionsChange(next);
      setOptions(next ?? []);
    });
    return (
      <div className="w-80" data-model-picker-effort>
        <ComposerEffortColumn traits={traits} />
      </div>
    );
  }

  await using screen = await render(<TrackedColumn />, { router: false });
  const track = screen.container.querySelector<HTMLElement>("[data-cosmic-track]")!;
  const bounds = track.getBoundingClientRect();
  const y = bounds.top + bounds.height / 2;

  // Drag from Medium across High and all the way to Low: preview updates without committing mid-drag.
  track.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: bounds.left + bounds.width * 0.5,
      clientY: y,
    }),
  );
  track.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: bounds.left + bounds.width * 0.9,
      clientY: y,
    }),
  );
  expect(onModelOptionsChange).not.toHaveBeenCalled();
  await expect
    .element(screen.container.querySelector<HTMLElement>("[data-cosmic-level-heading]"))
    .toHaveTextContent("Thinking · High");

  track.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: bounds.left + 8,
      clientY: y,
    }),
  );
  expect(onModelOptionsChange).not.toHaveBeenCalled();

  track.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: bounds.left + 8,
      clientY: y,
    }),
  );
  expect(onModelOptionsChange).toHaveBeenCalledOnce();
  await expect
    .element(screen.getByRole("radio", { name: "Low" }))
    .toHaveAttribute("aria-checked", "true");

  // Cancelled drag reverts preview without emitting an extra commit.
  track.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 2,
      clientX: bounds.left + 8,
      clientY: y,
    }),
  );
  track.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 2,
      clientX: bounds.left + bounds.width * 0.9,
      clientY: y,
    }),
  );
  track.dispatchEvent(
    new PointerEvent("pointercancel", {
      bubbles: true,
      isPrimary: true,
      pointerId: 2,
    }),
  );
  expect(onModelOptionsChange).toHaveBeenCalledOnce();
  await expect
    .element(screen.getByRole("radio", { name: "Low" }))
    .toHaveAttribute("aria-checked", "true");
});

it("computes effort track segment counts directly from each model's reasoning levels", () => {
  const makeTraits = (
    optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>,
    modelOptions: ReadonlyArray<ProviderOptionSelection> = [],
  ): TraitsSelectionInput => ({
    provider: ProviderDriverKind.make("antigravity"),
    instanceId: ProviderInstanceId.make("antigravity-main"),
    models: [
      {
        slug: "gemini-4-neon",
        name: "Gemini 4 Neon",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors }),
      },
    ],
    model: "gemini-4-neon",
    modelOptions,
    onModelOptionsChange: vi.fn(),
  });

  const fourLevels = [
    {
      id: "thinking_level",
      label: "Thinking",
      type: "select" as const,
      role: "reasoning" as const,
      currentValue: "high",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
    },
  ];
  expect(describeComposerEffort(makeTraits(fourLevels), "bars", "sm").track).toEqual({
    count: 4,
    filled: 3,
  });
  expect(
    describeComposerEffort(
      makeTraits(fourLevels, [{ id: "thinking_level", value: "xhigh" }]),
      "bars",
      "sm",
    ).track,
  ).toEqual({ count: 4, filled: 4 });

  const withOff = [
    {
      id: "effort",
      label: "Reasoning",
      type: "select" as const,
      currentValue: "off",
      options: [
        { id: "off", label: "Off" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
    },
  ];
  expect(describeComposerEffort(makeTraits(withOff), "bars", "sm").track).toEqual({
    count: 3,
    filled: 0,
  });

  const withMax = [
    {
      id: "effort",
      label: "Reasoning",
      type: "select" as const,
      currentValue: "max",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "max", label: "Max" },
      ],
    },
  ];
  expect(describeComposerEffort(makeTraits(withMax), "bars", "sm").track).toEqual({
    count: 3,
    filled: 3,
  });

  expect(
    describeComposerEffort(
      makeTraits([{ id: "thinking", label: "Thinking", type: "boolean", currentValue: true }]),
      "bars",
      "sm",
    ).track,
  ).toEqual({ count: 1, filled: 1 });
  expect(
    describeComposerEffort(
      makeTraits([{ id: "thinking", label: "Thinking", type: "boolean", currentValue: false }]),
      "bars",
      "sm",
    ).track,
  ).toEqual({ count: 1, filled: 0 });
});

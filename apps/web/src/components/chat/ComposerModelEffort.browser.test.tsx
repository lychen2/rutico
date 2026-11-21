import {
  ProviderDriverKind,
  ProviderInstanceId,
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
  const track = popup.querySelector<HTMLElement>(".composer-effort-studio-track")!;
  const lens = track.querySelector<HTMLElement>(".composer-effort-studio-lens")!;
  expect(getComputedStyle(track).backgroundImage).not.toBe("none");
  expect(getComputedStyle(lens).transitionDuration).toBe("0.22s");
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
  const session = cdp();
  try {
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    expect(getComputedStyle(lens).transitionDuration).toBe("0s");
    expect(getComputedStyle(popup).transitionDuration).toBe("0s");
    const high = lens.getBoundingClientRect().left;
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
    expect(lens.getBoundingClientRect().left).toBeLessThan(high);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
  await permission.click();
  await page.getByRole("menuitemradio", { name: /Full access/ }).click();
  await expect
    .element(page.getByRole("button", { name: "Permissions: Full access" }))
    .toBeVisible();
  await page.viewport(360, 520);
  await vi.waitFor(() => {
    const bounds = popup.getBoundingClientRect();
    expect(bounds.width).toBeLessThanOrEqual(336);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(360);
    expect(track.getBoundingClientRect().width).toBeGreaterThan(250);
  });
});

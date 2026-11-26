import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { testUiLocale } from "../../../test/uiLocale";
import { applyThemePalette } from "../../themePalette";
import { saveUsagePagePreferences } from "./usagePagePreferences";
import "~/index.css";
import "./usagePresentation.css";

const state = vi.hoisted(() => ({
  refreshProviders: vi.fn(async () => ({ _tag: "Success" as const, value: undefined })),
  refreshUsageLimits: vi.fn(async (_environmentId: EnvironmentId, _automatic?: boolean) => {}),
  presentationsAtom: null as unknown as Atom.Writable<Map<EnvironmentId, unknown>>,
  presentationsWithProvidersAtom: null as unknown as Atom.Writable<Map<EnvironmentId, unknown>>,
}));

vi.mock(import("../AppRouteModal"), (() => ({
  AppRouteModal: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-app-modal>{children}</div>
  ),
  AppRouteModalClose: () => null,
})) as never);

vi.mock(import("../../hooks/useTheme"), async (original) => {
  const actual = await original();
  return { ...actual, useTheme: () => ({ ...actual.useTheme(), theme: "apple" as const }) };
});

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));

vi.mock(import("../../state/presentation"), (async (
  original: () => Promise<typeof import("../../state/presentation")>,
) => {
  const actual = await original();
  return {
    ...actual,
    environmentPresentations: {
      ...actual.environmentPresentations,
      get presentationsAtom() {
        return state.presentationsAtom;
      },
      get presentationsWithProvidersAtom() {
        return state.presentationsWithProvidersAtom;
      },
    },
  };
}) as never);

vi.mock(import("../../state/use-atom-command"), (() => ({
  useAtomCommand: () => state.refreshProviders,
})) as never);

vi.mock(import("@t3tools/client-runtime/state/usage"), (async (
  original: () => Promise<typeof import("@t3tools/client-runtime/state/usage")>,
) => ({
  ...(await original()),
  refreshUsageLimits: (
    environmentId: EnvironmentId,
    refresh: () => Promise<unknown>,
    automatic?: boolean,
  ) => {
    void state.refreshUsageLimits(environmentId, automatic);
    return refresh();
  },
})) as never);

vi.mock(import("../../state/usage"), (async (
  original: () => Promise<typeof import("../../state/usage")>,
) => ({
  ...(await original()),
  useUsage: () => ({
    merged: {
      costUsd: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      sessions: 0,
      daily: [],
      hourly: [],
      providers: [],
      models: [],
      projects: [],
      duplicateSources: [],
      contractMismatches: [],
      costQuality: { cacheSavingsUsd: 0 },
      categoryCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unsplit: 0 },
      throughput: { byProvider: [] },
    },
    environments: [
      {
        environmentId: EnvironmentId.make("desk"),
        label: "Desk",
        isPending: false,
        canReadDiagnostics: true,
        isConnected: true,
        error: null,
        summary: null,
      },
    ],
    selectedEnvironments: [
      {
        environmentId: EnvironmentId.make("desk"),
        label: "Desk",
        isPending: false,
        canReadDiagnostics: true,
        isConnected: true,
        error: null,
        summary: null,
      },
    ],
    shown: null,
    isPending: false,
    isPartial: false,
    refresh: vi.fn(async () => {}),
  }),
})) as never);

import { UsagePage } from "./UsagePage";
import { UsageResetTimeline } from "./UsageResetTimeline";

function appleLightTheme() {
  const root = document.documentElement;
  const prevThemeId = root.getAttribute("data-theme-id");
  const prevStyle = root.getAttribute("style");
  const prevDark = root.classList.contains("dark");
  applyThemePalette("apple", "light");
  return {
    [Symbol.dispose]() {
      if (prevThemeId === null) root.removeAttribute("data-theme-id");
      else root.setAttribute("data-theme-id", prevThemeId);
      if (prevStyle === null) root.removeAttribute("style");
      else root.setAttribute("style", prevStyle);
      root.classList.toggle("dark", prevDark);
    },
  };
}

function cleanUsageState() {
  state.refreshProviders.mockClear();
  state.refreshUsageLimits.mockClear();
  return {
    [Symbol.dispose]() {
      localStorage.clear();
      state.refreshProviders.mockClear();
      state.refreshUsageLimits.mockClear();
    },
  };
}

describe("UsagePage & UsageResetTimeline self-advancing reset clock", () => {
  it("advances limits display clock across a reset boundary inside UsagePage without re-probing providers", async () => {
    using _cleanup = cleanUsageState();
    using _locale = testUiLocale("en");
    using _theme = appleLightTheme();
    const t0 = Date.parse("2026-11-20T10:00:00.000Z");
    using _timers = fakeTimers({ now: t0 });

    const soonResetAt = new Date(t0 + 15 * 60_000).toISOString();
    const laterResetAt = new Date(t0 + 2 * 86_400_000).toISOString();
    const providers: ServerProvider[] = [
      {
        enabled: true,
        installed: true,
        version: "1",
        status: "ready",
        checkedAt: new Date(t0 - 60_000).toISOString(),
        models: [],
        slashCommands: [],
        skills: [],
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        auth: { status: "authenticated", label: "ChatGPT Pro" },
        usageLimits: {
          checkedAt: new Date(t0 - 60_000).toISOString(),
          windows: [
            {
              id: "session",
              kind: "session",
              label: "5-hour",
              usedPercent: 40,
              windowDurationMins: 300,
              resetsAt: soonResetAt,
            },
            {
              id: "weekly",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 60,
              windowDurationMins: 10080,
              resetsAt: laterResetAt,
            },
          ],
        },
      } as unknown as ServerProvider,
    ];

    const presentation = {
      entry: { target: { label: "Desk" } },
      connection: { phase: "connected" },
      serverConfig: { providers },
    };
    const map = new Map<EnvironmentId, unknown>([[EnvironmentId.make("desk"), presentation]]);
    state.presentationsAtom = Atom.make(map);
    state.presentationsWithProvidersAtom = Atom.make(map);

    saveUsagePagePreferences({ metric: "limits", windowDays: 7, hiddenProviders: [] });

    await using screen = await render(<UsagePage />);
    // Flush initial mount auto-refresh microtasks.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.refreshProviders.mockClear();
    state.refreshUsageLimits.mockClear();

    const timeline = () => screen.container.querySelector<HTMLElement>("[data-reset-calendar]")!;
    expect(timeline()).not.toBeNull();
    expect(timeline().textContent).toContain("Next reset in 15m");
    expect(
      timeline()
        .querySelector<SVGGElement>('[data-timeline-lane="codex"]')
        ?.getAttribute("aria-label"),
    ).toContain("·");

    // Advance 5 minutes: countdown ticks down on its own with 0 provider probes.
    await act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(timeline().textContent).toContain("Next reset in 10m");
    expect(state.refreshProviders).not.toHaveBeenCalled();
    expect(state.refreshUsageLimits).not.toHaveBeenCalled();

    // Advance 11 more minutes (past the 15-minute reset): expired 5-hour event disappears cleanly with 0 probes.
    await act(() => {
      vi.advanceTimersByTime(11 * 60_000);
    });
    expect(timeline().textContent).not.toContain("Next reset in 10m");
    expect(timeline().textContent).toContain("Next reset in 1d 23h");
    // Only the later weekly reset remains in the lane's aria-label (single timestamp, no second event separator).
    const laneAria =
      timeline()
        .querySelector<SVGGElement>('[data-timeline-lane="codex"]')
        ?.getAttribute("aria-label") ?? "";
    expect(laneAria.split(" · ")).toHaveLength(2);
    expect(state.refreshProviders).not.toHaveBeenCalled();
    expect(state.refreshUsageLimits).not.toHaveBeenCalled();
  });

  it("removes the only expired reset event cleanly from standalone UsageResetTimeline as fake clock passes it", async () => {
    using _cleanup = cleanUsageState();
    using _locale = testUiLocale("en");
    using _theme = appleLightTheme();
    const t0 = Date.parse("2026-11-20T10:00:00.000Z");
    using _timers = fakeTimers({ now: t0 });

    const account: LimitAccount = {
      key: "codex-solo",
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      email: undefined,
      plan: "Pro",
      accentColor: undefined,
      environments: [],
      sourceLabel: null,
      redeem: null,
      limits: {
        checkedAt: new Date(t0 - 60_000).toISOString(),
        windows: [
          {
            id: "session",
            kind: "session",
            label: "5-hour",
            usedPercent: 30,
            windowDurationMins: 300,
            resetsAt: new Date(t0 + 10 * 60_000).toISOString(),
          },
        ],
      },
    };
    const pools = collectLimitPools([account], t0);

    await using screen = await render(
      <UsageResetTimeline pools={pools} now={t0} onHighlight={() => {}} v9 />,
    );
    expect(screen.container.querySelector("[data-reset-calendar]")?.textContent).toContain(
      "Next reset in 10m",
    );
    expect(screen.container.querySelectorAll("[data-reset-point]")).toHaveLength(1);

    await act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(screen.container.querySelector("[data-reset-calendar]")?.textContent).toContain(
      "Next reset in 5m",
    );

    await act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(screen.container.querySelector("[data-reset-calendar]")).toBeNull();
    expect(screen.container.querySelectorAll("[data-reset-point]")).toHaveLength(0);
  });
});

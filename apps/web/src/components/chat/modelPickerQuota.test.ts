import {
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { modelPickerQuotaRemaining } from "./modelPickerQuota";

const CHECKED_AT = "2026-09-03T12:00:00.000Z";
const NOW = Date.parse(CHECKED_AT);
const SESSION = { id: "primary", kind: "session", label: "Session", usedPercent: 12 } as const;
const WEEKLY = { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 70 } as const;
const LIMITS: ServerProviderUsageLimits = { checkedAt: CHECKED_AT, windows: [SESSION, WEEKLY] };
const NATIVE: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex-work"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: "work@example.com" },
  checkedAt: CHECKED_AT,
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: LIMITS,
};
const PROXY: ServerProvider = {
  ...NATIVE,
  driver: ProviderDriverKind.make("claudeAgent"),
  auth: { status: "authenticated", type: "customEndpoint", endpoint: "https://proxy.example" },
};
const HUB: UsageLimitSourceSnapshot = {
  id: UsageLimitSourceId.make("hub"),
  kind: "cliproxy",
  label: "Hub",
  origin: "https://proxy.example",
  checkedAt: CHECKED_AT,
  accounts: [
    {
      id: "account-a",
      driver: NATIVE.driver,
      models: ["model-a"],
      usageLimits: { ...LIMITS, windows: [{ ...WEEKLY, usedPercent: 87 }] },
    },
    {
      id: "account-b",
      driver: NATIVE.driver,
      models: ["model-b"],
      usageLimits: { ...LIMITS, windows: [{ ...WEEKLY, usedPercent: 25 }] },
    },
  ],
};

it("uses the native instance's applicable weekly window without borrowing a hub account", () => {
  const input = { sources: [HUB], model: "model-a", now: NOW };
  expect(modelPickerQuotaRemaining({ ...input, provider: NATIVE })).toBe(30);
  const limits = { ...LIMITS, windows: [SESSION, { ...WEEKLY, modelIds: ["model-b"] }] };
  expect(
    modelPickerQuotaRemaining({ ...input, provider: { ...NATIVE, usageLimits: limits } }),
  ).toBe(88);
  const { usageLimits: _limits, ...withoutLimits } = NATIVE;
  expect(modelPickerQuotaRemaining({ ...input, provider: withoutLimits })).toBeNull();
});

it("uses the matching hub's actual model route, even when the account driver differs", () => {
  const unrelated = {
    ...HUB,
    id: UsageLimitSourceId.make("other"),
    origin: "https://other.example",
  };
  const input = { provider: PROXY, sources: [unrelated, HUB], now: NOW };
  expect(modelPickerQuotaRemaining({ ...input, model: "model-a(high)[1m]" })).toBe(13);
  expect(modelPickerQuotaRemaining({ ...input, model: "model-b" })).toBe(75);
  expect(modelPickerQuotaRemaining({ ...input, model: "unknown-alias" })).toBeNull();
  expect(
    modelPickerQuotaRemaining({ ...input, sources: [unrelated], model: "model-a" }),
  ).toBeNull();
});

it("omits ambiguous and failed proxy reads instead of picking the first available account", () => {
  const [account] = HUB.accounts;
  const duplicate = { ...account!, id: "another-account" };
  const input = { provider: PROXY, model: "model-a", now: NOW };
  expect(
    modelPickerQuotaRemaining({
      ...input,
      sources: [{ ...HUB, accounts: [...HUB.accounts, duplicate] }],
    }),
  ).toBeNull();
  expect(
    modelPickerQuotaRemaining({ ...input, sources: [{ ...HUB, error: "Probe failed" }] }),
  ).toBeNull();
});

it("omits expired, stale, and unavailable readings while retaining a real zero", () => {
  const input = { provider: NATIVE, sources: [], model: "model-a", now: NOW };
  expect(modelPickerQuotaRemaining({ ...input, now: NOW + 600_001 })).toBeNull();
  for (const usageLimits of [
    { ...LIMITS, windows: [{ ...WEEKLY, resetsAt: CHECKED_AT }] },
    { ...LIMITS, unavailable: { reason: "probeFailed" as const } },
  ]) {
    expect(
      modelPickerQuotaRemaining({ ...input, provider: { ...NATIVE, usageLimits } }),
    ).toBeNull();
  }
  const spent = { ...LIMITS, windows: [{ ...WEEKLY, usedPercent: 100 }] };
  expect(modelPickerQuotaRemaining({ ...input, provider: { ...NATIVE, usageLimits: spent } })).toBe(
    0,
  );
});

it("prefers the tightest matching Claude weekly window so a model-specific limit is not masked by the account window", () => {
  const claudeProvider: ServerProvider = {
    ...NATIVE,
    instanceId: ProviderInstanceId.make("claude"),
    driver: ProviderDriverKind.make("claudeAgent"),
    usageLimits: {
      checkedAt: CHECKED_AT,
      windows: [
        { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 18.4 },
        { id: "seven_day_fable", kind: "weekly", label: "Weekly · Fable", usedPercent: 100 },
      ],
    },
  };
  expect(
    modelPickerQuotaRemaining({
      provider: claudeProvider,
      sources: [],
      model: "claude-fable-5",
      now: NOW,
    }),
  ).toBe(0);
  expect(
    modelPickerQuotaRemaining({
      provider: claudeProvider,
      sources: [],
      model: "claude-sonnet-4-6",
      now: NOW,
    }),
  ).toBe(82);
});

it("keeps Antigravity Argon and Carbon pools independent in model picker quota", () => {
  const agProvider: ServerProvider = {
    ...NATIVE,
    instanceId: ProviderInstanceId.make("antigravity"),
    driver: ProviderDriverKind.make("antigravity"),
    usageLimits: {
      checkedAt: CHECKED_AT,
      windows: [
        { id: "gemini-argon-weekly", kind: "weekly", label: "Argon · Weekly", usedPercent: 100 },
        { id: "gemini-carbon-weekly", kind: "weekly", label: "Carbon · Weekly", usedPercent: 15 },
      ],
    },
  };
  expect(
    modelPickerQuotaRemaining({
      provider: agProvider,
      sources: [],
      model: "gemini-4-argon",
      now: NOW,
    }),
  ).toBe(0);
  expect(
    modelPickerQuotaRemaining({
      provider: agProvider,
      sources: [],
      model: "gemini-4-carbon",
      now: NOW,
    }),
  ).toBe(85);
  expect(
    modelPickerQuotaRemaining({ provider: agProvider, sources: [], model: "carbon", now: NOW }),
  ).toBe(85);
});

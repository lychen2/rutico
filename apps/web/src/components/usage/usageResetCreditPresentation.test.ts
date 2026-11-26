import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { resetCreditConfirmToken } from "./UsageLimitsPooled";
import { t3LimitWindows, quotaForecastState } from "./usageQuotaPresentation";
import {
  resetAdvanceLabel,
  resetAffectedWindows,
  resetCreditChoices,
} from "./usageResetCreditPresentation";

it("excludes Antigravity shared buckets from minimum and forecast using usage_limits-shaped windows", () => {
  const now = Date.parse("2026-11-17T16:00:00Z");
  const account: LimitAccount = {
    key: "google",
    driver: ProviderDriverKind.make("antigravity"),
    displayName: "Google",
    email: undefined,
    plan: "Google AI Pro",
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: {
      checkedAt: new Date(now).toISOString(),
      windows: [
        {
          id: "gemini-weekly",
          kind: "weekly",
          label: "Gemini · Weekly",
          usedPercent: 3,
          windowDurationMins: 10080,
          resetsAt: new Date(now + 3 * 86400000).toISOString(),
        },
        {
          id: "gemini-5h",
          kind: "session",
          label: "Gemini · 5-hour",
          usedPercent: 1,
          windowDurationMins: 300,
          resetsAt: new Date(now + 2 * 3600000).toISOString(),
        },
        {
          id: "3p-weekly",
          kind: "weekly",
          label: "Claude & GPT (shared) · Weekly",
          usedPercent: 100,
          windowDurationMins: 10080,
          resetsAt: new Date(now + 3 * 86400000).toISOString(),
        },
      ],
    },
  };
  const pool = collectLimitPools([account], now)[0]!;
  const usable = t3LimitWindows(pool);
  expect(usable.map((w) => w.id)).toEqual(["gemini-5h", "gemini-weekly"]);
  expect(Math.min(...usable.map((w) => w.remainingPercent))).toBe(97);
  expect(
    quotaForecastState(
      usable.flatMap((w) => w.members.map((m) => m.window)),
      now,
    ),
  ).toBe("ample");
});
it("defaults to earliest available expiry and never claims a partial Fable reset refills the whole week", () => {
  const now = Date.parse("2026-11-17T16:00:00Z");
  const credits = {
    availableCount: 3,
    options: [
      {
        creditId: "weekly",
        label: "Weekly reset",
        description: "Refills your weekly limit.",
        availableCount: 1,
        expiresAt: "2026-12-05T00:00:00Z",
      },
      {
        creditId: "session",
        label: "5-hour reset",
        description: "Refills your 5-hour limit.",
        availableCount: 2,
        expiresAt: "2026-11-24T00:00:00Z",
      },
    ],
  };
  const choices = resetCreditChoices(
    credits,
    { instanceId: ProviderInstanceId.make("claude") },
    now,
  );
  expect(choices.map((c) => c.key)).toEqual(["session", "weekly"]);
  const windows = [
    { id: "5h", kind: "session" as const, label: "5-hour", usedPercent: 100 },
    { id: "week", kind: "weekly" as const, label: "Weekly", usedPercent: 88 },
  ];
  expect(resetAffectedWindows(choices[0]!, credits, windows).map((w) => w.id)).toEqual(["5h"]);
  const partial = { ...credits, options: [{ ...credits.options[0]!, label: "Fable reset" }] };
  expect(resetAffectedWindows(choices[1]!, partial, windows)).toEqual([]);
  const claudeScoped = [
    ...windows,
    { id: "seven_day_fable", kind: "weekly" as const, label: "Weekly · Fable", usedPercent: 100 },
  ];
  expect(resetAffectedWindows(choices[1]!, partial, claudeScoped).map((w) => w.id)).toEqual([
    "seven_day_fable",
  ]);
  // Codex no-options fallback must not claim to reset monthly credit limits ("individual").
  const codexCredits = { availableCount: 1 };
  const codexChoice = resetCreditChoices(
    codexCredits,
    { instanceId: ProviderInstanceId.make("codex") },
    now,
  )[0]!;
  const codexWindows = [
    { id: "primary", kind: "session" as const, label: "5-hour", usedPercent: 80 },
    { id: "secondary", kind: "weekly" as const, label: "Weekly", usedPercent: 60 },
    { id: "individual", kind: "monthly" as const, label: "Monthly credit limit", usedPercent: 40 },
  ];
  expect(resetAffectedWindows(codexChoice, codexCredits, codexWindows).map((w) => w.id)).toEqual([
    "primary",
    "secondary",
  ]);
});

it("formats reset advance in days starting at 48 hours and hours below that", () => {
  const now = Date.parse("2026-11-17T16:00:00Z");
  for (const [hours, expected] of [
    [120, "about 5 days earlier"],
    [48, "about 2 days earlier"],
    [47.9, "about 48 hours earlier"],
    [2, "about 2 hours earlier"],
    [-1, "about 0 hours earlier"],
  ] as const) {
    expect(resetAdvanceLabel(new Date(now + hours * 3600000).toISOString(), now)).toBe(expected);
  }
});

it("binds Codex 'next' reset credit confirmation to environment, account, instance, and credit state so exhausting account A cancels confirmation for account B", () => {
  const now = Date.parse("2026-11-17T16:00:00Z");
  const makeCodexAccount = (id: string, envId: string, availableCount: number) => {
    const account = {
      key: `${envId}:${id}`,
      limits: {
        checkedAt: new Date(now).toISOString(),
        windows: [],
        resetCredits: { availableCount, nextExpiresAt: "2026-12-01T00:00:00Z" },
      },
      redeem: {
        environmentId: EnvironmentId.make(envId),
        input: { instanceId: ProviderInstanceId.make(id) },
      },
    };
    const choice = resetCreditChoices(account.limits.resetCredits, account.redeem.input, now)[0]!;
    return { account, choice };
  };
  const a = makeCodexAccount("codex-a", "env-1", 1);
  const b = makeCodexAccount("codex-b", "env-1", 1);
  // Both native Codex accounts produce the same choice key "next", but distinct confirm tokens.
  expect(a.choice.key).toBe("next");
  expect(b.choice.key).toBe("next");
  expect(resetCreditConfirmToken(a.account, a.choice)).not.toBe(
    resetCreditConfirmToken(b.account, b.choice),
  );
  // Even on the same account, a change in availableCount (credit consumed externally) invalidates confirmation.
  const aAfterOtherDevice = makeCodexAccount("codex-a", "env-1", 2);
  expect(resetCreditConfirmToken(a.account, a.choice)).not.toBe(
    resetCreditConfirmToken(aAfterOtherDevice.account, aAfterOtherDevice.choice),
  );
});

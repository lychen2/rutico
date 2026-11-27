import { testUiLocale } from "../../../test/uiLocale";
import { expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import {
  USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS,
  USAGE_LIMITS_STALE_AFTER_MS,
  isProviderUsageLimitsFresh,
  needsAutomaticUsageLimitsRefresh,
} from "@t3tools/shared/usageLimits";
import {
  quotaForecast,
  quotaForecastState,
  quotaWindowLabel,
  quotaReadingStale,
  quotaReadingLabel,
} from "./usageQuotaPresentation";
const now = Date.parse("2026-11-16T12:00:00Z");
function window(usedPercent: number, elapsed: number): ServerProviderUsageWindow {
  return {
    id: "weekly",
    kind: "weekly",
    label: "Weekly",
    usedPercent,
    windowDurationMins: 1000,
    resetsAt: new Date(now + (1 - elapsed) * 1000 * 60000).toISOString(),
  };
}
it("uses forecast and remaining quota, with no prediction during the first twelve percent", () => {
  using _locale = testUiLocale("zh-CN");
  expect(quotaForecastState([window(51, 0.24)], now)).toBe("early");
  expect(quotaForecastState([window(40, 0.8)], now)).toBe("ample");
  expect(quotaForecastState([window(74, 0.8)], now)).toBe("tight");
  expect(quotaForecastState([window(20, 0.1)], now)).toBe("ample");
  expect(quotaForecastState([window(91, 0.95)], now)).toBe("early");
});
it("translates compound quota windows without losing the model name", () => {
  using _locale = testUiLocale("zh-CN");
  expect(quotaWindowLabel("Weekly · Fable", true)).toBe("本周 · Fable");
  expect(quotaWindowLabel("Gemini · 5-hour", true)).toBe("Gemini · 5 小时");
  expect(quotaWindowLabel("Claude & GPT (shared) · Weekly", true)).toBe("Claude/GPT 共用 · 本周");
});

it("rejects stale, missing and failed readings before forecasting", () => {
  using _locale = testUiLocale("zh-CN");
  const current = { checkedAt: new Date(now).toISOString(), windows: [] };
  expect(quotaReadingStale(current, now)).toBe(false);
  expect(quotaReadingStale(current, now + USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS)).toBe(false);
  expect(quotaReadingStale(current, now + USAGE_LIMITS_STALE_AFTER_MS + 1)).toBe(true);
  expect(quotaReadingStale({ ...current, unavailable: { reason: "probeFailed" } }, now)).toBe(true);
  expect(quotaReadingStale(current, now, false)).toBe(true);
  expect(quotaReadingStale(undefined, now)).toBe(true);
  expect(quotaReadingLabel(current)).toMatch(/^上次读数 \d{2}:\d{2} · 暂不预测$/);
});

it("checks 30-minute persisted quota freshness across active providers and sources", () => {
  const checkedAt = new Date(now).toISOString();
  const staleAt = new Date(now - USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS).toISOString();
  const validLimits = {
    checkedAt,
    windows: [{ id: "gemini-5h", kind: "session" as const, label: "Gemini", usedPercent: 12 }],
  };
  expect(isProviderUsageLimitsFresh(undefined, now)).toBe(false);
  expect(isProviderUsageLimitsFresh({ ...validLimits, checkedAt: staleAt }, now)).toBe(false);
  expect(
    isProviderUsageLimitsFresh({ ...validLimits, unavailable: { reason: "probeFailed" } }, now),
  ).toBe(false);
  expect(
    isProviderUsageLimitsFresh(
      { checkedAt, windows: [], unavailable: { reason: "unsupported" } },
      now,
    ),
  ).toBe(true);
  expect(
    isProviderUsageLimitsFresh(validLimits, now + USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS - 1),
  ).toBe(true);

  const makeProvider = (overrides: Partial<ServerProvider>): ServerProvider => ({
    instanceId: ProviderInstanceId.make("antigravity"),
    driver: ProviderDriverKind.make("antigravity"),
    enabled: true,
    installed: true,
    version: "1.5.18",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  });

  // Cold Antigravity (usageLimits undefined) requires an automatic probe.
  expect(needsAutomaticUsageLimitsRefresh({ providers: [makeProvider({})] }, now)).toBe(true);
  // Fresh Antigravity + OMP (no quota limits on OMP) needs no automatic refresh.
  expect(
    needsAutomaticUsageLimitsRefresh(
      {
        providers: [
          makeProvider({ usageLimits: validLimits }),
          makeProvider({
            instanceId: ProviderInstanceId.make("OMP"),
            driver: ProviderDriverKind.make("omp"),
          }),
        ],
      },
      now + 10 * 60_000,
    ),
  ).toBe(false);
  // Stale (>30m) or failed Antigravity triggers an automatic refresh.
  expect(
    needsAutomaticUsageLimitsRefresh(
      { providers: [makeProvider({ usageLimits: validLimits })] },
      now + USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS,
    ),
  ).toBe(true);
  expect(
    needsAutomaticUsageLimitsRefresh(
      {
        providers: [
          makeProvider({
            usageLimits: { ...validLimits, unavailable: { reason: "probeFailed" } },
          }),
        ],
      },
      now,
    ),
  ).toBe(true);
  // OMP alone has no quota probes or sources, so auto-refresh is unnecessary.
  expect(
    needsAutomaticUsageLimitsRefresh(
      {
        providers: [
          makeProvider({
            instanceId: ProviderInstanceId.make("OMP"),
            driver: ProviderDriverKind.make("omp"),
          }),
        ],
      },
      now,
    ),
  ).toBe(false);
  // Fresh source passes; failed source triggers refresh.
  expect(
    needsAutomaticUsageLimitsRefresh(
      {
        providers: [makeProvider({ usageLimits: validLimits })],
        usageLimitSources: [
          {
            id: UsageLimitSourceId.make("hub"),
            kind: "cliproxy",
            label: "Hub",
            checkedAt,
            accounts: [],
          },
        ],
      },
      now,
    ),
  ).toBe(false);
  expect(
    needsAutomaticUsageLimitsRefresh(
      {
        providers: [makeProvider({ usageLimits: validLimits })],
        usageLimitSources: [
          {
            id: UsageLimitSourceId.make("hub"),
            kind: "cliproxy",
            label: "Hub",
            checkedAt,
            error: "offline",
            accounts: [],
          },
        ],
      },
      now,
    ),
  ).toBe(true);
});

it("uses exact elapsed time for one consistent run-out instant, including fractional percentages", () => {
  using _locale = testUiLocale("zh-CN");
  const reading = window(80, 0.1837);
  const forecast = quotaForecast(reading, now);
  expect(forecast.elapsed).toBeCloseTo(0.1837, 12);
  expect(forecast.runOutAt).toBeCloseTo(now + 20 / (80 / (0.1837 * 1000 * 60_000)), 0);
  expect(forecast.projected).toBeCloseTo(80 / 0.1837, 10);
  expect(quotaForecast(window(20, 0.12), now).runOutAt).toBeNull();
  expect(
    quotaForecast({ ...reading, resetsAt: new Date(now).toISOString() }, now).runOutAt,
  ).toBeNull();
  expect(quotaForecast({ ...reading, windowDurationMins: undefined }, now).runOutAt).toBeNull();
});

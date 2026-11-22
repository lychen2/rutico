import type { ServerProvider, UsageLimitSourceSnapshots } from "@t3tools/contracts";
import {
  antigravityWindowLimitsModel,
  hubRoutes,
  instanceHubs,
  remainingPercent,
} from "@t3tools/shared/usageLimits";

const MAX_READING_AGE_MS = 10 * 60_000;
const CLAUDE_SCOPED_WEEKLY_PREFIX = "seven_day_";

/** A single account's applicable weekly window, or its first applicable window. */
export function modelPickerQuotaRemaining({
  provider,
  sources,
  model,
  now,
}: {
  provider: ServerProvider;
  sources: UsageLimitSourceSnapshots;
  model: string;
  now: number;
}) {
  if (provider.auth.status === "unauthenticated") return null;

  let limits = provider.usageLimits;
  let driver = provider.driver;
  let slug = model.replace(/\[1m\]$/i, "");
  if (provider.auth.endpoint !== undefined || provider.auth.type === "customEndpoint") {
    // A probe for the local driver login does not identify the account used by a proxy.
    const hubs = instanceHubs(provider, sources);
    const [hub] = hubs;
    if (hubs.length !== 1 || !hub || hub.error) return null;
    const accounts = hub.accounts.filter(hubRoutes(hubs, driver, slug));
    const [account] = accounts;
    const base = slug.replace(/\([^)]*\)$/, "");
    // Reports can list several candidates or fall back by driver for an unlisted model.
    // Neither case identifies a single account whose remaining percentage we can show.
    if (accounts.length !== 1 || !account?.models) return null;
    const routedModel = account.models.includes(base) ? base : slug;
    if (!account.models.includes(routedModel)) return null;
    slug = routedModel;
    limits = account.usageLimits;
    driver = account.driver;
  }
  if (!limits || limits.unavailable) return null;
  const checkedAt = Date.parse(limits.checkedAt);
  if (!Number.isFinite(checkedAt) || now - checkedAt > MAX_READING_AGE_MS) return null;

  const providerId = slug.split("/", 1)[0] ?? "";
  const windows = limits.windows.filter((window) => {
    if (window.modelIds && !window.modelIds.includes(slug)) return false;
    if (window.providerIds && !window.providerIds.includes(providerId)) return false;
    if (driver === "opencode" && window.id.startsWith("go_")) return providerId === "opencode-go";
    if (driver === "antigravity") {
      const base = slug.slice(slug.lastIndexOf("/") + 1);
      return /^(gemini|claude|gpt)/.test(base) && antigravityWindowLimitsModel(window, slug);
    }
    if (
      (driver === "claudeAgent" || driver === "claude") &&
      window.id.startsWith(CLAUDE_SCOPED_WEEKLY_PREFIX)
    ) {
      return slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .includes(window.id.slice(CLAUDE_SCOPED_WEEKLY_PREFIX.length));
    }
    return true;
  });
  const window = windows.find((candidate) => candidate.kind === "weekly") ?? windows[0];
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  if (window.resetsAt !== undefined && !(Date.parse(window.resetsAt) > now)) return null;
  return remainingPercent(window);
}

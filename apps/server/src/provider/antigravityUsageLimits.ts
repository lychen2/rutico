import type { AntigravitySettings, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import {
  prepareAntigravityCliUsageKeyringState,
  type LinuxKeyringLockState,
} from "./antigravityKeyringGuard.ts";

export function antigravityUserAgent(platform: NodeJS.Platform, architecture: NodeJS.Architecture) {
  return `antigravity/hub/2.24.0 (aidev_client; os_type=${platform}; arch=${architecture}; cl=963137146)`;
}

const SUMMARY_WINDOW_MINS = new Map([
  ["5h", 5 * 60],
  ["weekly", 7 * 24 * 60],
]);
const CLI_USAGE_TIMEOUT = "20 seconds";
const CLI_USAGE_MAX_STDOUT_BYTES = 1024 * 1024;
const SANITIZED_CLI_ENV_KEYS = new Set([
  "GEMINI_HOME",
  "SSH_CONNECTION",
  "AGY_ACP_FORCE_FILE_STORAGE",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "BROWSER",
  "TMPDIR",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "CLOUDSDK_CORE_PROJECT",
]);

const UserInfo = Schema.Struct({ id: Schema.NonEmptyString });
const Quota = Schema.Struct({
  remainingFraction: Schema.optional(Schema.Number),
  resetTime: Schema.optional(Schema.String),
});
const Bucket = Schema.Struct({
  ...Quota.fields,
  bucketId: Schema.NonEmptyString,
  window: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
});
const Summary = Schema.Struct({
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        displayName: Schema.optional(Schema.String),
        buckets: Schema.optional(Schema.Array(Bucket)),
      }),
    ),
  ),
  buckets: Schema.optional(Schema.Array(Bucket)),
});

const CliUsageBucket = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remaining_fraction: Schema.optional(Schema.NullOr(Schema.Number)),
  reset_time: Schema.optional(Schema.NullOr(Schema.String)),
  disabled: Schema.optional(Schema.Boolean),
});
const CliUsageGroup = Schema.Struct({
  name: Schema.optional(Schema.String),
  buckets: Schema.optional(Schema.Array(CliUsageBucket)),
});
const CliUsageOutput = Schema.Struct({
  status: Schema.String,
  error: Schema.optional(Schema.String),
  response: Schema.optional(Schema.String),
  command: Schema.optional(
    Schema.Struct({
      name: Schema.Literal("usage"),
      data: Schema.Struct({
        groups: Schema.optional(Schema.Array(CliUsageGroup)),
        buckets: Schema.optional(Schema.Array(CliUsageBucket)),
      }),
    }),
  ),
});

const decodeUserInfo = Schema.decodeUnknownEffect(UserInfo);
const decodeSummary = Schema.decodeUnknownEffect(Summary);
const decodeCliUsageOutput = Schema.decodeEffect(Schema.fromJsonString(CliUsageOutput));

function iso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const epochMs = Date.parse(value);
  // Untouched buckets in `agy -p "/usage"` report Unix epoch 0 (`1970-01-01T00:00:00Z`).
  if (!Number.isFinite(epochMs) || epochMs <= 0) return undefined;
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : undefined;
}

function quotaWindow(
  id: string,
  label: string,
  quota: typeof Quota.Type,
  kind: ServerProviderUsageWindow["kind"] = "other",
  windowDurationMins?: number,
): ServerProviderUsageWindow | undefined {
  if (quota.remainingFraction === undefined || !Number.isFinite(quota.remainingFraction)) {
    return undefined;
  }
  const resetsAt = iso(quota.resetTime);
  return {
    id,
    label,
    kind,
    usedPercent: (1 - Math.max(0, Math.min(1, quota.remainingFraction))) * 100,
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
  };
}

function summaryResetTime(
  bucket: typeof Bucket.Type,
  windowDurationMins: number | undefined,
  requestedAt: number,
): string | undefined {
  // Untouched summary buckets report a rolling full-window reset or Unix epoch 0.
  const resetMs = Date.parse(bucket.resetTime ?? "");
  if (!Number.isFinite(resetMs) || resetMs <= 0) return undefined;
  const untouched =
    bucket.remainingFraction === 1 &&
    bucket.description === undefined &&
    windowDurationMins !== undefined &&
    Math.abs(resetMs - requestedAt - windowDurationMins * 60_000) <= 60_000;
  return untouched ? undefined : bucket.resetTime;
}

const sha256 = Effect.fnUntraced(function* (text: string) {
  const digest = yield* (yield* Digest.Digest).digest(
    Digest.sha256,
    new TextEncoder().encode(text),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
});

/** Keys an account by its Google ID, which matches across machines and hubs; refresh tokens do not. */
export const antigravityAccountFingerprint = (userInfo: unknown) =>
  decodeUserInfo(userInfo).pipe(Effect.flatMap((info) => sha256(`google-account\0${info.id}`)));

/** Windows from a `retrieveUserQuotaSummary` answer requested at `requestedAt`. */
export const antigravitySummaryWindows = (response: unknown, requestedAt: number) =>
  decodeSummary(response).pipe(Effect.map((summary) => summaryWindows(summary, requestedAt)));

function summaryWindows(summary: typeof Summary.Type, requestedAt: number) {
  const windows = new Map<string, ServerProviderUsageWindow>();
  const groups = summary.groups?.some((group) => group.buckets?.length)
    ? summary.groups
    : [{ buckets: summary.buckets }];
  for (const group of groups ?? []) {
    for (const bucket of group.buckets ?? []) {
      if (bucket.disabled) continue;
      // Argon and Carbon are metered separately from the default Gemini buckets.
      const family = bucket.bucketId.startsWith("gemini-argon-")
        ? group.displayName?.trim() || "Gemini Argon"
        : bucket.bucketId.startsWith("gemini-carbon-")
          ? group.displayName?.trim() || "Gemini Carbon"
          : bucket.bucketId.startsWith("gemini-")
            ? "Gemini"
            : bucket.bucketId.startsWith("3p-")
              ? "Claude & GPT (shared)"
              : group.displayName?.trim() || bucket.bucketId;
      const weekly = bucket.window === "weekly";
      const session = bucket.window === "5h";
      const windowDurationMins = SUMMARY_WINDOW_MINS.get(bucket.window ?? "");
      const window = quotaWindow(
        bucket.bucketId,
        `${family} · ${weekly ? "Weekly" : session ? "5-hour" : bucket.displayName?.trim() || "Quota"}`,
        { ...bucket, resetTime: summaryResetTime(bucket, windowDurationMins, requestedAt) },
        weekly ? "weekly" : session ? "session" : "other",
        windowDurationMins,
      );
      if (window) windows.set(window.id, window);
    }
  }
  return [...windows.values()];
}

/** Parse official `agy -p "/usage" --output-format json` stdout into provider usage windows. */
export const parseAntigravityCliUsageOutput = Effect.fn("parseAntigravityCliUsageOutput")(
  function* (rawStdout: string, requestedAt: number) {
    const trimmed = rawStdout.trim();
    const jsonStart = trimmed.indexOf("{");
    const payload = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;
    const parsed = yield* decodeCliUsageOutput(payload);
    if (parsed.status !== "SUCCESS" || !parsed.command) {
      return [];
    }
    const groups = parsed.command.data.groups?.map((group) => ({
      ...(group.name === undefined ? {} : { displayName: group.name }),
      buckets: (group.buckets ?? []).map((bucket) => ({
        bucketId: bucket.id,
        ...(bucket.name === undefined ? {} : { displayName: bucket.name }),
        ...(bucket.description === undefined ? {} : { description: bucket.description }),
        ...(bucket.window === undefined ? {} : { window: bucket.window }),
        ...(bucket.remaining_fraction == null
          ? {}
          : { remainingFraction: bucket.remaining_fraction }),
        ...(bucket.reset_time == null ? {} : { resetTime: bucket.reset_time }),
        ...(bucket.disabled === undefined ? {} : { disabled: bucket.disabled }),
      })),
    }));
    const buckets = parsed.command.data.buckets?.map((bucket) => ({
      bucketId: bucket.id,
      ...(bucket.name === undefined ? {} : { displayName: bucket.name }),
      ...(bucket.description === undefined ? {} : { description: bucket.description }),
      ...(bucket.window === undefined ? {} : { window: bucket.window }),
      ...(bucket.remaining_fraction == null
        ? {}
        : { remainingFraction: bucket.remaining_fraction }),
      ...(bucket.reset_time == null ? {} : { resetTime: bucket.reset_time }),
      ...(bucket.disabled === undefined ? {} : { disabled: bucket.disabled }),
    }));
    return summaryWindows(
      {
        ...(groups === undefined ? {} : { groups }),
        ...(buckets === undefined ? {} : { buckets }),
      },
      requestedAt,
    );
  },
);

function buildCliUsageEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!SANITIZED_CLI_ENV_KEYS.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  environment.AGY_CLI_DISABLE_AUTO_UPDATE = "1";
  return environment;
}

const collectStdout = Effect.fn("AntigravityUsageProbe.collectStdout")(function* (
  stream: ChildProcessSpawner.ChildProcessHandle["stdout"],
) {
  let totalBytes = 0;
  const chunks: Array<Uint8Array> = [];
  yield* Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => {
      if (totalBytes >= CLI_USAGE_MAX_STDOUT_BYTES) return;
      const remaining = CLI_USAGE_MAX_STDOUT_BYTES - totalBytes;
      const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(slice);
      totalBytes += slice.byteLength;
    }),
  );
  return new TextDecoder().decode(Buffer.concat(chunks, totalBytes));
});

/**
 * Reads Antigravity quota via the official `agy -p "/usage" --output-format json` CLI command.
 * Never reads OAuth tokens, OS keyrings, Windows Credential Manager, or Google endpoints directly.
 */
export const makeAntigravityUsageProbe = Effect.fn("makeAntigravityUsageProbe")(function* <
  ResolveError = never,
  ProbeCwdError = never,
>(input: {
  readonly authMethod: AntigravitySettings["authMethod"];
  readonly resolveExecutable: Effect.Effect<{ readonly executablePath: string }, ResolveError>;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly makeProbeCwd?: Effect.Effect<string, ProbeCwdError, Scope.Scope>;
  readonly platform?: NodeJS.Platform;
  readonly userHome?: string;
  readonly probeKeyringLockState?: (
    environment: NodeJS.ProcessEnv,
  ) => Effect.Effect<LinuxKeyringLockState, never, ChildProcessSpawner.ChildProcessSpawner>;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fsOption = yield* Effect.serviceOption(FileSystem.FileSystem);
  const pathOption = yield* Effect.serviceOption(Path.Path);
  const hostPlatformOption = yield* Effect.serviceOption(HostProcess.Platform);

  const read = Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    if (input.authMethod !== "oauth-personal" && input.authMethod !== "oauth-business") {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    const cliEnv = buildCliUsageEnvironment(input.environment);
    if (Option.isSome(fsOption) && Option.isSome(pathOption)) {
      const userHome = input.userHome ?? cliEnv.HOME ?? "";
      const platform =
        input.platform ??
        Option.getOrElse(hostPlatformOption, (): NodeJS.Platform =>
          HostProcess.Platform.defaultValue(),
        );
      const keyringState = yield* prepareAntigravityCliUsageKeyringState({
        platform,
        userHome,
        environment: cliEnv,
        authMethod: input.authMethod,
        ...(input.probeKeyringLockState ? { probeLockState: input.probeKeyringLockState } : {}),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fsOption.value),
        Effect.provideService(Path.Path, pathOption.value),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (keyringState === "locked") {
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "OS keyring is locked. Unlock your keyring and refresh Antigravity usage.",
        });
      }
    }
    const executable = yield* input.resolveExecutable;
    const requestedAt = yield* Clock.currentTimeMillis;
    const stdout = yield* Effect.gen(function* () {
      const probeCwd = input.makeProbeCwd
        ? yield* input.makeProbeCwd.pipe(Effect.option, Effect.map(Option.getOrUndefined))
        : input.cwd;
      const child = yield* spawner.spawn(
        ChildProcess.make(
          executable.executablePath,
          ["-p", "/usage", "--output-format", "json", "--print-timeout", "15s"],
          {
            env: cliEnv,
            ...(probeCwd === undefined ? {} : { cwd: probeCwd }),
            extendEnv: false,
            shell: false,
            stdin: "ignore",
          },
        ),
      );
      const [output, , exitCode] = yield* Effect.all(
        [
          collectStdout(child.stdout),
          Stream.runDrain(child.stderr).pipe(Effect.ignore),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return Number(exitCode) === 0 ? output : "";
    }).pipe(Effect.scoped, Effect.timeout(CLI_USAGE_TIMEOUT));

    if (!stdout.trim()) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity CLI did not return usage data. Sign in to `agy` and refresh.",
      });
    }
    const windows = yield* parseAntigravityCliUsageOutput(stdout, requestedAt);
    if (windows.length === 0) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity CLI did not report usable quota windows.",
      });
    }
    return makeUsageLimits({ checkedAt, windows });
  });

  const probe = read.pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        return makeUnavailableUsageLimits({
          checkedAt: DateTime.formatIso(yield* DateTime.now),
          reason: "probeFailed",
          message: "Could not read Antigravity limits from `agy -p /usage`.",
        });
      }),
    ),
  );

  return {
    probe,
    clear: Effect.void,
  };
});

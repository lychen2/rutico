import type {
  AntigravitySettings,
  ServerProviderCompatibilityAdvisory,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
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

const SUMMARY_WINDOW_MINS = new Map([
  ["5h", 5 * 60],
  ["weekly", 7 * 24 * 60],
]);
const CLI_USAGE_PRINT_TIMEOUT = "20s";
const CLI_USAGE_TIMEOUT = "45 seconds";
const CLI_VERSION_TIMEOUT = "10 seconds";
const CLI_USAGE_DEFAULT_COOLDOWN_MS = 60_000;
const CLI_USAGE_MAX_STDOUT_BYTES = 1024 * 1024;
const CLI_VERSION_MAX_OUTPUT_BYTES = 4_096;
const MAX_VERIFIED_VERSION_CACHE = 16;
// Earlier agy versions did not support `/usage` as a slash command and sent it as a chat prompt.
const MIN_CLI_USAGE_VERSION = [1, 1, 11] as const;

const SANITIZED_CLI_ENV_KEYS = new Set([
  "GEMINI_HOME",
  "SSH_CONNECTION",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "BROWSER",
  "TMPDIR",
  "GEMINI_API_KEY",
  "GCLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
  "ELECTRON_RUN_AS_NODE",
  "CHROME_CRASHPAD_PIPE_NAME",
  "AGY_CLI_DISABLE_AUTO_UPDATE",
]);

function isSanitizedCliEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    SANITIZED_CLI_ENV_KEYS.has(upper) || upper.startsWith("GOOGLE_") || upper.startsWith("AGY_ACP_")
  );
}

export class AntigravityCliUsageSpentError extends Schema.TaggedError<AntigravityCliUsageSpentError>()(
  "AntigravityCliUsageSpentError",
  {
    detail: Schema.String,
  },
) {
  override get message() {
    return this.detail;
  }
}

const isCliUsageSpentError = Schema.is(AntigravityCliUsageSpentError);

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
  num_turns: Schema.optional(Schema.Number),
  usage: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
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

const decodeCliUsageOutput = Schema.decodeEffect(Schema.fromJsonString(CliUsageOutput));

function parseCliVersion(raw: string): readonly [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isCliVersionAtLeast(
  version: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let index = 0; index < minimum.length; index++) {
    if (version[index] !== minimum[index]) {
      return version[index]! > minimum[index]!;
    }
  }
  return true;
}

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

const SPENT_USAGE_MESSAGE =
  "Antigravity CLI may have treated `/usage` as a prompt instead of a zero-token command. Usage probes for this binary are paused until the CLI is updated or restarted.";

/** Parse official `agy -p "/usage" --output-format json` stdout into provider usage windows. */
export const parseAntigravityCliUsageOutput = Effect.fn("parseAntigravityCliUsageOutput")(
  function* (rawStdout: string, requestedAt: number) {
    const trimmed = rawStdout.trim();
    const jsonStart = trimmed.indexOf("{");
    const payload = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;
    const parsed = yield* decodeCliUsageOutput(payload);
    const hasNonZeroTurn =
      parsed.num_turns !== undefined &&
      (!Number.isFinite(parsed.num_turns) || parsed.num_turns !== 0);
    const hasNonZeroUsage =
      parsed.usage !== undefined &&
      Object.values(parsed.usage).some(
        (value) => typeof value === "number" && (!Number.isFinite(value) || value !== 0),
      );
    if (hasNonZeroTurn || hasNonZeroUsage) {
      return yield* new AntigravityCliUsageSpentError({ detail: SPENT_USAGE_MESSAGE });
    }
    if (parsed.status !== "SUCCESS") {
      return [];
    }
    const confirmedZeroSpend =
      parsed.num_turns === 0 &&
      parsed.usage !== undefined &&
      typeof parsed.usage.total_tokens === "number" &&
      Number.isFinite(parsed.usage.total_tokens) &&
      parsed.usage.total_tokens === 0;
    if (!confirmedZeroSpend) {
      return yield* new AntigravityCliUsageSpentError({ detail: SPENT_USAGE_MESSAGE });
    }
    if (!parsed.command) {
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
    if (!isSanitizedCliEnvKey(key)) {
      environment[key] = value;
    }
  }
  // `agy` checks `AGY_CLI_DISABLE_AUTO_UPDATE === "true"` to suppress self-updates.
  environment.AGY_CLI_DISABLE_AUTO_UPDATE = "true";
  environment.BROWSER = "false";
  return environment;
}

const collectStreamText = Effect.fn("AntigravityUsageProbe.collectStreamText")(function* (
  stream: ChildProcessSpawner.ChildProcessHandle["stdout"],
  maxBytes: number,
) {
  let totalBytes = 0;
  const chunks: Array<Uint8Array> = [];
  yield* Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => {
      if (totalBytes >= maxBytes) return;
      const remaining = maxBytes - totalBytes;
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
  readonly resolveExecutable: Effect.Effect<
    { readonly executablePath: string; readonly version?: string | null },
    ResolveError
  >;
  readonly checkCompatibility?: (
    version: string,
  ) => Effect.Effect<ServerProviderCompatibilityAdvisory | undefined>;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly makeProbeCwd?: Effect.Effect<string, ProbeCwdError, Scope.Scope>;
  readonly platform?: NodeJS.Platform;
  readonly userHome?: string;
  readonly cooldownMs?: number;
  readonly probeKeyringLockState?: (
    environment: NodeJS.ProcessEnv,
  ) => Effect.Effect<LinuxKeyringLockState, never, ChildProcessSpawner.ChildProcessSpawner>;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fsOption = yield* Effect.serviceOption(FileSystem.FileSystem);
  const pathOption = yield* Effect.serviceOption(Path.Path);
  const hostPlatformOption = yield* Effect.serviceOption(HostProcess.Platform);
  const gate = yield* Semaphore.make(1);
  const cooldownMs = input.cooldownMs ?? CLI_USAGE_DEFAULT_COOLDOWN_MS;
  const blockedBinaries = new Set<string>();
  const verifiedVersionCache = new Map<string, string>();
  let lastProbe:
    | {
        readonly at: number;
        readonly identity: string;
        readonly result: ServerProviderUsageLimits;
      }
    | undefined;

  const resolveBinaryIdentity = Effect.fn("AntigravityUsageProbe.resolveBinaryIdentity")(
    function* (executable: { readonly executablePath: string; readonly version?: string | null }) {
      if (Option.isSome(fsOption)) {
        const info = yield* fsOption.value.stat(executable.executablePath).pipe(Effect.option);
        if (Option.isSome(info)) {
          const size = Number(info.value.size);
          const mtimeMs = Option.getOrUndefined(info.value.mtime)?.getTime();
          return `${executable.executablePath}\0${size}:${mtimeMs ?? ""}`;
        }
      }
      return `${executable.executablePath}\0${executable.version ?? ""}`;
    },
  );

  const probeCliVersion = Effect.fn("AntigravityUsageProbe.probeCliVersion")(function* (
    executablePath: string,
    cliEnv: NodeJS.ProcessEnv,
    probeCwd: string | undefined,
  ) {
    return yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(executablePath, ["--version"], {
          env: cliEnv,
          ...(probeCwd === undefined ? {} : { cwd: probeCwd }),
          extendEnv: false,
          shell: false,
          stdin: "ignore",
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectStreamText(child.stdout, CLI_VERSION_MAX_OUTPUT_BYTES),
          collectStreamText(child.stderr, CLI_VERSION_MAX_OUTPUT_BYTES),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (Number(exitCode) !== 0) return undefined;
      return parseCliVersion(stdout) ?? parseCliVersion(stderr);
    }).pipe(
      Effect.scoped,
      Effect.timeoutOption(CLI_VERSION_TIMEOUT),
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
  });

  const verifyCliVersion = Effect.fn("AntigravityUsageProbe.verifyCliVersion")(function* (
    executable: { readonly executablePath: string; readonly version?: string | null },
    identity: string,
    cliEnv: NodeJS.ProcessEnv,
    probeCwd: string | undefined,
  ): Effect.fn.Return<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
    if (verifiedVersionCache.has(identity)) {
      return { ok: true } as const;
    }
    const parsed =
      (executable.version ? parseCliVersion(executable.version) : undefined) ??
      (yield* probeCliVersion(executable.executablePath, cliEnv, probeCwd));
    if (parsed === undefined) {
      return {
        ok: false,
        message: "Could not verify Antigravity CLI version before reading usage limits.",
      } as const;
    }
    const versionText = parsed.join(".");
    if (!isCliVersionAtLeast(parsed, MIN_CLI_USAGE_VERSION)) {
      return {
        ok: false,
        message: `Antigravity CLI ${versionText} is too old for \`/usage\` probes. Update Antigravity and refresh.`,
      } as const;
    }
    if (input.checkCompatibility) {
      const advisory = yield* input.checkCompatibility(versionText);
      if (advisory?.status === "broken" || advisory?.status === "unsupported") {
        return {
          ok: false,
          message: `Antigravity CLI ${versionText} is unsupported for usage probes. Update Antigravity and refresh.`,
        } as const;
      }
    }
    if (verifiedVersionCache.size >= MAX_VERIFIED_VERSION_CACHE) {
      verifiedVersionCache.clear();
    }
    verifiedVersionCache.set(identity, versionText);
    return { ok: true } as const;
  });

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
        // Never cache a locked-keyring failure so unlocking immediately allows a refresh.
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "OS keyring is locked. Unlock your keyring and refresh Antigravity usage.",
        });
      }
    }
    const executable = yield* input.resolveExecutable;
    const identity = yield* resolveBinaryIdentity(executable);
    if (blockedBinaries.has(identity)) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: SPENT_USAGE_MESSAGE,
      });
    }
    const now = yield* Clock.currentTimeMillis;
    if (
      cooldownMs > 0 &&
      lastProbe !== undefined &&
      lastProbe.identity === identity &&
      now - lastProbe.at < cooldownMs
    ) {
      return lastProbe.result;
    }

    const remember = (result: ServerProviderUsageLimits) => {
      lastProbe = { at: now, identity, result };
      return result;
    };

    const probeResult = yield* Effect.gen(function* () {
      const probeCwd = input.makeProbeCwd
        ? yield* input.makeProbeCwd.pipe(Effect.option, Effect.map(Option.getOrUndefined))
        : input.cwd;
      const versionCheck = yield* verifyCliVersion(executable, identity, cliEnv, probeCwd);
      if (!versionCheck.ok) {
        return {
          _tag: "unavailable" as const,
          message: versionCheck.message,
        };
      }
      const requestedAt = yield* Clock.currentTimeMillis;
      const runResult = yield* Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(
            executable.executablePath,
            ["-p", "/usage", "--output-format", "json", "--print-timeout", CLI_USAGE_PRINT_TIMEOUT],
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
            collectStreamText(child.stdout, CLI_USAGE_MAX_STDOUT_BYTES),
            Stream.runDrain(child.stderr).pipe(Effect.ignore),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        return { stdout: output, exitCode: Number(exitCode) };
      }).pipe(Effect.scoped, Effect.timeoutOption(CLI_USAGE_TIMEOUT));

      if (Option.isNone(runResult)) {
        return {
          _tag: "unavailable" as const,
          message: "Antigravity CLI timed out while reading usage limits.",
        };
      }

      return { _tag: "run" as const, ...runResult.value, requestedAt };
    }).pipe(Effect.scoped);

    if (probeResult._tag === "unavailable") {
      return remember(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: probeResult.message,
        }),
      );
    }

    if (!probeResult.stdout.trim()) {
      return remember(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "Antigravity CLI did not return usage data. Sign in to `agy` and refresh.",
        }),
      );
    }

    // Always inspect stdout before checking exitCode so a spent-token response still trips the breaker.
    const parsed = yield* parseAntigravityCliUsageOutput(
      probeResult.stdout,
      probeResult.requestedAt,
    ).pipe(Effect.result);
    if (parsed._tag === "Failure") {
      if (isCliUsageSpentError(parsed.failure)) {
        blockedBinaries.add(identity);
        verifiedVersionCache.delete(identity);
        return remember(
          makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: parsed.failure.detail,
          }),
        );
      }
      return remember(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message:
            probeResult.exitCode !== 0
              ? "Antigravity CLI did not return usage data. Sign in to `agy` and refresh."
              : "Could not read Antigravity limits from `agy -p /usage`.",
        }),
      );
    }

    if (probeResult.exitCode !== 0) {
      return remember(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "Antigravity CLI did not return usage data. Sign in to `agy` and refresh.",
        }),
      );
    }

    const windows = parsed.success;
    if (windows.length === 0) {
      return remember(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "Antigravity CLI did not report usable quota windows.",
        }),
      );
    }
    return remember(makeUsageLimits({ checkedAt, windows }));
  });

  const probe = gate.withPermits(1)(
    read.pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          return makeUnavailableUsageLimits({
            checkedAt: DateTime.formatIso(yield* DateTime.now),
            reason: "probeFailed",
            message: "Could not read Antigravity limits from `agy -p /usage`.",
          });
        }),
      ),
    ),
  );

  return {
    probe,
    clear: Effect.sync(() => {
      lastProbe = undefined;
    }),
  };
});

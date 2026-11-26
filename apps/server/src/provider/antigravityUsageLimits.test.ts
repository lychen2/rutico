import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  AntigravityCliUsageSpentError,
  makeAntigravityUsageProbe,
  parseAntigravityCliUsageOutput,
} from "./antigravityUsageLimits.ts";
import { parseBusctlKeyringLockedOutput } from "./antigravityKeyringGuard.ts";
import * as ModelManifest from "./ModelManifest.ts";
import { resolveProviderCompatibility } from "./providerCompatibility.ts";

const zeroUsage = {
  input_tokens: 0,
  output_tokens: 0,
  thinking_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: 0,
};

const cliUsagePayload = {
  conversation_id: "",
  status: "SUCCESS",
  duration_seconds: 0,
  num_turns: 0,
  usage: zeroUsage,
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              id: "gemini-weekly",
              name: "Weekly Limit Remaining",
              description: "You have used some of your weekly limit.",
              window: "weekly",
              remaining_fraction: 0.95,
              reset_time: "2026-12-01T20:01:26Z",
            },
            {
              id: "gemini-5h",
              name: "Five Hour Limit Remaining",
              description: "You have used some of your 5h limit.",
              window: "5h",
              remaining_fraction: 0.9,
              reset_time: "2026-11-25T01:01:26Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [
            {
              id: "3p-weekly",
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 1,
              reset_time: "1970-01-01T00:00:00Z",
            },
          ],
        },
      ],
    },
  },
};

const cliUsageJson = JSON.stringify(cliUsagePayload);

const compatibilityCheck = (version: string) =>
  Effect.succeed(
    resolveProviderCompatibility(
      ModelManifest.BUNDLED_MODEL_MANIFEST.compatibility,
      ProviderDriverKind.make("antigravity"),
      version,
    ),
  );

function fakeAgyScript(options: {
  readonly version: string;
  readonly outputJson: string;
  readonly exitCode?: number;
  readonly logFile?: string;
}): string {
  const logLine = options.logFile ? `printf '%s\\n' "$*" >> "${options.logFile}"` : undefined;
  return [
    "#!/bin/sh",
    ...(logLine ? [logLine] : []),
    `if [ "$1" = "--version" ]; then printf '%s\\n' '${options.version}'; exit 0; fi`,
    `printf '%s\\n' '${options.outputJson}'`,
    `exit ${options.exitCode ?? 0}`,
    "",
  ].join("\n");
}

describe("antigravityUsageLimits", () => {
  it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("probe", (it) => {
    it.effect(
      "reads quota via official `agy -p /usage --output-format json` without env leaks",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();
          const bin = path.join(dir, "agy");
          const envLog = path.join(dir, "env.txt");
          yield* fs.writeFileString(
            bin,
            [
              "#!/bin/sh",
              'if [ "$1" = "--version" ]; then printf \'1.5.18\\n\'; exit 0; fi',
              `printf '%s|%s|%s|%s|%s|%s|%s|%s|%s' "$1" "$2" "$3" "$4" "$5" "$6" "$AGY_CLI_DISABLE_AUTO_UPDATE" "$BROWSER" "$GEMINI_HOME$SSH_CONNECTION$GEMINI_API_KEY$GOOGLE_CUSTOM_VAR$GOOGLE_CLOUD_QUOTA_PROJECT$GCLOUD_PROJECT$AGY_ACP_CCPA_PROJECT$AGY_ACP_ENABLE_OAUTH$ELECTRON_RUN_AS_NODE$CHROME_CRASHPAD_PIPE_NAME" > "${envLog}"`,
              `printf '%s\\n' '${cliUsageJson}'`,
              "",
            ].join("\n"),
          );
          yield* fs.chmod(bin, 0o755);

          const usage = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.succeed({ executablePath: bin }),
            checkCompatibility: compatibilityCheck,
            environment: {
              PATH: hostEnv.PATH ?? "",
              GEMINI_HOME: "/should-not-pass",
              SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0",
              GEMINI_API_KEY: "must-not-pass",
              GOOGLE_CUSTOM_VAR: "must-not-pass",
              GOOGLE_CLOUD_QUOTA_PROJECT: "must-not-pass",
              GCLOUD_PROJECT: "must-not-pass",
              AGY_ACP_CCPA_PROJECT: "must-not-pass",
              AGY_ACP_ENABLE_OAUTH: "1",
              ELECTRON_RUN_AS_NODE: "1",
              CHROME_CRASHPAD_PIPE_NAME: "stale-pipe",
              AGY_CLI_DISABLE_AUTO_UPDATE: "0",
            },
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const limits = yield* usage.probe;
          expect(limits.unavailable).toBeUndefined();
          const byId = new Map(limits.windows.map((window) => [window.id, window]));
          expect([...byId.keys()].toSorted()).toEqual(["3p-weekly", "gemini-5h", "gemini-weekly"]);
          expect(byId.get("gemini-weekly")?.usedPercent).toBeCloseTo(5, 5);
          expect(byId.get("gemini-weekly")?.resetsAt).toBe("2026-12-01T20:01:26.000Z");
          expect(byId.get("gemini-5h")?.usedPercent).toBeCloseTo(10, 5);
          expect(byId.get("3p-weekly")?.usedPercent).toBe(0);
          // Epoch 0 reset_time from untouched buckets is omitted.
          expect(byId.get("3p-weekly")?.resetsAt).toBeUndefined();
          expect(yield* fs.readFileString(envLog)).toBe(
            "-p|/usage|--output-format|json|--print-timeout|20s|true|false|",
          );
          yield* usage.clear;
        }),
    );

    it.effect("returns unsupported for API key auth without spawning agy", () =>
      Effect.gen(function* () {
        let resolved = 0;
        const usage = yield* makeAntigravityUsageProbe({
          authMethod: "gemini-api-key",
          resolveExecutable: Effect.sync(() => {
            resolved += 1;
            return { executablePath: "/nonexistent/agy" };
          }),
          environment: {},
        });
        const limits = yield* usage.probe;
        expect(limits.unavailable?.reason).toBe("unsupported");
        expect(resolved).toBe(0);
      }),
    );

    it.effect("parses official CLI usage JSON into quota windows", () =>
      Effect.gen(function* () {
        const cliWindows = yield* parseAntigravityCliUsageOutput(
          cliUsageJson,
          Date.parse("2026-11-24T20:01:26Z"),
        );
        expect(cliWindows.map((window) => window.label)).toEqual([
          "Gemini · Weekly",
          "Gemini · 5-hour",
          "Claude & GPT (shared) · Weekly",
        ]);
      }),
    );

    it.effect("rejects non-zero turn or token spend and distinguishes zero-spend errors", () =>
      Effect.gen(function* () {
        const requestedAt = Date.parse("2026-11-24T20:01:26Z");
        for (const payload of [
          { ...cliUsagePayload, num_turns: 1 },
          { ...cliUsagePayload, usage: { ...zeroUsage, total_tokens: 12 } },
          { ...cliUsagePayload, usage: { ...zeroUsage, input_tokens: 3 } },
          { ...cliUsagePayload, usage: undefined },
          { ...cliUsagePayload, num_turns: undefined },
          { status: "ERROR", num_turns: 1, usage: { total_tokens: 5 } },
        ]) {
          const result = yield* parseAntigravityCliUsageOutput(
            JSON.stringify(payload),
            requestedAt,
          ).pipe(Effect.result);
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure).toBeInstanceOf(AntigravityCliUsageSpentError);
          }
        }

        // Ordinary auth/eligibility errors with no token spend must not trip the spent guard.
        const authError = yield* parseAntigravityCliUsageOutput(
          JSON.stringify({ status: "ERROR", response: "Please sign in" }),
          requestedAt,
        );
        expect(authError).toEqual([]);
      }),
    );

    it.effect(
      "refuses to run `/usage` when external CLI version is too old, unsupported, or unreadable",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();

          for (const [name, versionOutput, expectedMessage] of [
            ["old", "antigravity 1.1.10", /too old/i],
            ["broken-150", "1.5.0", /unsupported/i],
            ["unreadable", "not-a-version", /could not verify/i],
          ] as const) {
            const bin = path.join(dir, `agy-${name}`);
            const logFile = path.join(dir, `calls-${name}.log`);
            yield* fs.writeFileString(
              bin,
              fakeAgyScript({ version: versionOutput, outputJson: cliUsageJson, logFile }),
            );
            yield* fs.chmod(bin, 0o755);

            const usage = yield* makeAntigravityUsageProbe({
              authMethod: "oauth-personal",
              resolveExecutable: Effect.succeed({ executablePath: bin }),
              checkCompatibility: compatibilityCheck,
              environment: { PATH: hostEnv.PATH ?? "" },
              cwd: dir,
              cooldownMs: 0,
            }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

            const limits = yield* usage.probe;
            expect(limits.unavailable?.reason).toBe("probeFailed");
            expect(limits.unavailable?.message).toMatch(expectedMessage);
            const calls = (yield* fs.readFileString(logFile)).trim().split("\n");
            expect(calls).toEqual(["--version"]);
          }
        }),
    );

    it.effect(
      "pauses probes for a binary that reports token spend until the binary is replaced on disk",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();
          const bin = path.join(dir, "agy");
          const logFile = path.join(dir, "calls.log");
          const spentJson = JSON.stringify({
            ...cliUsagePayload,
            num_turns: 1,
            usage: { ...zeroUsage, total_tokens: 42 },
          });
          // Even when the CLI exits non-zero after spending tokens, the breaker must still trip.
          yield* fs.writeFileString(
            bin,
            fakeAgyScript({ version: "1.5.18", outputJson: spentJson, exitCode: 1, logFile }),
          );
          yield* fs.chmod(bin, 0o755);

          const usage = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.succeed({ executablePath: bin }),
            checkCompatibility: compatibilityCheck,
            environment: { PATH: hostEnv.PATH ?? "" },
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const first = yield* usage.probe;
          expect(first.unavailable?.reason).toBe("probeFailed");
          expect(first.unavailable?.message).toMatch(/paused/i);

          // Neither clear() nor waiting past cooldown unblocks the same broken binary.
          yield* usage.clear;
          yield* TestClock.adjust("120 seconds");
          const second = yield* usage.probe;
          expect(second.unavailable?.reason).toBe("probeFailed");
          expect(second.unavailable?.message).toMatch(/paused/i);
          const callsBeforeUpgrade = (yield* fs.readFileString(logFile)).trim().split("\n");
          expect(callsBeforeUpgrade).toEqual([
            "--version",
            "-p /usage --output-format json --print-timeout 20s",
          ]);

          // Replacing the binary on disk produces a new identity, re-verifies version, and succeeds.
          yield* fs.writeFileString(
            bin,
            `${fakeAgyScript({ version: "1.5.19", outputJson: cliUsageJson, logFile })}# upgraded binary\n`,
          );
          yield* fs.chmod(bin, 0o755);
          const upgraded = yield* usage.probe;
          expect(upgraded.unavailable).toBeUndefined();
          expect(upgraded.windows.length).toBe(3);
          const callsAfterUpgrade = (yield* fs.readFileString(logFile)).trim().split("\n");
          expect(callsAfterUpgrade).toEqual([
            "--version",
            "-p /usage --output-format json --print-timeout 20s",
            "--version",
            "-p /usage --output-format json --print-timeout 20s",
          ]);
        }),
    );

    it.effect(
      "reuses cached results during cooldown, re-probes after cooldown or clear, and caches --version",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();
          const bin = path.join(dir, "agy");
          const logFile = path.join(dir, "calls.log");
          yield* fs.writeFileString(
            bin,
            fakeAgyScript({ version: "1.5.18", outputJson: cliUsageJson, logFile }),
          );
          yield* fs.chmod(bin, 0o755);

          const usage = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.succeed({ executablePath: bin }),
            checkCompatibility: compatibilityCheck,
            environment: { PATH: hostEnv.PATH ?? "" },
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const first = yield* usage.probe;
          const second = yield* usage.probe;
          expect(first.unavailable).toBeUndefined();
          expect(second).toEqual(first);
          expect((yield* fs.readFileString(logFile)).trim().split("\n")).toEqual([
            "--version",
            "-p /usage --output-format json --print-timeout 20s",
          ]);

          // Waiting past the 60s cooldown re-runs `/usage` without re-checking `--version`.
          yield* TestClock.adjust("61 seconds");
          const third = yield* usage.probe;
          expect(third.unavailable).toBeUndefined();
          expect((yield* fs.readFileString(logFile)).trim().split("\n")).toEqual([
            "--version",
            "-p /usage --output-format json --print-timeout 20s",
            "-p /usage --output-format json --print-timeout 20s",
          ]);

          // `clear` (e.g. account switch) drops the cooldown cache immediately.
          yield* usage.clear;
          const fourth = yield* usage.probe;
          expect(fourth.unavailable).toBeUndefined();
          expect((yield* fs.readFileString(logFile)).trim().split("\n")).toEqual([
            "--version",
            "-p /usage --output-format json --print-timeout 20s",
            "-p /usage --output-format json --print-timeout 20s",
            "-p /usage --output-format json --print-timeout 20s",
          ]);
        }),
    );

    it("parses busctl Locked property output", () => {
      expect(parseBusctlKeyringLockedOutput("b true\n")).toBe("locked");
      expect(parseBusctlKeyringLockedOutput("b false\n")).toBe("unlocked");
      expect(parseBusctlKeyringLockedOutput("")).toBe("unknown");
      expect(parseBusctlKeyringLockedOutput("unexpected")).toBe("unknown");
    });

    it.effect(
      "skips spawning agy -p /usage on Linux when default keyring is locked and does not cache the lock failure",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();
          const bin = path.join(dir, "agy");
          yield* fs.writeFileString(
            bin,
            fakeAgyScript({ version: "1.5.18", outputJson: cliUsageJson }),
          );
          yield* fs.chmod(bin, 0o755);

          let resolved = 0;
          let lockState: "locked" | "unlocked" = "locked";
          const guardedProbe = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.sync(() => {
              resolved += 1;
              return { executablePath: bin };
            }),
            environment: {
              PATH: hostEnv.PATH ?? "",
              DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/fake",
            },
            platform: "linux",
            userHome: dir,
            probeKeyringLockState: () => Effect.sync(() => lockState),
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const lockedLimits = yield* guardedProbe.probe;
          expect(lockedLimits.unavailable?.reason).toBe("probeFailed");
          expect(resolved).toBe(0);

          // Once unlocked, probing succeeds immediately without waiting for cooldown.
          lockState = "unlocked";
          const unlockedLimits = yield* guardedProbe.probe;
          expect(unlockedLimits.unavailable).toBeUndefined();
          expect(unlockedLimits.windows.length).toBeGreaterThan(0);
          expect(resolved).toBe(1);

          const forcedProbe = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.succeed({ executablePath: bin }),
            environment: {
              PATH: hostEnv.PATH ?? "",
              DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/fake",
              AGY_CLI_FORCE_FILE_TOKEN_STORAGE: "1",
            },
            platform: "linux",
            userHome: dir,
            probeKeyringLockState: () => Effect.succeed("locked"),
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const forcedLimits = yield* forcedProbe.probe;
          expect(forcedLimits.unavailable).toBeUndefined();
          expect(forcedLimits.windows.length).toBeGreaterThan(0);
        }),
    );

    it.effect(
      "clears stale keyring-unavailable marker via busctl probe when Linux keyring is unlocked",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();
          const homeDir = path.join(dir, "home");
          const cacheDir = path.join(homeDir, ".gemini", "antigravity-cli", "cache");
          const markerPath = path.join(cacheDir, "antigravity-keyring-unavailable");
          yield* fs.makeDirectory(cacheDir, { recursive: true });
          yield* fs.writeFileString(markerPath, "2026-11-26T01:41:04Z\n");

          const binDir = path.join(dir, "bin");
          yield* fs.makeDirectory(binDir, { recursive: true });
          const busctlPath = path.join(binDir, "busctl");
          yield* fs.writeFileString(
            busctlPath,
            [
              "#!/bin/sh",
              'if [ "$*" = "--user get-property org.freedesktop.secrets /org/freedesktop/secrets/aliases/default org.freedesktop.Secret.Collection Locked" ]; then',
              "  printf 'b false\\n'",
              "  exit 0",
              "fi",
              "exit 1",
              "",
            ].join("\n"),
          );
          yield* fs.chmod(busctlPath, 0o755);

          const agyPath = path.join(dir, "agy");
          yield* fs.writeFileString(
            agyPath,
            [
              "#!/bin/sh",
              'if [ "$1" = "--version" ]; then printf \'1.5.18\\n\'; exit 0; fi',
              `if [ -e "${markerPath}" ]; then exit 2; fi`,
              `printf '%s\\n' '${cliUsageJson}'`,
              "",
            ].join("\n"),
          );
          yield* fs.chmod(agyPath, 0o755);

          const usage = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.succeed({ executablePath: agyPath }),
            environment: {
              PATH: `${binDir}:${hostEnv.PATH ?? ""}`,
              DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/fake-bus",
            },
            platform: "linux",
            userHome: homeDir,
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const limits = yield* usage.probe;
          expect(limits.unavailable).toBeUndefined();
          expect(limits.windows.length).toBeGreaterThan(0);
          expect(yield* fs.exists(markerPath)).toBe(false);
        }),
    );
  });
});

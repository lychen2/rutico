import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  makeAntigravityUsageProbe,
  parseAntigravityCliUsageOutput,
} from "./antigravityUsageLimits.ts";
import { parseBusctlKeyringLockedOutput } from "./antigravityKeyringGuard.ts";

const cliUsageJson = JSON.stringify({
  conversation_id: "",
  status: "SUCCESS",
  duration_seconds: 0,
  num_turns: 0,
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
});

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
              `printf '%s|%s|%s|%s|%s' "$1" "$2" "$3" "$4" "$GEMINI_HOME$SSH_CONNECTION$GEMINI_API_KEY" > "${envLog}"`,
              `printf '%s\\n' '${cliUsageJson}'`,
              "",
            ].join("\n"),
          );
          yield* fs.chmod(bin, 0o755);

          const usage = yield* makeAntigravityUsageProbe({
            authMethod: "oauth-personal",
            resolveExecutable: Effect.succeed({ executablePath: bin }),
            environment: {
              PATH: hostEnv.PATH ?? "",
              GEMINI_HOME: "/should-not-pass",
              SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0",
              GEMINI_API_KEY: "must-not-pass",
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
          expect(yield* fs.readFileString(envLog)).toBe("-p|/usage|--output-format|json|");
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

    it("parses busctl Locked property output", () => {
      expect(parseBusctlKeyringLockedOutput("b true\n")).toBe("locked");
      expect(parseBusctlKeyringLockedOutput("b false\n")).toBe("unlocked");
      expect(parseBusctlKeyringLockedOutput("")).toBe("unknown");
      expect(parseBusctlKeyringLockedOutput("unexpected")).toBe("unknown");
    });

    it.effect(
      "skips spawning agy -p /usage on Linux when default keyring is locked unless forced to file storage",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const hostEnv = yield* HostProcess.Environment;
          const dir = yield* fs.makeTempDirectoryScoped();
          const bin = path.join(dir, "agy");
          yield* fs.writeFileString(bin, `#!/bin/sh\nprintf '%s\\n' '${cliUsageJson}'\n`);
          yield* fs.chmod(bin, 0o755);

          let resolved = 0;
          const lockedProbe = yield* makeAntigravityUsageProbe({
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
            probeKeyringLockState: () => Effect.succeed("locked"),
            cwd: dir,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

          const lockedLimits = yield* lockedProbe.probe;
          expect(lockedLimits.unavailable?.reason).toBe("probeFailed");
          expect(resolved).toBe(0);

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

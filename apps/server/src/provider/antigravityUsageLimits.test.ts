import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  antigravityAccountFingerprint,
  antigravitySummaryWindows,
  makeAntigravityUsageProbe,
  parseAntigravityCliUsageOutput,
} from "./antigravityUsageLimits.ts";

const summary = {
  groups: [
    {
      displayName: "Gemini Models",
      buckets: [
        {
          bucketId: "gemini-weekly",
          window: "weekly",
          remainingFraction: 0.96,
          resetTime: "2026-10-12T19:41:43Z",
        },
        {
          bucketId: "gemini-5h",
          window: "5h",
          remainingFraction: 0.91,
          resetTime: "2026-10-09T16:06:01Z",
        },
      ],
    },
    {
      displayName: "Claude and GPT models",
      buckets: [
        {
          bucketId: "3p-weekly",
          window: "weekly",
          remainingFraction: 0,
          resetTime: "2026-10-10T15:28:22Z",
        },
        {
          bucketId: "3p-5h",
          window: "5h",
          remainingFraction: 0.44,
          resetTime: "2026-10-09T16:06:30Z",
        },
      ],
    },
  ],
};

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
              PATH: process.env.PATH ?? "",
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

    it.effect("parses CLI usage JSON, summary windows, and account fingerprints", () =>
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
        const windows = yield* antigravitySummaryWindows(
          summary,
          Date.parse("2026-10-09T11:06:01Z"),
        );
        expect(windows.map((window) => window.id)).toEqual([
          "gemini-weekly",
          "gemini-5h",
          "3p-weekly",
          "3p-5h",
        ]);
        const fingerprint = yield* antigravityAccountFingerprint({ id: "google-user-1" });
        expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
      }),
    );
  });
});

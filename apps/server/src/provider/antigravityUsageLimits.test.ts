import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  antigravityAccountFingerprint,
  antigravitySummaryWindows,
  makeAntigravityUsageProbe,
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

describe("antigravityUsageLimits", () => {
  it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("probe", (it) => {
    it.effect("returns unsupported without reading tokens, keyring, or making HTTP requests", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const profileDirectory = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(profileDirectory, "antigravity-acp"));
        yield* fs.writeFileString(
          path.join(profileDirectory, "antigravity-acp", "acp_token.json"),
          JSON.stringify({
            client_id: "client-id",
            client_secret: "client-secret",
            refresh_token: "refresh-token",
          }),
        );

        const usage = yield* makeAntigravityUsageProbe({
          profileDirectory,
          authMethod: "oauth-personal",
        });
        const limits = yield* usage.probe;
        expect(limits.windows).toEqual([]);
        expect(limits.unavailable?.reason).toBe("unsupported");
        yield* usage.clear;
      }),
    );

    it.effect("parses summary windows and hashes account fingerprints", () =>
      Effect.gen(function* () {
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

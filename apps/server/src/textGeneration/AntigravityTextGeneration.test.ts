import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import {
  isAntigravityTextGenerationAvailable,
  makeAntigravityTextGeneration,
} from "./AntigravityTextGeneration.ts";

const modelSelection = {
  instanceId: ProviderInstanceId.make("antigravity-test"),
  model: "gemini-test",
};

it.layer(NodeServices.layer)("AntigravityTextGeneration", (it) => {
  it.effect(
    "reports unavailable and never spawns background sessions or deletes session files",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const profileDirectory = yield* fs.makeTempDirectoryScoped({
          prefix: "t3-antigravity-text-disabled-",
        });
        const conversations = path.join(profileDirectory, "antigravity-acp", "conversations");
        const markerFile = path.join(conversations, "keep.db");
        yield* fs.makeDirectory(conversations, { recursive: true });
        yield* fs.writeFileString(markerFile, "keep");

        expect(yield* isAntigravityTextGenerationAvailable(profileDirectory)).toBe(false);

        let spawned = 0;
        const textGeneration = yield* makeAntigravityTextGeneration({
          profileDirectory,
          withProcess: (_stop, task) => task,
          makeRuntime: () =>
            Effect.sync(() => {
              spawned += 1;
              throw new Error("should not spawn");
            }),
        });

        const error = yield* textGeneration
          .generateThreadTitle({
            cwd: profileDirectory,
            message: "hello",
            modelSelection,
          })
          .pipe(Effect.flip);

        expect(error._tag).toBe("TextGenerationError");
        expect(error.detail).toContain("disabled");
        expect(spawned).toBe(0);
        expect(yield* fs.exists(markerFile)).toBe(true);
      }),
  );
});

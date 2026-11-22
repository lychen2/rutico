import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId, WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import type { ServerProvider, SidebarCategorySuggestionInput } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect, vi } from "vite-plus/test";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  readSidebarCategoryModelRates,
  suggestSidebarCategories,
} from "./SidebarCategorySuggestions.ts";

const local = ProviderInstanceId.make("catalog-provider");
const provider: ServerProvider = {
  instanceId: local,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-22T00:00:00.000Z",
  models: ["expensive", "cheaper", "unpriced"].map((slug) => ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: null,
  })),
  slashCommands: [],
  skills: [],
};
const input: SidebarCategorySuggestionInput = {
  titles: ["A strange title", "Another title"],
  categories: ["Development", "Research"],
  modelSelection: null,
  language: "en",
};

it.effect(
  "refreshes missing prices, applies overrides, and routes to the cheapest priced model",
  () =>
    Effect.gen(function* () {
      expect(WsRpcGroup.requests.has(WS_METHODS.serverSuggestSidebarCategories)).toBe(true);
      const generateTranscriptionPostProcessing = vi.fn(() =>
        Effect.succeed({
          transcription:
            '```json\n{"suggestions":[{"titleIndex":0,"categoryIndex":1,"reason":"relevant"},{"titleIndex":0,"categoryIndex":0,"reason":"duplicate"},{"titleIndex":1,"categoryIndex":9,"reason":"unknown"},{"titleIndex":-1,"categoryIndex":0,"reason":"unknown"}]}\n```',
        }),
      );
      const getTextGeneration = vi.fn(() =>
        Effect.succeed({ generateTranscriptionPostProcessing }),
      );
      const refresh = vi.fn();
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const settings = yield* ServerSettingsService;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const fetchedAtMs = yield* Clock.currentTimeMillis;
      const refreshRates = Effect.gen(function* () {
        refresh();
        yield* fs
          .writeFileString(
            path.join(stateDir, "usage-model-rates.json"),
            JSON.stringify({
              fetchedAtMs,
              document: {
                expensive: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000001 },
                cheaper: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000003 },
              },
            }),
          )
          .pipe(Effect.orDie);
        return { status: "fresh", source: "test", fetchedAt: null, knownModels: 2 } as const;
      });
      const result = yield* suggestSidebarCategories(
        input,
        [provider],
        getTextGeneration,
        (models) =>
          readSidebarCategoryModelRates(models, stateDir, settings.getSettings, refreshRates),
      );
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(getTextGeneration).toHaveBeenCalledExactlyOnceWith(local);
      expect(generateTranscriptionPostProcessing).toHaveBeenCalledExactlyOnceWith({
        cwd: expect.any(String),
        modelSelection: { instanceId: local, model: "cheaper" },
        prompt: expect.stringContaining(
          JSON.stringify({ categories: input.categories, titles: input.titles }),
        ),
      });
      expect(result).toEqual({
        model: "cheaper",
        suggestions: [{ titleIndex: 0, categoryIndex: 1, reason: "relevant" }],
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerSettingsService.layerTest({
          usagePriceOverrides: {
            expensive: { inputCostPerMillionTokens: 4, outputCostPerMillionTokens: 4 },
          },
        }),
      ),
      Effect.provide(NodeServices.layer),
    ),
);

it.effect(
  "rejects an unavailable explicit model or unpriced choices without invoking a model",
  () =>
    Effect.gen(function* () {
      const getTextGeneration = vi.fn(() => Effect.undefined);
      const rates = () => Effect.succeed(new Map());
      for (const [modelSelection, reason] of [
        [{ instanceId: ProviderInstanceId.make("other-environment"), model: "cheaper" }, "noModel"],
        [null, "noPrice"],
      ] as const) {
        const failure = yield* suggestSidebarCategories(
          { ...input, modelSelection },
          [provider],
          getTextGeneration,
          rates,
        ).pipe(Effect.flip);
        expect(failure.reason).toBe(reason);
      }
      expect(getTextGeneration).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeServices.layer)),
);

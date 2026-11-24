import type { AntigravitySettings, UsageReadError } from "@t3tools/contracts";
import type {
  ProviderUsageInstance,
  ProviderUsageReader,
  ProviderUsageScan,
} from "@t3tools/provider-core/server/usage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Effort and routing variants share the base model's price.
const antigravityRateModel = (model: string) => {
  const base = model.replace(
    /-(?:extra-low|low|medium|high|tiered|control|thinking|agent|orchestrator)$/,
    "",
  );
  return /^gemini-3-flash-(?:agent(?:-[ab])?|[ab])$/.test(model)
    ? "gemini-3.5-flash"
    : model === "gemini-3.7-flash-safety-le"
      ? "gemini-3.7-flash"
      : model === "gemini-pro-orchestrator-neon"
        ? "gemini-4-neon"
        : model === "gemini-pro-orchestrator-g1-pro"
          ? "gemini-4-argon"
          : base === "gemini-3-flash"
            ? "gemini-3-flash-preview"
            : base;
};

export class AntigravityUsage extends Context.Service<
  AntigravityUsage,
  {
    readonly scan: (input: {
      readonly instances: ReadonlyArray<ProviderUsageInstance<AntigravitySettings>>;
      readonly windowStartMs: number;
    }) => Effect.Effect<ReadonlyArray<ProviderUsageScan>, UsageReadError>;
  }
>()("t3/provider/Drivers/AntigravityUsage") {}

/** Scanning and binary-decoding Antigravity's private SQLite/protobuf databases is disabled. */
const make = Effect.succeed(
  AntigravityUsage.of({
    scan: () => Effect.succeed([]),
  }),
);

export const layer = Layer.effect(AntigravityUsage, make);

export const antigravityUsageReader: ProviderUsageReader<AntigravitySettings, AntigravityUsage> = {
  kind: "scan",
  provider: "antigravity",
  rateModel: antigravityRateModel,
  scan: ({ instances, windowStartMs }) =>
    AntigravityUsage.pipe(Effect.flatMap((usage) => usage.scan({ instances, windowStartMs }))),
};

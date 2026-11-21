// Shared with the client settings form; keep schema code browser-safe.
import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const providerSettings = (binary: "pi" | "omp", label: "Pi" | "OMP") =>
  makeProviderSettingsSchema(
    {
      enabled: Schema.Boolean.pipe(
        Schema.withDecodingDefault(Effect.succeed(false)),
        Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
      ),
      binaryPath: makeBinaryPathSetting(binary).pipe(
        Schema.annotateKey({
          title: "Binary path",
          description: `Path to the ${label} coding agent binary.`,
          providerSettingsForm: { placeholder: binary, clearWhenEmpty: "omit" },
        }),
      ),
      launchArgs: TrimmedString.pipe(
        Schema.withDecodingDefault(Effect.succeed("")),
        Schema.annotateKey({
          title: "Launch arguments",
          description: `Additional CLI arguments passed to ${binary} on session start.`,
          providerSettingsForm: { clearWhenEmpty: "omit" },
        }),
      ),
      customModels: Schema.Array(CustomModelSetting).pipe(
        Schema.withDecodingDefault(Effect.succeed([])),
        Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
      ),
    },
    {
      order: ["binaryPath", "launchArgs"],
    },
  );
export const PiSettings = providerSettings("pi", "Pi");
export const OmpSettings = providerSettings("omp", "OMP");
export type PiSettings = typeof PiSettings.Type;

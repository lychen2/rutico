import { ProviderSetupError, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { AcpError } from "effect-acp/errors";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";

type AntigravityTextRuntime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  | "start"
  | "setMode"
  | "getConfigOptions"
  | "getEvents"
  | "setModel"
  | "setConfigOption"
  | "prompt"
  | "cancel"
  | "handleSessionUpdate"
  | "handleRequestPermission"
  | "handleElicitation"
  | "handleReadTextFile"
  | "handleWriteTextFile"
  | "handleCreateTerminal"
  | "handleTerminalOutput"
  | "handleTerminalWaitForExit"
  | "handleTerminalKill"
  | "handleTerminalRelease"
  | "handleUnknownExtRequest"
>;

export interface AntigravityTextGenerationOptions {
  readonly profileDirectory: string;
  readonly defaultModel?: Effect.Effect<string | undefined>;
  readonly makeRuntime: (
    cwd: string,
  ) => Effect.Effect<AntigravityTextRuntime, AcpError | ProviderSetupError, Scope.Scope>;
  readonly withProcess: <A, E, R>(
    stop: Effect.Effect<void>,
    task: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProviderSetupError, R | Scope.Scope>;
}

const ANTIGRAVITY_TEXT_GENERATION_DISABLED_MESSAGE =
  "Antigravity background text generation is disabled. Select another provider for system text generation.";

/** Background Antigravity text generation is disabled to avoid hidden sessions and file scrubbing. */
export const isAntigravityTextGenerationAvailable = (_profileDirectory: string) =>
  Effect.succeed(false);

export const makeAntigravityTextGeneration = (_options: AntigravityTextGenerationOptions) => {
  const runDisabled = Effect.fn("AntigravityTextGeneration.disabled")(function* <
    S extends Schema.Top,
  >(input: TextGenerationOperations.Request<S>): Effect.fn.Return<S["Type"], TextGenerationError> {
    return yield* new TextGenerationError({
      operation: input.operation,
      detail: ANTIGRAVITY_TEXT_GENERATION_DISABLED_MESSAGE,
    });
  });

  return Effect.succeed(
    TextGenerationOperations.fromRunner("AntigravityTextGeneration", runDisabled),
  );
};

import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import type { McpProviderSessionConfig } from "@t3tools/provider-core/server/mcpSession";
import {
  OMP_T3_MCP_EXTENSION_FILENAME,
  OMP_T3_MCP_EXTENSION_SOURCE,
  PI_T3_MCP_EXTENSION_FILENAME,
  PI_T3_MCP_EXTENSION_SOURCE,
  T3_MCP_BEARER_ENV,
  T3_MCP_URL_ENV,
  T3_PI_RUNTIME_MODE_ENV,
  T3_PI_MCP_EXTENSION_PATH_ENV,
} from "./mcpExtensionSource.ts";

const RESERVED_PI_LAUNCH_ARGUMENTS = new Set([
  "--continue",
  "-c",
  "--export",
  "--fork",
  "--help",
  "-h",
  "--list-models",
  "--mode",
  "--no-session",
  "--print",
  "-p",
  "--resume",
  "-r",
  "--session",
  "--session-id",
  "--version",
  "-v",
]);

export const PI_ARGUMENTS_WITH_VALUES = new Set([
  "--api-key",
  "--append-system-prompt",
  "--exclude-tools",
  "-xt",
  "--extension",
  "-e",
  "--model",
  "--models",
  "--name",
  "-n",
  "--prompt-template",
  "--provider",
  "--session-dir",
  "--skill",
  "--system-prompt",
  "--theme",
  "--thinking",
  "--tools",
  "-t",
  "--tui-mode",
  "--use-theme",
]);

const PI_ARGUMENTS_WITHOUT_VALUES = new Set([
  "--approve",
  "-a",
  "--no-approve",
  "-na",
  "--no-builtin-tools",
  "-nbt",
  "--no-context-files",
  "-nc",
  "--no-extensions",
  "-ne",
  "--no-prompt-templates",
  "-np",
  "--no-skills",
  "-ns",
  "--no-themes",
  "--no-tools",
  "-nt",
  "--offline",
  "--verbose",
]);

export type PiLaunchArgsResolution =
  | { readonly ok: true; readonly args: ReadonlyArray<string> }
  | { readonly ok: false; readonly message: string };

function reservedPiArgument(arg: string): string | undefined {
  for (const reserved of RESERVED_PI_LAUNCH_ARGUMENTS) {
    if (arg === reserved || (reserved.startsWith("--") && arg.startsWith(`${reserved}=`))) {
      return reserved;
    }
  }
  return undefined;
}

function normalizePiBuiltInEqualsArguments(args: ReadonlyArray<string>): ReadonlyArray<string> {
  return args.flatMap((arg) => {
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex <= 0) return [arg];
    const option = arg.slice(0, equalsIndex);
    return PI_ARGUMENTS_WITH_VALUES.has(option) ? [option, arg.slice(equalsIndex + 1)] : [arg];
  });
}

export function resolvePiLaunchArgs(launchArgs: string): PiLaunchArgsResolution {
  // Pi treats equals-form tokens as extension flags; split only known built-ins.
  const args = normalizePiBuiltInEqualsArguments(tokenizeCliArgs(launchArgs));
  let hasProvider = false;
  let hasModel = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    const reserved = reservedPiArgument(arg);
    if (reserved !== undefined) {
      return {
        ok: false,
        message: `Pi launch argument '${reserved}' is controlled by T3 Code and cannot be overridden.`,
      };
    }
    if (arg === "--") {
      return {
        ok: false,
        message: "Pi launch arguments cannot include positional prompts.",
      };
    }
    if (PI_ARGUMENTS_WITH_VALUES.has(arg)) {
      const value = args[index + 1];
      if (value === undefined) {
        return { ok: false, message: `Pi launch argument '${arg}' requires a value.` };
      }
      if (arg === "--provider") hasProvider = true;
      if (arg === "--model") hasModel = true;
      index += 1;
      continue;
    }
    if (PI_ARGUMENTS_WITHOUT_VALUES.has(arg) || (arg.startsWith("--") && arg.includes("="))) {
      continue;
    }
    if (arg.startsWith("--")) {
      // Arbitrary extension flags may consume one following non-flag token.
      if (
        args[index + 1] !== undefined &&
        !args[index + 1]!.startsWith("-") &&
        !args[index + 1]!.startsWith("@")
      ) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      return { ok: false, message: `Pi launch argument '${arg}' is not supported by T3 Code.` };
    }
    return {
      ok: false,
      message: `Pi launch arguments cannot include positional prompt '${arg}'.`,
    };
  }
  if (hasProvider && !hasModel) {
    return { ok: false, message: "Pi launch argument '--provider' requires '--model'." };
  }
  return { ok: true, args };
}

export function resolveOmpLaunchArgs(launchArgs: string): PiLaunchArgsResolution {
  const args = tokenizeCliArgs(launchArgs);
  const controlled =
    /^(?:--(?:mode|cwd|continue|resume|restore|no-session|export|help|print|version|approval-mode|auto-approve|goal)(?:=|$)|-[crphv]$)/;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--" || controlled.test(arg) || !arg.startsWith("-")) {
      return {
        ok: false,
        message: `OMP launch argument '${arg}' is controlled by T3 Code or is a positional prompt.`,
      };
    }
    // OMP accepts both --key=value and --key value. Only value-bearing flags can
    // consume a following word; treating a prompt as an unknown flag's value
    // would let it run before T3 owns the turn.
    if (
      /^(?:--(?:model|provider|smol|slow|plan|prewalk-into|plan-yolo-into|api-key|system-prompt|system-prompt-template|append-system-prompt|profile|config|add-dir|session-dir|models|tools|thinking|service-tier|hook|extension|skills|spinner-interval|max-fps|motion|max-time|warn-cost|max-cost|plugin-dir)|-e)$/.test(
        arg,
      )
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: `OMP launch argument '${arg}' requires a value.` };
      }
      index += 1;
    }
  }
  return { ok: true, args };
}

function bearerTokenFromAuthorizationHeader(header: string): string {
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
}

function normalizedPiPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function hasExplicitExtension(args: ReadonlyArray<string>, extensionPath: string): boolean {
  const wanted = normalizedPiPath(extensionPath);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--extension" && arg !== "-e") continue;
    const configured = args[index + 1];
    if (configured !== undefined && normalizedPiPath(configured) === wanted) return true;
    index += 1;
  }
  return false;
}

function withoutExplicitExtensions(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--extension" || arg === "-e") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--extension=") || arg.startsWith("-e=")) continue;
    filtered.push(arg);
  }
  return filtered;
}

function withoutToolSelectionArgs(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--tools" || arg === "-t" || arg === "--exclude-tools" || arg === "-xt") {
      index += 1;
      continue;
    }
    if (
      arg === "--no-tools" ||
      arg === "-nt" ||
      arg === "--no-builtin-tools" ||
      arg === "-nbt" ||
      arg.startsWith("--tools=") ||
      arg.startsWith("-t=") ||
      arg.startsWith("--exclude-tools=") ||
      arg.startsWith("-xt=")
    ) {
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

export const materializePiT3McpExtension = Effect.fn("materializePiT3McpExtension")(function* (
  cacheDir: string,
  omp = false,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(cacheDir, { recursive: true });
  const filename = omp ? OMP_T3_MCP_EXTENSION_FILENAME : PI_T3_MCP_EXTENSION_FILENAME;
  const source = omp ? OMP_T3_MCP_EXTENSION_SOURCE : PI_T3_MCP_EXTENSION_SOURCE;
  const dest = `${cacheDir.replace(/\\/g, "/")}/${filename}`;
  const existing = yield* fs.readFileString(dest).pipe(Effect.orElseSucceed(() => ""));
  if (existing !== source) {
    // Concurrent pi launches read this file: stage it in a per-call directory
    // and rename so readers and other writers never see a partial file.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const stagingDir = yield* fs.makeTempDirectoryScoped({ directory: cacheDir });
        const staging = `${stagingDir.replace(/\\/g, "/")}/${filename}`;
        yield* fs.writeFileString(staging, source);
        yield* fs.rename(staging, dest).pipe(Effect.retry({ times: 3 }));
      }),
    );
  }
  return dest;
});

export function buildPiRpcLaunch(input: {
  readonly launchArgs: ReadonlyArray<string>;
  readonly omp?: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly mcpSession: McpProviderSessionConfig | undefined;
  readonly extensionPath: string | undefined;
  readonly sessionPath?: string | undefined;
  readonly ephemeral?: boolean;
  // T3 stops these processes as soon as they answer. They run --offline because Pi's startup
  // catalog refresh renews expired OAuth tokens, and a stop mid-request loses the rotated one.
  readonly shortLived?: boolean;
  readonly disableExtensions?: boolean;
  readonly disableTools?: boolean;
  readonly runtimeMode?: "approval-required" | "auto-accept-edits" | "auto" | "full-access";
}): {
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
} {
  const hasT3Extension = input.disableExtensions !== true && input.extensionPath !== undefined;
  const hasT3Mcp = hasT3Extension && input.mcpSession !== undefined;
  const extensionSafeArgs =
    input.disableExtensions === true
      ? withoutExplicitExtensions(input.launchArgs)
      : input.launchArgs;
  const launchArgs =
    input.disableTools === true ? withoutToolSelectionArgs(extensionSafeArgs) : extensionSafeArgs;
  const args = [
    "--mode",
    input.omp ? "rpc-ui" : "rpc",
    ...(input.ephemeral === true
      ? ["--no-session"]
      : input.sessionPath !== undefined
        ? // OMP's --restore requires the TUI; RPC attaches to persisted history with --resume.
          [input.omp ? "--resume" : "--session", input.sessionPath]
        : []),
    ...launchArgs,
    ...(input.shortLived === true && !launchArgs.includes("--offline") ? ["--offline"] : []),
    // Restrictions must follow launch args so user flags cannot re-enable unattended tools/extensions.
    ...(input.disableExtensions === true ? ["--no-extensions"] : []),
    ...(input.disableTools === true ? ["--no-tools"] : []),
    ...(input.omp && input.shortLived ? ["--no-title", "--no-lsp", "--no-ui"] : []),
    ...(input.omp && input.runtimeMode !== undefined
      ? [
          "--approval-mode",
          input.runtimeMode === "full-access"
            ? "yolo"
            : input.runtimeMode === "auto-accept-edits"
              ? "write"
              : "always-ask",
        ]
      : []),
  ];
  if (
    hasT3Extension &&
    input.extensionPath !== undefined &&
    !hasExplicitExtension(args, input.extensionPath)
  ) {
    args.push("--extension", input.extensionPath);
  }
  const environment = { ...input.environment };
  // MCP credentials belong to this T3 session; discard inherited server/parent credentials.
  delete environment[T3_MCP_URL_ENV];
  delete environment[T3_MCP_BEARER_ENV];
  delete environment[T3_PI_MCP_EXTENSION_PATH_ENV];

  return {
    args,
    env: {
      ...environment,
      ...(hasT3Extension && input.extensionPath !== undefined
        ? { [T3_PI_MCP_EXTENSION_PATH_ENV]: input.extensionPath }
        : {}),
      ...(hasT3Extension && input.runtimeMode !== undefined
        ? {
            [T3_PI_RUNTIME_MODE_ENV]:
              input.runtimeMode === "auto" ? "approval-required" : input.runtimeMode,
          }
        : {}),
      ...(hasT3Mcp && input.mcpSession !== undefined
        ? {
            [T3_MCP_URL_ENV]: input.mcpSession.endpoint,
            [T3_MCP_BEARER_ENV]: bearerTokenFromAuthorizationHeader(
              input.mcpSession.authorizationHeader,
            ),
          }
        : {}),
    },
  };
}

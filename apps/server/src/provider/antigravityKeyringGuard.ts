import type { AntigravityAuthMethod } from "@t3tools/contracts";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

export type LinuxKeyringLockState = "locked" | "unlocked" | "unknown";

interface KeyringGuardInput {
  readonly platform: NodeJS.Platform;
  readonly userHome: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly authMethod: AntigravityAuthMethod;
  readonly probeLockState?: (
    environment: NodeJS.ProcessEnv,
  ) => Effect.Effect<LinuxKeyringLockState, never, ChildProcessSpawner.ChildProcessSpawner>;
}

function readEnvValue(environment: NodeJS.ProcessEnv, targetKey: string): string | undefined {
  const upperTarget = targetKey.toUpperCase();
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === upperTarget && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function isBrowserOAuth(authMethod: AntigravityAuthMethod): boolean {
  return authMethod === "oauth-personal" || authMethod === "oauth-business";
}

function antigravityKeyringUnavailableMarkerPath(path: Path.Path, userHome: string): string {
  return path.join(
    userHome,
    ".gemini",
    "antigravity-cli",
    "cache",
    "antigravity-keyring-unavailable",
  );
}

function shouldGuardLinuxKeyring(input: KeyringGuardInput): boolean {
  return (
    input.platform === "linux" &&
    isBrowserOAuth(input.authMethod) &&
    input.userHome.trim().length > 0 &&
    !antigravityForcesFileTokenStorage(input.environment)
  );
}

/** Checks whether `AGY_CLI_FORCE_FILE_TOKEN_STORAGE` disables OS keyring storage. */
function antigravityForcesFileTokenStorage(environment: NodeJS.ProcessEnv): boolean {
  const value = readEnvValue(environment, "AGY_CLI_FORCE_FILE_TOKEN_STORAGE")?.trim().toLowerCase();
  return Boolean(value && value !== "0" && value !== "false");
}

/** Parses `busctl --user get-property ... Locked` output into a lock state. */
export function parseBusctlKeyringLockedOutput(stdout: string): LinuxKeyringLockState {
  const trimmed = stdout.trim();
  if (trimmed === "b true") return "locked";
  if (trimmed === "b false") return "unlocked";
  return "unknown";
}

/** Probes the default Freedesktop Secret Service collection lock state via `busctl`. */
const probeLinuxDefaultKeyringLockState = Effect.fn("probeLinuxDefaultKeyringLockState")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const dbusAddress = readEnvValue(environment, "DBUS_SESSION_BUS_ADDRESS")?.trim();
  if (!dbusAddress) {
    return "unknown" as const;
  }
  const pathValue = readEnvValue(environment, "PATH") ?? "/usr/local/bin:/usr/bin:/bin";
  const xdgRuntimeDir = readEnvValue(environment, "XDG_RUNTIME_DIR");
  const home = readEnvValue(environment, "HOME");
  const env: NodeJS.ProcessEnv = {
    PATH: pathValue,
    DBUS_SESSION_BUS_ADDRESS: dbusAddress,
    ...(xdgRuntimeDir ? { XDG_RUNTIME_DIR: xdgRuntimeDir } : {}),
    ...(home ? { HOME: home } : {}),
  };

  const result = yield* Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(
        "busctl",
        [
          "--user",
          "get-property",
          "org.freedesktop.secrets",
          "/org/freedesktop/secrets/aliases/default",
          "org.freedesktop.Secret.Collection",
          "Locked",
        ],
        {
          env,
          extendEnv: false,
          shell: false,
          stdin: "ignore",
        },
      ),
    );
    const [stdout, , exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: 256 }),
        Stream.runDrain(child.stderr).pipe(Effect.ignore),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return Number(exitCode) === 0 && !stdout.truncated
      ? parseBusctlKeyringLockedOutput(stdout.text)
      : ("unknown" as const);
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption("2 seconds"),
    Effect.orElseSucceed(() => Option.none<LinuxKeyringLockState>()),
  );
  return Option.getOrElse(result, (): LinuxKeyringLockState => "unknown");
});

/** Removes a stale `antigravity-keyring-unavailable` marker once the Linux keyring is unlocked. */
export const clearStaleAntigravityKeyringUnavailableMarker = Effect.fn(
  "clearStaleAntigravityKeyringUnavailableMarker",
)(function* (input: KeyringGuardInput) {
  if (!shouldGuardLinuxKeyring(input)) {
    return false;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const markerPath = antigravityKeyringUnavailableMarkerPath(path, input.userHome);
  const exists = yield* fs.exists(markerPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return false;
  }
  const lockState = yield* (input.probeLockState ?? probeLinuxDefaultKeyringLockState)(
    input.environment,
  );
  if (lockState !== "unlocked") {
    return false;
  }
  yield* fs.remove(markerPath, { force: true }).pipe(Effect.ignore);
  return true;
});

/**
 * Checks Linux default keyring state before running `agy -p /usage`, preventing a locked keyring
 * from triggering agy's 5-second timeout and 1-hour fallback cooldown marker.
 */
export const prepareAntigravityCliUsageKeyringState = Effect.fn(
  "prepareAntigravityCliUsageKeyringState",
)(function* (
  input: KeyringGuardInput,
): Effect.fn.Return<
  "ready" | "locked",
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> {
  if (!shouldGuardLinuxKeyring(input)) {
    return "ready" as const;
  }
  if (
    !input.probeLockState &&
    !readEnvValue(input.environment, "DBUS_SESSION_BUS_ADDRESS")?.trim()
  ) {
    return "ready" as const;
  }
  const lockState = yield* (input.probeLockState ?? probeLinuxDefaultKeyringLockState)(
    input.environment,
  );
  if (lockState === "locked") {
    return "locked" as const;
  }
  if (lockState === "unlocked") {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const markerPath = antigravityKeyringUnavailableMarkerPath(path, input.userHome);
    if (yield* fs.exists(markerPath).pipe(Effect.orElseSucceed(() => false))) {
      yield* fs.remove(markerPath, { force: true }).pipe(Effect.ignore);
    }
  }
  return "ready" as const;
});

import {
  DesktopThemeSchema,
  type DesktopTheme,
  type LinuxPortalAppearance,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import { watchLinuxPortalAppearance, type LinuxColorScheme } from "./LinuxColorScheme.ts";

export class ElectronThemeSetSourceError extends Schema.TaggedError<ElectronThemeSetSourceError>()(
  "ElectronThemeSetSourceError",
  {
    source: DesktopThemeSchema,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to set the Electron theme source to ${this.source}.`;
  }
}

export class ElectronTheme extends Context.Service<
  ElectronTheme,
  {
    readonly shouldUseDarkColors: Effect.Effect<boolean>;
    readonly setSource: (theme: DesktopTheme) => Effect.Effect<void, ElectronThemeSetSourceError>;
    readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
    readonly linuxPortalAppearance: Effect.Effect<LinuxPortalAppearance | null>;
    readonly onLinuxPortalAppearanceChange: (
      listener: (appearance: LinuxPortalAppearance) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronTheme") {}

type WatchSystemColorScheme = (onChange: (scheme: LinuxColorScheme) => void) => {
  readonly stop: () => void;
};

type WatchPortalAppearance = (onChange: (appearance: LinuxPortalAppearance) => void) => {
  readonly stop: () => void;
};

export const makeWith = Effect.fn("ElectronTheme.make")(function* (
  watchSystemColorScheme: WatchSystemColorScheme | undefined,
  watchPortalAppearance?: WatchPortalAppearance | undefined,
) {
  let source: DesktopTheme = Electron.nativeTheme.themeSource;
  let systemScheme: LinuxColorScheme = null;
  let portalAppearance: LinuxPortalAppearance | null = null;
  const portalListeners = new Set<(appearance: LinuxPortalAppearance) => void>();

  // On Linux, Electron reads the desktop color scheme once and then ignores the settings
  // portal (electron/electron#48736), so "system" is resolved from the portal directly.
  const apply = () => {
    Electron.nativeTheme.themeSource = source === "system" ? (systemScheme ?? source) : source;
  };

  if (watchPortalAppearance) {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        try {
          return watchPortalAppearance((appearance) => {
            portalAppearance = appearance;
            systemScheme = appearance.colorScheme ?? null;
            apply();
            for (const listener of portalListeners) {
              listener(appearance);
            }
          });
        } catch {
          return undefined;
        }
      }),
      (watcher) => Effect.sync(() => watcher?.stop()),
    );
  } else if (watchSystemColorScheme) {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        try {
          return watchSystemColorScheme((scheme) => {
            systemScheme = scheme;
            apply();
          });
        } catch {
          return undefined;
        }
      }),
      (watcher) => Effect.sync(() => watcher?.stop()),
    );
  }

  return ElectronTheme.of({
    shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
    setSource: Effect.fn("ElectronTheme.setSource")(function (theme) {
      return Effect.try({
        try: () => {
          source = theme;
          apply();
        },
        catch: (cause) => new ElectronThemeSetSourceError({ source: theme, cause }),
      });
    }),
    onUpdated: Effect.fn("ElectronTheme.onUpdated")(function (listener) {
      return Effect.acquireRelease(
        Effect.suspend(() => {
          Electron.nativeTheme.on("updated", listener);
          return Effect.void;
        }),
        () =>
          Effect.suspend(() => {
            Electron.nativeTheme.removeListener("updated", listener);
            return Effect.void;
          }),
      );
    }),
    linuxPortalAppearance: Effect.sync(() => portalAppearance),
    onLinuxPortalAppearanceChange: Effect.fn("ElectronTheme.onLinuxPortalAppearanceChange")(
      function (listener) {
        return Effect.acquireRelease(
          Effect.sync(() => {
            portalListeners.add(listener);
          }),
          () =>
            Effect.sync(() => {
              portalListeners.delete(listener);
            }),
        );
      },
    ),
  });
});

/** @public */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  return yield* makeWith(undefined, platform === "linux" ? watchLinuxPortalAppearance : undefined);
});

export const layer = Layer.effect(ElectronTheme, make);

import { assert, describe, it } from "@effect/vitest";
import type { LinuxPortalAppearance } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import type { LinuxColorScheme } from "./LinuxColorScheme.ts";

const { nativeTheme } = vi.hoisted(() => ({
  nativeTheme: { themeSource: "system" as "system" | "light" | "dark" },
}));

vi.mock("electron", () => ({ nativeTheme }));

import * as ElectronTheme from "./ElectronTheme.ts";

function setup() {
  nativeTheme.themeSource = "system";
  const portal: { report: (scheme: LinuxColorScheme) => void; stopped: boolean } = {
    report: () => undefined,
    stopped: false,
  };
  const watch = (onChange: (scheme: LinuxColorScheme) => void) => {
    portal.report = onChange;
    return {
      stop: () => {
        portal.stopped = true;
      },
    };
  };
  return { portal, watch };
}

describe("ElectronTheme", () => {
  it.effect("resolves the system appearance from the desktop color scheme as it changes", () =>
    Effect.gen(function* () {
      const { portal, watch } = setup();
      const theme = yield* ElectronTheme.makeWith(watch);
      yield* theme.setSource("system");

      portal.report("dark");
      assert.equal(nativeTheme.themeSource, "dark");
      portal.report("light");
      assert.equal(nativeTheme.themeSource, "light");
      portal.report(null);
      assert.equal(nativeTheme.themeSource, "system");
    }),
  );

  it.effect("keeps an explicit appearance over the desktop color scheme", () =>
    Effect.gen(function* () {
      const { portal, watch } = setup();
      const theme = yield* ElectronTheme.makeWith(watch);
      portal.report("dark");

      yield* theme.setSource("light");
      portal.report("dark");
      assert.equal(nativeTheme.themeSource, "light");

      yield* theme.setSource("system");
      assert.equal(nativeTheme.themeSource, "dark");
    }),
  );

  it.effect("stops following the desktop when the layer is released", () =>
    Effect.gen(function* () {
      const { portal, watch } = setup();
      yield* ElectronTheme.makeWith(watch).pipe(Effect.scoped);
      assert.isTrue(portal.stopped);
    }),
  );

  it.effect("leaves the system appearance to Electron when the portal is unavailable", () =>
    Effect.gen(function* () {
      setup();
      const theme = yield* ElectronTheme.makeWith(() => {
        throw new Error("no session bus");
      });
      yield* theme.setSource("system");
      assert.equal(nativeTheme.themeSource, "system");
    }),
  );

  it.effect(
    "forwards 3-key Linux portal appearance updates and stops cleanly on Scope release",
    () =>
      Effect.gen(function* () {
        nativeTheme.themeSource = "system";
        let emitPortal: (appearance: LinuxPortalAppearance) => void = () => undefined;
        let stopped = false;
        const received: LinuxPortalAppearance[] = [];

        yield* Effect.gen(function* () {
          const theme = yield* ElectronTheme.makeWith(undefined, (onChange) => {
            emitPortal = onChange;
            return {
              stop: () => {
                stopped = true;
              },
            };
          });
          yield* theme.onLinuxPortalAppearanceChange((appearance) => {
            received.push(appearance);
          });
          yield* theme.setSource("system");

          emitPortal({
            colorScheme: "dark",
            accentColor: { r: 0.21, g: 0.52, b: 0.89 },
            contrast: "high",
          });

          assert.equal(nativeTheme.themeSource, "dark");
          assert.deepEqual(yield* theme.linuxPortalAppearance, {
            colorScheme: "dark",
            accentColor: { r: 0.21, g: 0.52, b: 0.89 },
            contrast: "high",
          });
          assert.equal(received.length, 1);
        }).pipe(Effect.scoped);

        assert.isTrue(stopped);
      }),
  );
});

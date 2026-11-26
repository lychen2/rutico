import { assert, describe, it } from "@effect/vitest";
import type { DesktopTrayAgentStatus, DesktopTrayState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as DesktopTray from "./DesktopTray.ts";

function makeTrayHarness(options?: {
  readonly platform?: NodeJS.Platform;
  readonly throwOnCreate?: boolean;
}) {
  let destroyed = false;
  const setImage = vi.fn();
  const setToolTip = vi.fn();
  const setContextMenu = vi.fn();
  const on = vi.fn();
  const destroy = vi.fn(() => {
    destroyed = true;
  });
  const handle: DesktopTray.DesktopTrayHandle & { readonly on: typeof on } = {
    setImage,
    setToolTip,
    setContextMenu,
    isDestroyed: () => destroyed,
    destroy,
    on,
  };
  const builtMenus: Array<Electron.MenuItemConstructorOptions[]> = [];
  const createTray = vi.fn((_image: Electron.NativeImage) => {
    if (options?.throwOnCreate) {
      throw new Error("StatusNotifierWatcher unavailable");
    }
    return handle;
  });
  const buildMenu = vi.fn((template: Electron.MenuItemConstructorOptions[]) => {
    builtMenus.push(template);
    return { template } as unknown as Electron.Menu;
  });
  const fakeImages: Record<DesktopTrayAgentStatus, Electron.NativeImage> = {
    idle: { id: "idle" } as unknown as Electron.NativeImage,
    running: { id: "running" } as unknown as Electron.NativeImage,
    approval: { id: "approval" } as unknown as Electron.NativeImage,
    completed: { id: "completed" } as unknown as Electron.NativeImage,
    error: { id: "error" } as unknown as Electron.NativeImage,
  };
  const buildImages = vi.fn(() => fakeImages);

  const dispatchedMenuActions: Array<{
    readonly action: string;
    readonly options?: { readonly reveal?: boolean };
  }> = [];
  const quitCalls = vi.fn();

  const depsLayer = Layer.mergeAll(
    Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
      platform: options?.platform ?? "linux",
      displayName: "Rutico",
    } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
    Layer.succeed(DesktopWindow.DesktopWindow, {
      activate: Effect.void,
      dispatchMenuAction: (action: string, opts?: { readonly reveal?: boolean }) =>
        Effect.sync(() => {
          dispatchedMenuActions.push({ action, ...(opts ? { options: opts } : {}) });
        }),
    } as unknown as DesktopWindow.DesktopWindow["Service"]),
    Layer.succeed(ElectronApp.ElectronApp, {
      quit: Effect.sync(quitCalls),
    } as unknown as ElectronApp.ElectronApp["Service"]),
    Layer.succeed(ElectronWindow.ElectronWindow, {
      main: Effect.succeedNone,
    } as unknown as ElectronWindow.ElectronWindow["Service"]),
  );

  const deps: DesktopTray.DesktopTrayDependencies = {
    createTray,
    buildMenu,
    buildImages,
  };

  return {
    deps,
    depsLayer,
    createTray,
    buildMenu,
    buildImages,
    fakeImages,
    setImage,
    setToolTip,
    setContextMenu,
    destroy,
    on,
    builtMenus,
    dispatchedMenuActions,
    quitCalls,
  };
}

describe("DesktopTray", () => {
  it.effect(
    "caches the 5-state NativeImage set, updates image/menu only on semantic change, never dual-binds click on Linux, and destroys on Scope exit",
    () =>
      Effect.gen(function* () {
        const harness = makeTrayHarness({ platform: "linux" });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const tray = yield* DesktopTray.makeWith(harness.deps);
            yield* tray.initialize;

            assert.equal(harness.buildImages.mock.calls.length, 1);
            assert.equal(harness.createTray.mock.calls.length, 1);
            assert.strictEqual(harness.createTray.mock.calls[0]?.[0], harness.fakeImages.idle);
            // StatusNotifierItem must never register a conflicting "click" handler.
            assert.equal(harness.on.mock.calls.length, 0);
            assert.equal(harness.setContextMenu.mock.calls.length, 1);

            // Re-applying identical idle state is a complete no-op.
            yield* tray.updateState({
              status: "idle",
              runningCount: 0,
              approvalCount: 0,
              unreadCount: 0,
              threads: [],
            });
            assert.equal(harness.setImage.mock.calls.length, 0);
            assert.equal(harness.setContextMenu.mock.calls.length, 1);

            // Transition to approval with active threads updates cached orb and rebuilds menu once.
            const approvalState: DesktopTrayState = {
              status: "approval",
              runningCount: 1,
              approvalCount: 1,
              unreadCount: 2,
              threads: [
                {
                  environmentId: "env-1",
                  threadId: "thread-42",
                  title: "Fix Wayland portal accent",
                  status: "approval",
                },
              ],
            };
            yield* tray.updateState(approvalState);
            assert.equal(harness.setImage.mock.calls.length, 1);
            assert.strictEqual(harness.setImage.mock.calls[0]?.[0], harness.fakeImages.approval);
            assert.equal(harness.setContextMenu.mock.calls.length, 2);

            // Duplicate approval update does not call setImage or setContextMenu again.
            yield* tray.updateState(approvalState);
            assert.equal(harness.setImage.mock.calls.length, 1);
            assert.equal(harness.setContextMenu.mock.calls.length, 2);

            // Clicking the quick-jump thread item dispatches open-thread menu action with reveal.
            const latestTemplate = harness.builtMenus.at(-1) ?? [];
            const threadItem = latestTemplate.find((item) =>
              item.label?.includes("Fix Wayland portal accent"),
            );
            assert.isDefined(threadItem?.click);
            threadItem!.click!({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
            assert.deepEqual(harness.dispatchedMenuActions, [
              {
                action: "open-thread:env-1:thread-42",
                options: { reveal: true },
              },
            ]);
          }),
        ).pipe(Effect.provide(harness.depsLayer));

        // Scope teardown automatically destroys the Tray handle.
        assert.equal(harness.destroy.mock.calls.length, 1);
      }),
  );

  it.effect("gracefully no-ops when SNI host is unavailable or on non-Linux platforms", () =>
    Effect.gen(function* () {
      const bareWayland = makeTrayHarness({ platform: "linux", throwOnCreate: true });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.makeWith(bareWayland.deps);
          yield* tray.initialize;
          yield* tray.updateState({ status: "running", runningCount: 1 });
        }),
      ).pipe(Effect.provide(bareWayland.depsLayer));
      assert.equal(bareWayland.setContextMenu.mock.calls.length, 0);
      assert.equal(bareWayland.destroy.mock.calls.length, 0);

      const macos = makeTrayHarness({ platform: "darwin" });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.makeWith(macos.deps);
          yield* tray.initialize;
          yield* tray.updateState({ status: "running", runningCount: 1 });
        }),
      ).pipe(Effect.provide(macos.depsLayer));
      assert.equal(macos.createTray.mock.calls.length, 0);
    }),
  );
});

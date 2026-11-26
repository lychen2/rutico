import * as Effect from "effect/Effect";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";

const native = vi.hoisted(() => ({
  setBadgeCount: vi.fn(),
  setOverlayIcon: vi.fn(),
  setProgressBar: vi.fn(),
  flashFrame: vi.fn(),
  isMinimized: vi.fn(() => false),
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  getFocusedWindow: vi.fn(() => null as object | null),
  image: { isEmpty: vi.fn(() => false) },
  createFromDataURL: vi.fn(),
  webContents: { send: vi.fn() },
  listeners: new Map<string, () => void>(),
  notificationSupported: true,
  notifications: [] as Array<{
    readonly options: Record<string, unknown>;
    readonly listeners: Map<string, () => void>;
    readonly show: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("electron", () => {
  class MockNotification {
    static isSupported() {
      return native.notificationSupported;
    }
    readonly listeners = new Map<string, () => void>();
    readonly show = vi.fn();
    readonly close = vi.fn();
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      native.notifications.push(this);
    }
    once(event: string, listener: () => void) {
      this.listeners.set(event, listener);
    }
  }
  return {
    app: {
      setBadgeCount: native.setBadgeCount,
      on: (event: string, listener: () => void) => native.listeners.set(event, listener),
      removeListener: (event: string) => native.listeners.delete(event),
    },
    BrowserWindow: {
      getFocusedWindow: native.getFocusedWindow,
      getAllWindows: () => [native],
    },
    nativeImage: { createFromDataURL: native.createFromDataURL },
    Notification: MockNotification,
  };
});

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installNotificationBadge } from "./notificationBadge.ts";

const badge = { count: 2, image: "data:image/png;base64,aGVsbG8=" };

beforeEach(() => {
  vi.clearAllMocks();
  native.getFocusedWindow.mockReturnValue(null);
  native.isDestroyed.mockReturnValue(false);
  native.image.isEmpty.mockReturnValue(false);
  native.createFromDataURL.mockReturnValue(native.image);
  native.setBadgeCount.mockImplementation(() => true);
  native.listeners.clear();
  native.notificationSupported = true;
  native.notifications.length = 0;
});

it.effect("validates IPC and clears on native focus, quit, and disposal", () =>
  Effect.gen(function* () {
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* installNotificationBadge();
        const handler = handlers.get("desktop:set-notification-badge")!;
        const event = { sender: { id: 1 } };
        for (const invalid of [
          { ...badge, count: -1 },
          { ...badge, count: 0.5 },
          { ...badge, count: Infinity },
          { ...badge, image: "https://example.com/icon.png" },
          { ...badge, image: `data:image/png;base64,${"a".repeat(16_384)}` },
        ]) {
          yield* Effect.promise(() => expect(handler(event, invalid)).rejects.toBeDefined());
        }
        expect(native.setBadgeCount).not.toHaveBeenCalled();
        yield* Effect.promise(() => Promise.resolve(handler(event, badge)));
        expect(native.setBadgeCount).toHaveBeenLastCalledWith(2);
        native.listeners.get("browser-window-focus")!();
        expect(native.setBadgeCount).toHaveBeenLastCalledWith(0);
        expect(native.webContents.send).toHaveBeenCalledWith("desktop:set-notification-badge");
        native.getFocusedWindow.mockReturnValue({});
        yield* Effect.promise(() => Promise.resolve(handler(event, badge)));
        expect(native.setBadgeCount).toHaveBeenLastCalledWith(0);
        expect(native.webContents.send).toHaveBeenCalledTimes(2);
        yield* Effect.promise(() => Promise.resolve(handler(event, { count: 0, image: null })));
        expect(native.webContents.send).toHaveBeenCalledTimes(2);
        native.getFocusedWindow.mockReturnValue(null);
        yield* Effect.promise(() => Promise.resolve(handler(event, badge)));
        native.listeners.get("before-quit")!();
        expect(native.setBadgeCount).toHaveBeenLastCalledWith(0);
      }),
    ).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provide([
        ElectronApp.layer,
        DesktopIpc.layerTest({
          handle: (channel, handler) => {
            handlers.set(channel, handler);
          },
          removeHandler: (channel) => {
            handlers.delete(channel);
          },
          on: vi.fn(),
          removeAllListeners: vi.fn(),
        }),
      ]),
    );
    expect(native.setBadgeCount).toHaveBeenLastCalledWith(0);
    expect(native.listeners.size).toBe(0);
    expect(handlers.size).toBe(0);
  }),
);

it.effect(
  "honors Linux launcher progress bar contract, clears flashFrame on focus/disposal, and delivers FreeDesktop notifications with urgency",
  () =>
    Effect.gen(function* () {
      const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* installNotificationBadge();
          const setProgress = handlers.get("desktop:set-taskbar-progress")!;
          const requestAttention = handlers.get("desktop:request-window-attention")!;
          const showNotification = handlers.get("desktop:show-native-notification")!;
          const closeNotification = handlers.get("desktop:close-native-notification")!;
          const event = { sender: { id: 1 } };

          // Validation rejects out-of-range progress values.
          yield* Effect.promise(() =>
            expect(setProgress(event, { progress: 5 })).rejects.toBeDefined(),
          );
          yield* Effect.promise(() =>
            expect(setProgress(event, { progress: Number.NaN })).rejects.toBeDefined(),
          );

          // Honest Linux contract: indeterminate -> 2, determinate -> [0,1], none -> -1 (no Windows mode bag).
          yield* Effect.promise(() =>
            Promise.resolve(setProgress(event, { progress: 2, mode: "indeterminate" })),
          );
          expect(native.setProgressBar).toHaveBeenLastCalledWith(2);

          yield* Effect.promise(() =>
            Promise.resolve(setProgress(event, { progress: 0.45, mode: "paused" })),
          );
          expect(native.setProgressBar).toHaveBeenLastCalledWith(0.45);

          yield* Effect.promise(() =>
            Promise.resolve(setProgress(event, { progress: 0.5, mode: "none" })),
          );
          expect(native.setProgressBar).toHaveBeenLastCalledWith(-1);

          // flashFrame(true) when unfocused, cleared on browser-window-focus.
          yield* Effect.promise(() =>
            Promise.resolve(requestAttention(event, { urgency: "critical" })),
          );
          expect(native.flashFrame).toHaveBeenLastCalledWith(true);
          native.listeners.get("browser-window-focus")!();
          expect(native.flashFrame).toHaveBeenLastCalledWith(false);

          // Already focused window does not flash.
          native.flashFrame.mockClear();
          native.getFocusedWindow.mockReturnValue(native);
          yield* Effect.promise(() =>
            Promise.resolve(requestAttention(event, { urgency: "normal" })),
          );
          expect(native.flashFrame).not.toHaveBeenCalled();

          // Native FreeDesktop notification passes urgency and routes thread click.
          native.getFocusedWindow.mockReturnValue(null);
          const shown = yield* Effect.promise(() =>
            Promise.resolve(
              showNotification(event, {
                title: "Approval needed",
                body: "Fix Wayland portal accent",
                tag: "tag-1",
                urgency: "critical",
                environmentId: "env-1",
                threadId: "thread-9",
              }),
            ),
          );
          expect(shown).toBe(true);
          expect(native.notifications).toHaveLength(1);
          expect(native.notifications[0]?.options.urgency).toBe("critical");
          expect(native.notifications[0]?.show).toHaveBeenCalledOnce();

          native.notifications[0]?.listeners.get("click")?.();
          expect(native.show).toHaveBeenCalledOnce();
          expect(native.focus).toHaveBeenCalledOnce();
          expect(native.webContents.send).toHaveBeenLastCalledWith(
            "desktop:menu-action",
            "open-thread:env-1:thread-9",
          );

          // Closing one notification by tag dismisses only that thread without disturbing another visible thread.
          const shownA = yield* Effect.promise(() =>
            Promise.resolve(
              showNotification(event, {
                title: "Approval needed",
                body: "Visible approval A",
                tag: "tag-visible-a",
                urgency: "critical",
                environmentId: "env-1",
                threadId: "thread-a",
              }),
            ),
          );
          const shownB = yield* Effect.promise(() =>
            Promise.resolve(
              showNotification(event, {
                title: "Approval needed",
                body: "Hidden approval B",
                tag: "tag-hidden-b",
                urgency: "critical",
                environmentId: "env-1",
                threadId: "thread-b",
              }),
            ),
          );
          expect(shownA).toBe(true);
          expect(shownB).toBe(true);
          const notificationA = native.notifications.at(-2)!;
          const notificationB = native.notifications.at(-1)!;
          yield* Effect.promise(() => Promise.resolve(closeNotification(event, "tag-hidden-b")));
          expect(notificationB.close).toHaveBeenCalledOnce();
          expect(notificationA.close).not.toHaveBeenCalled();

          // Graceful false when Notification.isSupported() is false.
          native.notificationSupported = false;
          const unsupported = yield* Effect.promise(() =>
            Promise.resolve(
              showNotification(event, {
                title: "Thread completed",
                body: "Done",
              }),
            ),
          );
          expect(unsupported).toBe(false);
        }),
      ).pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provide([
          ElectronApp.layer,
          DesktopIpc.layerTest({
            handle: (channel, handler) => {
              handlers.set(channel, handler);
            },
            removeHandler: (channel) => {
              handlers.delete(channel);
            },
            on: vi.fn(),
            removeAllListeners: vi.fn(),
          }),
        ]),
      );

      // Finalizer clears progress bar and flashFrame.
      expect(native.setProgressBar).toHaveBeenLastCalledWith(-1);
      expect(native.flashFrame).toHaveBeenLastCalledWith(false);
    }),
);

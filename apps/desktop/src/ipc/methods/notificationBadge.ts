import {
  DesktopNativeNotificationSchema,
  DesktopNativeNotificationTagSchema,
  DesktopTaskbarProgressSchema,
  DesktopWindowAttentionSchema,
  type DesktopTaskbarProgress,
} from "@t3tools/contracts";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  CLOSE_NATIVE_NOTIFICATION_CHANNEL,
  MENU_ACTION_CHANNEL,
  REQUEST_WINDOW_ATTENTION_CHANNEL,
  SET_NOTIFICATION_BADGE_CHANNEL,
  SET_TASKBAR_PROGRESS_CHANNEL,
  SHOW_NATIVE_NOTIFICATION_CHANNEL,
} from "../channels.ts";

const NotificationBadge = Schema.Struct({
  count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2_147_483_647 })),
  image: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(16_384),
      Schema.isPattern(/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i),
    ),
  ),
});

function applyNotificationBadge(
  platform: NodeJS.Platform,
  { count, image }: typeof NotificationBadge.Type,
): void {
  try {
    if (Electron.BrowserWindow.getFocusedWindow()) count = 0;
    if (platform === "win32") {
      const overlay = count > 0 && image ? Electron.nativeImage.createFromDataURL(image) : null;
      for (const window of Electron.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.setOverlayIcon(
            overlay?.isEmpty() ? null : overlay,
            count > 0 ? `${count} threads with new notifications` : "",
          );
        }
      }
    } else if (platform === "darwin" || platform === "linux") {
      Electron.app.setBadgeCount(count);
    }
  } catch (error) {
    Effect.runSync(Effect.logWarning("Could not update notification badge", error));
  }
}

function normalizeLinuxProgressValue(input: DesktopTaskbarProgress): number {
  if (input.mode === "none" || input.progress < 0) return -1;
  if (input.mode === "indeterminate" || input.progress > 1) return 2;
  return Math.min(1, Math.max(0, input.progress));
}

function applyTaskbarProgress(platform: NodeJS.Platform, input: DesktopTaskbarProgress): void {
  try {
    for (const window of Electron.BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || typeof window.setProgressBar !== "function") continue;
      if (platform === "win32") {
        const mode = input.mode ?? (input.progress < 0 ? "none" : "normal");
        window.setProgressBar(input.progress, { mode });
      } else if (platform === "linux") {
        // Honest Linux Unity/KDE/GNOME Launcher contract: -1 hides, [0, 1] determinate, 2 indeterminate.
        // Windows-only paused/error bar colors are intentionally not assumed on Linux.
        window.setProgressBar(normalizeLinuxProgressValue(input));
      } else {
        window.setProgressBar(input.mode === "none" ? -1 : input.progress);
      }
    }
  } catch (error) {
    Effect.runSync(Effect.logWarning("Could not update taskbar progress", error));
  }
}

function applyWindowFlashFrame(flag: boolean): void {
  try {
    if (flag && Electron.BrowserWindow.getFocusedWindow()) return;
    for (const window of Electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && typeof window.flashFrame === "function") {
        window.flashFrame(flag);
      }
    }
  } catch (error) {
    Effect.runSync(Effect.logWarning("Could not update window attention hint", error));
  }
}

export const installNotificationBadge = Effect.fn("desktop.ipc.installNotificationBadge")(
  function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const app = yield* ElectronApp.ElectronApp;
    const platform = yield* HostProcess.Platform;
    const assetsOption = yield* Effect.serviceOption(DesktopAssets.DesktopAssets);
    const activeNativeNotifications = new Map<string, Electron.Notification>();

    const closeNativeNotification = (tagKey: string) => {
      const existing = activeNativeNotifications.get(tagKey);
      if (!existing) return;
      activeNativeNotifications.delete(tagKey);
      try {
        existing.close();
      } catch {}
    };

    const closeAllNativeNotifications = () => {
      for (const notification of activeNativeNotifications.values()) {
        try {
          notification.close();
        } catch {}
      }
      activeNativeNotifications.clear();
    };

    const clear = () => {
      applyNotificationBadge(platform, { count: 0, image: null });
      applyWindowFlashFrame(false);
      closeAllNativeNotifications();
      for (const window of Electron.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(SET_NOTIFICATION_BADGE_CHANNEL);
      }
    };

    const clearOnExit = () => {
      applyTaskbarProgress(platform, { progress: -1, mode: "none" });
      clear();
    };

    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: SET_NOTIFICATION_BADGE_CHANNEL,
        payload: NotificationBadge,
        result: Schema.Void,
        handler: (badge) =>
          Effect.sync(() => {
            if (badge.count > 0 && Electron.BrowserWindow.getFocusedWindow()) clear();
            else applyNotificationBadge(platform, badge);
          }),
      }),
    );

    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: SET_TASKBAR_PROGRESS_CHANNEL,
        payload: DesktopTaskbarProgressSchema,
        result: Schema.Void,
        handler: (input) =>
          Effect.sync(() => {
            applyTaskbarProgress(platform, input);
          }),
      }),
    );

    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: REQUEST_WINDOW_ATTENTION_CHANNEL,
        payload: Schema.UndefinedOr(DesktopWindowAttentionSchema),
        result: Schema.Void,
        handler: () =>
          Effect.sync(() => {
            applyWindowFlashFrame(true);
          }),
      }),
    );

    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: SHOW_NATIVE_NOTIFICATION_CHANNEL,
        payload: DesktopNativeNotificationSchema,
        result: Schema.Boolean,
        handler: Effect.fn("desktop.ipc.showNativeNotification")(function* (input) {
          if (
            typeof Electron.Notification !== "function" ||
            (typeof Electron.Notification.isSupported === "function" &&
              !Electron.Notification.isSupported())
          ) {
            return false;
          }
          const iconPath = Option.isSome(assetsOption)
            ? Option.getOrUndefined((yield* assetsOption.value.iconPaths).png)
            : undefined;
          return yield* Effect.sync(() => {
            try {
              const tagKey = input.tag ?? `${input.title}:${input.body}`;
              const previous = activeNativeNotifications.get(tagKey);
              if (previous) {
                try {
                  previous.close();
                } catch {}
              }
              const notification = new Electron.Notification({
                title: input.title,
                body: input.body,
                silent: true,
                ...(platform === "linux" ? { urgency: input.urgency ?? "normal" } : {}),
                ...(iconPath ? { icon: iconPath } : {}),
              });
              activeNativeNotifications.set(tagKey, notification);
              notification.once("close", () => {
                if (activeNativeNotifications.get(tagKey) === notification) {
                  activeNativeNotifications.delete(tagKey);
                }
              });
              notification.once("click", () => {
                if (activeNativeNotifications.get(tagKey) === notification) {
                  activeNativeNotifications.delete(tagKey);
                }
                const target =
                  Electron.BrowserWindow.getFocusedWindow() ??
                  Electron.BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
                if (target && !target.isDestroyed()) {
                  if (typeof target.isMinimized === "function" && target.isMinimized()) {
                    target.restore();
                  }
                  if (typeof target.show === "function") target.show();
                  if (typeof target.focus === "function") target.focus();
                  if (input.environmentId && input.threadId) {
                    target.webContents.send(
                      MENU_ACTION_CHANNEL,
                      `open-thread:${encodeURIComponent(input.environmentId)}:${encodeURIComponent(input.threadId)}`,
                    );
                  }
                }
              });
              notification.show();
              return true;
            } catch {
              return false;
            }
          });
        }),
      }),
    );

    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: CLOSE_NATIVE_NOTIFICATION_CHANNEL,
        payload: DesktopNativeNotificationTagSchema,
        result: Schema.Void,
        handler: Effect.fn("desktop.ipc.closeNativeNotification")(function* (tag) {
          yield* Effect.sync(() => {
            closeNativeNotification(tag);
          });
        }),
      }),
    );

    yield* app.on("browser-window-focus", clear);
    yield* app.on("before-quit", clearOnExit);
    yield* Effect.addFinalizer(() => Effect.sync(clearOnExit));
  },
);

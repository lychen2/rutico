import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { WEB_LINK_OPEN_CHANNEL } from "../ipc/channels.ts";

const DESKTOP_QUICK_ACTIONS = new Set(["new-thread", "command-palette", "settings"] as const);
type DesktopQuickAction = "new-thread" | "command-palette" | "settings";

const QUICK_ACTION_FLAG_PREFIX = "--quick-action=";
const QUICK_ACTION_URL_PATTERN =
  /^(?:t3code|t3code-dev|rutico):\/\/action\/(new-thread|command-palette|settings)\/?$/i;

export function parseDesktopQuickActionArg(value: string | undefined): DesktopQuickAction | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith(QUICK_ACTION_FLAG_PREFIX)) {
    const candidate = trimmed.slice(QUICK_ACTION_FLAG_PREFIX.length).toLowerCase();
    return DESKTOP_QUICK_ACTIONS.has(candidate as DesktopQuickAction)
      ? (candidate as DesktopQuickAction)
      : null;
  }
  const urlMatch = QUICK_ACTION_URL_PATTERN.exec(trimmed);
  if (urlMatch?.[1]) {
    const candidate = urlMatch[1].toLowerCase();
    return DESKTOP_QUICK_ACTIONS.has(candidate as DesktopQuickAction)
      ? (candidate as DesktopQuickAction)
      : null;
  }
  return null;
}

export function desktopQuickActionUrl(action: DesktopQuickAction, isDevelopment: boolean): string {
  return `${ElectronProtocol.getDesktopScheme(isDevelopment)}://action/${action}`;
}

export const isWebLink = (value: string) => {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
};

export const isWebPageFile = (path: string) => /\.x?html?$/i.test(path);

export class DesktopWebLinks extends Context.Service<
  DesktopWebLinks,
  {
    readonly receive: (url: string) => Effect.Effect<void>;
    readonly setRendererReady: (ready: boolean) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopWebLinks") {}

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const pending: Array<string> = [];
  let listening: Electron.WebContents | null = null;
  let detachListening: (() => void) | null = null;
  let rendererHasListened = false;

  const stopListening = () => {
    detachListening?.();
    detachListening = null;
    listening = null;
  };

  const flush = Effect.gen(function* () {
    if (listening === null || pending.length === 0) return;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.webContents !== listening) return;
    if (listening.isDestroyed()) {
      stopListening();
      return;
    }
    for (const url of pending.splice(0)) listening.send(WEB_LINK_OPEN_CHANNEL, url);
    yield* desktopWindow.activate.pipe(Effect.ignore);
  });

  const startListening = Effect.gen(function* () {
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.webContents.isDestroyed()) return;
    const webContents = window.value.webContents;
    if (listening === webContents) return;
    stopListening();
    listening = webContents;
    rendererHasListened = true;
    const onNavigation = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ) => {
      if (event.isMainFrame && !event.isSameDocument) stopListening();
    };
    webContents.on("did-start-navigation", onNavigation);
    webContents.on("render-process-gone", stopListening);
    webContents.once("destroyed", stopListening);
    detachListening = () => {
      webContents.removeListener("did-start-navigation", onNavigation);
      webContents.removeListener("render-process-gone", stopListening);
      webContents.removeListener("destroyed", stopListening);
    };
  });

  return DesktopWebLinks.of({
    receive: Effect.fn("DesktopWebLinks.receive")(function* (url) {
      pending.push(url);
      yield* flush;
      if (!rendererHasListened || Option.isSome(yield* electronWindow.main)) return;
      // macOS fires `activate` only on reopen, not when a link opens the app.
      yield* desktopWindow.activate.pipe(Effect.ignore);
    }),
    setRendererReady: Effect.fn("DesktopWebLinks.setRendererReady")(function (ready) {
      return ready ? startListening : Effect.sync(stopListening);
    }, Effect.andThen(flush)),
  });
});

export const layer = Layer.effect(DesktopWebLinks, make);

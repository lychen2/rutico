import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";

import * as Electron from "electron";
import { msg } from "gt-i18n";

import {
  type DatabaseMigrationProgress,
  type DesktopSnapShotEvent,
  type DesktopWindowZoomState,
  type LinuxWindowState,
  type MainWindowZoomDirection,
  DEFAULT_CLIENT_SETTINGS,
} from "@t3tools/contracts";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopClerk from "../app/DesktopClerk.ts";
import { resolveLinuxDesktopSessionInfo } from "../app/DesktopEarlyElectronStartup.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopPrimaryPaste from "../app/DesktopPrimaryPaste.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import { getDesktopOrigin, getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  LINUX_PORTAL_APPEARANCE_CHANNEL,
  LINUX_WINDOW_STATE_CHANNEL,
  MENU_ACTION_CHANNEL,
  QUIT_SHORTCUT_CHANNEL,
  SNAP_SHOT_EVENT_CHANNEL,
  TRACKPAD_SCROLL_BEGIN_CHANNEL,
  TRACKPAD_SCROLL_END_CHANNEL,
  WINDOW_FULLSCREEN_STATE_CHANNEL,
  WINDOW_ZOOM_STATE_CHANNEL,
} from "../ipc/channels.ts";
import {
  PASSKEY_BRIDGE_ARGUMENT,
  PRIMARY_PASTE_DISABLED_ARGUMENT,
} from "../preview/GuestProtocol.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as PreviewPasskeys from "../preview/Passkeys.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { m } from "../i18n/messages.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";
import { makeQuitShortcutHandler } from "./QuitHold.ts";
import { copyContextMenuImage } from "./ContextMenuImage.ts";
import { installMainWindowRemoteRequestHeaderPolicy } from "./RemoteRequestHeaders.ts";

const TITLEBAR_HEIGHT = 40;

const linuxWindowNativeWco = new WeakMap<object, boolean>();

export const LINUX_NATIVE_WCO_PROBE_SCRIPT =
  'typeof navigator !== "undefined" && Boolean(navigator.windowControlsOverlay?.visible)';

export function recordLinuxWindowNativeWco(
  window: Pick<Electron.BrowserWindow, "isMaximized" | "isFullScreen">,
  hasNativeWco: boolean,
): void {
  linuxWindowNativeWco.set(window, hasNativeWco);
}

export function resolveLinuxWindowNativeWco(
  window: Pick<Electron.BrowserWindow, "isMaximized" | "isFullScreen"> & {
    readonly setTitleBarOverlay?: Electron.BrowserWindow["setTitleBarOverlay"];
  },
): boolean | undefined {
  const recorded = linuxWindowNativeWco.get(window);
  if (recorded !== undefined) {
    return recorded;
  }
  if (typeof window.setTitleBarOverlay !== "function") {
    return false;
  }
  return undefined;
}

export function buildLinuxWindowState(
  window: Pick<Electron.BrowserWindow, "isMaximized" | "isFullScreen"> & {
    readonly setTitleBarOverlay?: Electron.BrowserWindow["setTitleBarOverlay"];
  },
  env: NodeJS.ProcessEnv = process.env,
  hasNativeWco?: boolean,
): LinuxWindowState {
  const session = resolveLinuxDesktopSessionInfo(env);
  const resolvedNativeWco = hasNativeWco ?? resolveLinuxWindowNativeWco(window);
  return {
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
    linuxDesktop: session.linuxDesktop,
    isTilingWm: session.isTilingWm,
    ...(resolvedNativeWco !== undefined ? { hasNativeWco: resolvedNativeWco } : {}),
    overlayHeight: TITLEBAR_HEIGHT,
  };
}

/**
 * Tracks forked background fibers for scope-exit interruption without referencing
 * an uninitialized `fiber` binding when an Effect finishes synchronously inside `runFork`.
 */
export const makeScopedFiberTracker = Effect.fn("desktop.window.makeScopedFiberTracker")(function* <
  R,
>() {
  const context = yield* Effect.context<R>();
  const runFork = Effect.runForkWith(context);
  const fibers = new Set<Fiber.Fiber<void, never>>();
  const track = (effect: Effect.Effect<void, never, R>): Fiber.Fiber<void, never> => {
    let completed = false;
    let fiber: Fiber.Fiber<void, never> | undefined;
    fiber = runFork(
      effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            completed = true;
            if (fiber !== undefined) {
              fibers.delete(fiber);
            }
          }),
        ),
      ),
    );
    if (!completed) {
      fibers.add(fiber);
    }
    return fiber;
  };
  const interruptAll = Effect.suspend(() =>
    Effect.forEach([...fibers], (fiber) => Fiber.interrupt(fiber), {
      concurrency: "unbounded",
      discard: true,
    }),
  ).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        fibers.clear();
      }),
    ),
  );
  return { fibers, track, interruptAll };
});

export function buildDesktopWindowZoomState(
  window: Pick<Electron.BrowserWindow, "getBounds" | "webContents">,
): DesktopWindowZoomState {
  const rawZoom =
    typeof window.webContents.getZoomFactor === "function" ? window.webContents.getZoomFactor() : 1;
  const zoomFactor = Number.isFinite(rawZoom) && rawZoom > 0 ? rawZoom : 1;
  let deviceScaleFactor = 1;
  try {
    if (
      typeof window.getBounds === "function" &&
      typeof Electron.screen?.getDisplayMatching === "function"
    ) {
      const display = Electron.screen.getDisplayMatching(window.getBounds());
      if (Number.isFinite(display?.scaleFactor) && display.scaleFactor > 0) {
        deviceScaleFactor = display.scaleFactor;
      }
    }
  } catch {
    deviceScaleFactor = 1;
  }
  return { zoomFactor, deviceScaleFactor };
}

class ContextMenuImageCopyError extends Schema.TaggedError<ContextMenuImageCopyError>()(
  "ContextMenuImageCopyError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not copy the context-menu image.";
  }
}
// Match --workspace-topbar-height in apps/web/src/index.css; native macOS buttons stay 14 points at any zoom.
const MACOS_WORKSPACE_TOPBAR_HEIGHT = 52;
const MACOS_WINDOW_BUTTON_RADIUS = 7;

function parseMailtoAddress(rawUrl: string): Option.Option<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Option.none();
  }
  if (url.protocol !== "mailto:" || url.pathname === "") return Option.none();
  try {
    return Option.some(decodeURIComponent(url.pathname));
  } catch {
    return Option.some(url.pathname);
  }
}

function syncMacosWindowButtons(window: Electron.BrowserWindow): void {
  if (window.isDestroyed() || window.isFullScreen()) return;
  window.setWindowButtonPosition({
    x: 16,
    y: Math.round(
      (MACOS_WORKSPACE_TOPBAR_HEIGHT * window.webContents.getZoomFactor()) / 2 -
        MACOS_WINDOW_BUTTON_RADIUS,
    ),
  });
}

const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_LIGHT_INACTIVE_SYMBOL_COLOR = "#9ca3af";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const TITLEBAR_DARK_INACTIVE_SYMBOL_COLOR = "#94a3b8";
const SPLASH_FADE_STEP_MS = 30;
const SPLASH_FADE_OPACITIES = [0.75, 0.5, 0.25, 0] as const;
const LINUX_SPLASH_CONTENT_FADE_MS = 130;
const LINUX_SPLASH_DISMISS_TIMEOUT_MS = 140;
const LINUX_EXIT_CURTAIN_MS = 90;
export const LINUX_SPLASH_DISMISS_CONTENT_SCRIPT = `(() => {
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  const content = document.querySelector(".splash-content");
  if (!content) return false;
  content.classList.add("dismissing");
  return true;
})();`;
const MAIN_WINDOW_BOUNDS_PERSIST_DEBOUNCE_MS = 500;
const DEVELOPMENT_LOAD_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;
const RENDERER_RECOVERY_RELOAD_DELAY_MS = 500;
const RENDERER_RECOVERY_MAX_ATTEMPTS = 3;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;
const DEVELOPMENT_RETRYABLE_LOAD_ERROR_CODES = new Set([-2, -7, -9, -102, -105, -106, -118]);

type WindowTitleBarOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type WindowVibrancyOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "visualEffectState" | "backgroundMaterial"
> & {
  readonly vibrancy?: NonNullable<Parameters<Electron.BrowserWindow["setVibrancy"]>[0]>;
};

type DesktopWindowRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopState.DesktopState
  | DesktopAssets.DesktopAssets
  | DesktopAppSettings.DesktopAppSettings
  | DesktopClientSettings.DesktopClientSettings
  | ElectronApp.ElectronApp
  | ElectronMenu.ElectronMenu
  | ElectronShell.ElectronShell
  | ElectronTheme.ElectronTheme
  | ElectronWindow.ElectronWindow
  | DesktopRendererHistory.DesktopRendererHistory
  | PreviewManager.PreviewManager;

export type DesktopWindowError =
  | ElectronWindow.ElectronWindowCreateError
  | PreviewManager.PreviewManagerError;

export type { MainWindowZoomDirection };
export type MainWindowContentsCommand = "reload" | "forceReload" | "toggleDevTools";

export class DesktopWindow extends Context.Service<
  DesktopWindow,
  {
    readonly createMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly ensureMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly revealOrCreateMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly activate: Effect.Effect<void, DesktopWindowError>;
    readonly createMainIfBackendReady: Effect.Effect<void, DesktopWindowError>;
    readonly showConnectingSplash: Effect.Effect<void>;
    readonly handleBackendReady: (httpBaseUrl: URL) => Effect.Effect<void, DesktopWindowError>;
    readonly handleBackendNotReady: Effect.Effect<void>;
    readonly flushMainWindowBounds: Effect.Effect<void>;
    readonly prepareCaptureReveal: Effect.Effect<void>;
    readonly dispatchMenuAction: (
      action: string,
      options?: { readonly reveal?: boolean },
    ) => Effect.Effect<void, DesktopWindowError>;
    readonly dispatchSnapShotEvent: (
      event: DesktopSnapShotEvent,
    ) => Effect.Effect<void, DesktopWindowError>;
    // Electron zoom roles target focused guests; zoomMain must always target the app.
    readonly zoomMain: (direction: MainWindowZoomDirection) => Effect.Effect<void>;
    readonly runMainContentsCommand: (command: MainWindowContentsCommand) => Effect.Effect<void>;
    readonly syncAppearance: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopWindow") {}

const { logInfo: logWindowInfo, logWarning: logWindowWarning } =
  makeComponentLogger("desktop-window");

function getIconOption(
  iconPaths: DesktopAssets.DesktopIconPaths,
  platform: NodeJS.Platform,
): { icon: string } | Record<string, never> {
  if (platform === "darwin") return {};
  const ext = platform === "win32" ? "ico" : "png";
  return Option.match(iconPaths[ext], {
    onNone: () => ({}),
    onSome: (icon) => ({ icon }),
  });
}

// Canvas surface hexes matching packages/shared/src/themePalettes.ts so cold-start
// windows match the Rutico palette instead of flashing stark #000000/#ffffff.
export const DEFAULT_WINDOW_BACKGROUND_COLORS = {
  dark: "#121019",
  light: "#faf7fd",
} as const;

const THEME_WINDOW_BACKGROUND_COLORS: Readonly<
  Record<string, { readonly dark: string; readonly light: string }>
> = {
  rutico: DEFAULT_WINDOW_BACKGROUND_COLORS,
  "t3-chat": { dark: "#1f1a24", light: "#fdf7fd" },
  "t3-chat-dark": { dark: "#1f1a24", light: "#1f1a24" },
  grove: { dark: "#1b2821", light: "#f3f7f4" },
  "t3-grove": { dark: "#1b2821", light: "#f3f7f4" },
  ocean: { dark: "#17212b", light: "#f5f7f8" },
  "t3-ocean": { dark: "#17212b", light: "#f5f7f8" },
  ember: { dark: "#291e1a", light: "#f9f7f5" },
  "t3-ember": { dark: "#291e1a", light: "#f9f7f5" },
  iris: { dark: "#1d1929", light: "#f8f7f9" },
  "t3-iris": { dark: "#1d1929", light: "#f8f7f9" },
  dark: { dark: "#0a0a0a", light: "#0a0a0a" },
  light: { dark: "#fcfcfc", light: "#fcfcfc" },
};

const HEX_BACKGROUND_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const PersistedThemeSettingsSchema = Schema.Struct({
  defaultTheme: Schema.optionalKey(Schema.String),
});
const decodePersistedThemeSettings = Schema.decodeUnknownOption(
  Schema.fromJsonString(PersistedThemeSettingsSchema),
);

export function getInitialWindowBackgroundColor(
  shouldUseDarkColors: boolean,
  persistedTheme?: string | null,
): string {
  const trimmed = persistedTheme?.trim();
  if (trimmed) {
    if (HEX_BACKGROUND_COLOR_PATTERN.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    const palette = THEME_WINDOW_BACKGROUND_COLORS[trimmed.toLowerCase()];
    if (palette !== undefined) {
      return shouldUseDarkColors ? palette.dark : palette.light;
    }
  }
  return shouldUseDarkColors
    ? DEFAULT_WINDOW_BACKGROUND_COLORS.dark
    : DEFAULT_WINDOW_BACKGROUND_COLORS.light;
}

type DisplayBounds = Pick<Electron.Rectangle, "x" | "y" | "width" | "height">;

// A window snapped to a display edge can be reported 1px past that edge.
const SAVED_BOUNDS_EDGE_TOLERANCE_PX = 1;

function windowFitsWithinDisplay(
  windowBounds: DesktopAppSettings.DesktopWindowBounds,
  displayBounds: DisplayBounds,
): boolean {
  const tolerance = SAVED_BOUNDS_EDGE_TOLERANCE_PX;
  return (
    windowBounds.x >= displayBounds.x - tolerance &&
    windowBounds.y >= displayBounds.y - tolerance &&
    windowBounds.x + windowBounds.width <= displayBounds.x + displayBounds.width + tolerance &&
    windowBounds.y + windowBounds.height <= displayBounds.y + displayBounds.height + tolerance
  );
}

function overlapArea(left: DisplayBounds, right: DisplayBounds): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function displayMatching(
  bounds: DisplayBounds,
  displays: readonly DisplayBounds[],
): DisplayBounds | undefined {
  let match: DisplayBounds | undefined;
  let matchArea = 0;
  for (const display of displays) {
    const area = overlapArea(bounds, display);
    if (area > matchArea) {
      match = display;
      matchArea = area;
    }
  }
  return match;
}

// Normal bounds of a maximized window can sit on, or straddle into, another display than the window.
function normalBoundsOnWindowDisplay(
  normalBounds: DisplayBounds,
  windowBounds: DisplayBounds,
  displays: readonly DisplayBounds[],
): DisplayBounds {
  const target = displayMatching(windowBounds, displays);
  if (target === undefined || windowFitsWithinDisplay(normalBounds, target)) {
    return normalBounds;
  }
  const source = displayMatching(normalBounds, displays) ?? target;
  const width = Math.min(normalBounds.width, target.width);
  const height = Math.min(normalBounds.height, target.height);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  return {
    x: clamp(target.x + normalBounds.x - source.x, target.x, target.x + target.width - width),
    y: clamp(target.y + normalBounds.y - source.y, target.y, target.y + target.height - height),
    width,
    height,
  };
}

function readDisplayBoundsOrEmpty(): readonly DisplayBounds[] {
  try {
    return Electron.screen.getAllDisplays().map((display) => display.bounds);
  } catch {
    return [];
  }
}

function windowBoundsEqual(
  left: DesktopAppSettings.DesktopWindowBounds,
  right: DesktopAppSettings.DesktopWindowBounds,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function resolveInitialMainWindowBounds(
  persistedBounds: DesktopAppSettings.DesktopWindowBounds | null,
  displays: readonly DisplayBounds[],
): DesktopAppSettings.DesktopWindowBounds | typeof DesktopAppSettings.DEFAULT_MAIN_WINDOW_SIZE {
  if (
    persistedBounds !== null &&
    displays.some((display) => windowFitsWithinDisplay(persistedBounds, display))
  ) {
    return persistedBounds;
  }
  return DesktopAppSettings.DEFAULT_MAIN_WINDOW_SIZE;
}

const RUTICO_SPLASH_EMBLEM_SVG =
  '<svg class="emblem" viewBox="32 20 76 86" width="28" height="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M35 34C35 29.5817 38.5817 26 43 26H66.5C80.5833 26 90 34.4 90 46.5C90 57.6 82.05 65.4 69.8 66.8H51V54.2H65.2C71.7 54.2 75.6 51.3 75.6 46.5C75.6 41.7 71.7 38.8 65.2 38.8H50.2V94C50.2 98.4183 46.6183 102 42.2 102H40.5C37.4624 102 35 99.5376 35 96.5V34Z" fill="currentColor"/><path d="M56.5 70.5H72.2C74.9 70.5 77.4 71.9 78.8 74.2L94.4 99.2C95.3 100.6 94.1 102.4 92.5 102L84.8 99.8L79.6 102.5C78.4 103.1 76.9 102.6 76.2 101.5L56.5 70.5Z" fill="currentColor" fill-opacity="0.78"/><path d="M97 23L99.5 29.5L106 32L99.5 34.5L97 41L94.5 34.5L88 32L94.5 29.5L97 23Z" fill="currentColor" fill-opacity="0.9"/></svg>';

export function buildConnectingSplashDataUrl(
  shouldUseDarkColors: boolean,
  persistedTheme?: string | null,
  progress?: DatabaseMigrationProgress | null,
): string {
  const background = getInitialWindowBackgroundColor(shouldUseDarkColors, persistedTheme);
  const foreground = shouldUseDarkColors ? "#f6f4fc" : "#1c1729";
  const label = shouldUseDarkColors ? "#b0adbe" : "#5d576b";
  const accent = shouldUseDarkColors ? "#b4a3fd" : "#684dc6";
  const track = shouldUseDarkColors ? "rgba(180,163,253,0.22)" : "rgba(104,77,198,0.18)";
  const hairline = shouldUseDarkColors ? "rgba(255,255,255,0.08)" : "rgba(28,23,41,0.08)";
  const specular = shouldUseDarkColors ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.72)";
  const ribbon = shouldUseDarkColors ? "rgba(180,163,253,0.34)" : "rgba(104,77,198,0.26)";
  const message = progress
    ? `Upgrading database (${progress.current} of ${progress.total})`
    : "Connecting to WSL…";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%}body{box-sizing:border-box;background:${background};color:${foreground};border:1px solid ${hairline};border-radius:14px;box-shadow:inset 0 1px 0 ${specular};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;-webkit-user-select:none;user-select:none;-webkit-app-region:drag}@supports (corner-shape: superellipse(1.25)){body{corner-shape:superellipse(1.25)}}.splash-content{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;opacity:1;transform:scale(1);transition:opacity ${LINUX_SPLASH_CONTENT_FADE_MS}ms cubic-bezier(0.23,1,0.32,1),transform ${LINUX_SPLASH_CONTENT_FADE_MS}ms cubic-bezier(0.23,1,0.32,1)}.splash-content.dismissing{opacity:0;transform:scale(0.985)}.emblem-wrap{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px}.emblem{display:block;color:${foreground}}.ribbon{position:relative;width:54px;height:2px;border-radius:999px;background:${track};overflow:hidden}.ribbon::after{content:'';position:absolute;inset:0;width:55%;background:linear-gradient(90deg,transparent,${ribbon},transparent);transform:translateX(-120%);animation:sheen 1.6s cubic-bezier(0.23,1,0.32,1) infinite}@keyframes sheen{to{transform:translateX(220%)}}.status{display:flex;align-items:center;gap:9px;color:${label};font-size:12.5px;line-height:1.2;letter-spacing:-0.005em}.spinner{width:14px;height:14px;box-sizing:border-box;border:2px solid ${track};border-top-color:${accent};border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){.spinner{animation:none;border-color:${accent};opacity:0.55}.ribbon::after{animation:none;transform:none;width:100%;opacity:0.45}.splash-content{transition:none}}</style></head><body><div class="splash-content"><div class="emblem-wrap">${RUTICO_SPLASH_EMBLEM_SVG}<div class="ribbon" aria-hidden="true"></div></div><div class="status"><div class="spinner" aria-hidden="true"></div><span>${message}</span></div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function isSameOriginRendererNavigation(input: {
  readonly applicationUrl: string;
  readonly navigationUrl: string;
}): boolean {
  try {
    const applicationUrl = new URL(input.applicationUrl);
    const navigationUrl = new URL(input.navigationUrl);
    // Node serializes custom-scheme origins as "null", even for different hosts and schemes.
    return (
      applicationUrl.host !== "" &&
      navigationUrl.protocol === applicationUrl.protocol &&
      navigationUrl.host === applicationUrl.host
    );
  } catch {
    return false;
  }
}

function isRetryableDevelopmentRendererLoadFailure(input: {
  readonly applicationUrl: string;
  readonly errorCode: number;
  readonly isMainFrame: boolean;
  readonly validatedUrl: string;
}): boolean {
  return (
    input.isMainFrame &&
    DEVELOPMENT_RETRYABLE_LOAD_ERROR_CODES.has(input.errorCode) &&
    isSameOriginRendererNavigation({
      applicationUrl: input.applicationUrl,
      navigationUrl: input.validatedUrl,
    })
  );
}

function concealPendingQuitWindow(
  window: Pick<
    Electron.BrowserWindow,
    "isDestroyed" | "isFullScreen" | "setFullScreen" | "setOpacity"
  >,
  platform: NodeJS.Platform,
): void {
  if (window.isDestroyed()) return;
  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }
  // Linux lacks Electron window opacity; the renderer paints a 90ms exit curtain instead.
  if (platform !== "linux") {
    window.setOpacity(0);
  }
}

// Low-specificity (:where) fallback aligned with apps/web/src/index.css so inactive
// chrome dims out of the box without double-dimming when web styles are present.
export const DESKTOP_INACTIVE_WINDOW_CSS = [
  ':where(html[data-desktop-window-focused]) :where(.drag-region:not([data-app-sidebar] *) > *, [data-app-sidebar] :is([data-slot="sidebar-header"], [data-slot="sidebar-content"], [data-slot="sidebar-footer"])) {',
  "  transition: opacity 180ms cubic-bezier(0, 0, 0.58, 1);",
  "}",
  ':where(html[data-desktop-window-focused="false"]) :where(.drag-region:not([data-app-sidebar] *) > *) {',
  "  opacity: 0.72;",
  "}",
  ':where(html[data-desktop-window-focused="false"]) :where([data-app-sidebar] :is([data-slot="sidebar-header"], [data-slot="sidebar-content"], [data-slot="sidebar-footer"])) {',
  "  opacity: 0.85;",
  "}",
  "@media (prefers-reduced-motion: reduce) {",
  '  :where(html[data-desktop-window-focused]) :where(.drag-region:not([data-app-sidebar] *) > *, [data-app-sidebar] :is([data-slot="sidebar-header"], [data-slot="sidebar-content"], [data-slot="sidebar-footer"])) {',
  "    transition: none;",
  "  }",
  "}",
].join("\n");

export function buildWindowFocusStateScript(focused: boolean): string {
  const value = focused ? "true" : "false";
  return `(() => {
    const root = document.documentElement;
    if (!root) return;
    if (root.getAttribute("data-desktop-window-focused") === "${value}") return;
    root.setAttribute("data-desktop-window-focused", "${value}");
    window.dispatchEvent(new CustomEvent("rutico:desktop-window-focus-change", { detail: { focused: ${value} } }));
  })();`;
}

function syncWindowFocusState(window: Electron.BrowserWindow, focused: boolean): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  if (typeof window.webContents.executeJavaScript !== "function") return;
  void window.webContents
    .executeJavaScript(buildWindowFocusStateScript(focused))
    .catch(() => undefined);
}

function getWindowTitleBarOptions(
  shouldUseDarkColors: boolean,
  platform: NodeJS.Platform,
  isFocused = true,
): WindowTitleBarOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: {
        x: 16,
        y: MACOS_WORKSPACE_TOPBAR_HEIGHT / 2 - MACOS_WINDOW_BUTTON_RADIUS,
      },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: shouldUseDarkColors
        ? isFocused
          ? TITLEBAR_DARK_SYMBOL_COLOR
          : TITLEBAR_DARK_INACTIVE_SYMBOL_COLOR
        : isFocused
          ? TITLEBAR_LIGHT_SYMBOL_COLOR
          : TITLEBAR_LIGHT_INACTIVE_SYMBOL_COLOR,
    },
  };
}

export function resolveWindowVibrancyOptions(input: {
  readonly platform: NodeJS.Platform;
  readonly glassOpacity: number;
  readonly prefersReducedTransparency: boolean;
}): WindowVibrancyOptions {
  if (input.glassOpacity >= 100 || input.prefersReducedTransparency) {
    return {};
  }
  if (input.platform === "darwin") {
    return {
      vibrancy: "under-window",
      visualEffectState: "followWindow",
    };
  }
  if (input.platform === "win32") {
    return {
      backgroundMaterial: "mica",
    };
  }
  return {};
}

function resolveWindowBackgroundColor(
  shouldUseDarkColors: boolean,
  persistedTheme: string | null | undefined,
  vibrancyOptions?: WindowVibrancyOptions,
): string {
  // Native vibrancy/mica requires a transparent window surface so OS backdrop material shows through.
  if (
    vibrancyOptions?.vibrancy !== undefined ||
    vibrancyOptions?.backgroundMaterial !== undefined
  ) {
    return "#00000000";
  }
  return getInitialWindowBackgroundColor(shouldUseDarkColors, persistedTheme);
}

function readPrefersReducedTransparency(): boolean {
  try {
    return Electron.nativeTheme?.prefersReducedTransparency === true;
  } catch {
    return false;
  }
}

function syncWindowAppearance(
  window: Electron.BrowserWindow,
  hasTitleBarOverlay: boolean,
  shouldUseDarkColors: boolean,
  platform: NodeJS.Platform,
  persistedTheme?: string | null,
  vibrancyOptions?: WindowVibrancyOptions,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (window.isDestroyed()) {
      return;
    }

    window.setBackgroundColor(
      resolveWindowBackgroundColor(shouldUseDarkColors, persistedTheme, vibrancyOptions),
    );
    const isFocused = typeof window.isFocused === "function" ? window.isFocused() : true;
    const { titleBarOverlay } = getWindowTitleBarOptions(shouldUseDarkColors, platform, isFocused);
    if (hasTitleBarOverlay && typeof titleBarOverlay === "object") {
      window.setTitleBarOverlay(titleBarOverlay);
    }
    if (platform === "darwin" && typeof window.setVibrancy === "function") {
      try {
        window.setVibrancy(vibrancyOptions?.vibrancy ?? null);
      } catch {}
    } else if (platform === "win32" && typeof window.setBackgroundMaterial === "function") {
      try {
        window.setBackgroundMaterial(vibrancyOptions?.backgroundMaterial ?? "none");
      } catch {}
    }
  });
}

type RevealSubscription = (listener: () => void) => void;

function bindFirstRevealTrigger(
  subscribers: readonly RevealSubscription[],
  reveal: () => void,
): void {
  let revealed = false;
  const fire = () => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  for (const subscribe of subscribers) {
    subscribe(fire);
  }
}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopState = yield* DesktopState.DesktopState;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const previewManager = yield* PreviewManager.PreviewManager;
  const previewPasskeys = yield* PreviewPasskeys.PreviewPasskeys;
  const primaryPaste = yield* DesktopPrimaryPaste.DesktopPrimaryPaste;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronApp = yield* ElectronApp.ElectronApp;
  const rendererHistory = yield* DesktopRendererHistory.DesktopRendererHistory;
  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
  const backendReadyRef = yield* Ref.make(false);
  let backendHasStarted = false;
  let mainClosedDuringStartup = false;
  let activeThemePreference: string | null = null;
  const splashWindowRef = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());

  const readPersistedTheme = Effect.gen(function* () {
    if (Option.isNone(fileSystem)) return activeThemePreference;
    const raw = yield* fileSystem.value
      .readFileString(environment.serverSettingsPath)
      .pipe(Effect.option);
    if (Option.isNone(raw)) return activeThemePreference;
    const parsed = decodePersistedThemeSettings(raw.value);
    if (Option.isSome(parsed) && parsed.value.defaultTheme !== undefined) {
      activeThemePreference = parsed.value.defaultTheme;
    }
    return activeThemePreference;
  });

  const readGlassOpacity = clientSettings.get.pipe(
    Effect.map(
      Option.match({
        onNone: () => DEFAULT_CLIENT_SETTINGS.glassOpacity,
        onSome: (settings) => settings.glassOpacity,
      }),
    ),
    Effect.orElseSucceed(() => DEFAULT_CLIENT_SETTINGS.glassOpacity),
  );
  const context = yield* Effect.context<DesktopWindowRuntimeServices>();
  const runFork = Effect.runForkWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const mainWindowMutex = yield* Semaphore.make(1);
  const pendingMainReveals = new WeakMap<Electron.BrowserWindow, Effect.Effect<void>>();
  const revealMain = Effect.fn("desktop.window.revealMain")((window: Electron.BrowserWindow) =>
    Effect.suspend(() => pendingMainReveals.get(window) ?? electronWindow.reveal(window)),
  );
  let flushMainWindowBounds: Effect.Effect<void> = Effect.void;
  let remoteRequestHeaderOwner: Electron.BrowserWindow | null = null;
  const scopedFibers = yield* makeScopedFiberTracker<DesktopWindowRuntimeServices>();
  const trackFork = scopedFibers.track;
  yield* Effect.addFinalizer(() => scopedFibers.interruptAll);

  const dismissConnectingSplash = Effect.gen(function* () {
    const splash = yield* Ref.getAndSet(splashWindowRef, Option.none());
    if (Option.isNone(splash) || splash.value.isDestroyed()) {
      return;
    }
    const target = splash.value;
    // Linux lacks Electron window.setOpacity(); perform a bounded in-DOM content fade
    // (the main window's In-Window Boot Curtain owns the visual handoff) and always close.
    if (environment.platform === "linux") {
      if (
        target.webContents === undefined ||
        target.webContents.isDestroyed() ||
        typeof target.webContents.executeJavaScript !== "function"
      ) {
        target.close();
        return;
      }
      trackFork(
        Effect.tryPromise({
          try: () => target.webContents.executeJavaScript(LINUX_SPLASH_DISMISS_CONTENT_SCRIPT),
          catch: () => false,
        }).pipe(
          Effect.timeoutOption(LINUX_SPLASH_DISMISS_TIMEOUT_MS),
          Effect.flatMap((result) =>
            Option.isSome(result) && result.value === true
              ? Effect.sleep(LINUX_SPLASH_CONTENT_FADE_MS)
              : Effect.void,
          ),
          Effect.ignore,
          Effect.ensuring(
            Effect.sync(() => {
              if (!target.isDestroyed()) {
                target.close();
              }
            }),
          ),
        ),
      );
      return;
    }
    trackFork(
      Effect.forEach(
        SPLASH_FADE_OPACITIES,
        (opacity) =>
          Effect.sleep(SPLASH_FADE_STEP_MS).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (!target.isDestroyed()) {
                  target.setOpacity(opacity);
                }
              }),
            ),
          ),
        { discard: true },
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (!target.isDestroyed()) {
              target.close();
            }
          }),
        ),
      ),
    );
  });

  // Electron's first-window fallback can select the unregistered connecting splash; exclude it so main creation retries.
  const withoutSplash = (window: Option.Option<Electron.BrowserWindow>) =>
    Ref.get(splashWindowRef).pipe(
      Effect.map((splash) =>
        Option.isSome(splash) && Option.isSome(window) && window.value === splash.value
          ? Option.none<Electron.BrowserWindow>()
          : window,
      ),
    );

  const currentMainWindow = electronWindow.currentMainOrFirst.pipe(Effect.flatMap(withoutSplash));

  const zoomWindow = Effect.fn("desktop.window.zoomWindow")(function* (
    window: Electron.BrowserWindow,
    direction: MainWindowZoomDirection,
  ) {
    const webContents = window.webContents;
    webContents.setZoomLevel(
      direction === "reset" ? 0 : webContents.getZoomLevel() + (direction === "in" ? 0.5 : -0.5),
    );
    if (environment.platform === "darwin") syncMacosWindowButtons(window);
    if (!window.isDestroyed() && !webContents.isDestroyed()) {
      webContents.send(WINDOW_ZOOM_STATE_CHANNEL, buildDesktopWindowZoomState(window));
    }
    // App zoom propagates to guests; restore each preview's own zoom.
    yield* previewManager.reapplyZoom();
  });

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (): Effect.fn.Return<
    Option.Option<Electron.BrowserWindow>,
    DesktopWindowError
  > {
    if (yield* Ref.get(desktopState.quitting)) return Option.none();
    yield* previewManager.getBrowserSession();
    const applicationUrl = getDesktopUrl(environment.isDevelopment);
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths, environment.platform);
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const persistedTheme = yield* readPersistedTheme;
    const glassOpacity = yield* readGlassOpacity;
    const vibrancyOptions = resolveWindowVibrancyOptions({
      platform: environment.platform,
      glassOpacity,
      prefersReducedTransparency: readPrefersReducedTransparency(),
    });
    const persistedSettings = yield* desktopSettings.get;
    const persistedBounds = persistedSettings.mainWindowBounds;
    const displayBoundsResult = yield* Effect.sync(() => {
      try {
        return {
          _tag: "Success" as const,
          bounds: Electron.screen.getAllDisplays().map((display) => display.bounds),
        };
      } catch (cause) {
        return { _tag: "Failure" as const, cause };
      }
    });
    const displayBounds =
      displayBoundsResult._tag === "Success"
        ? displayBoundsResult.bounds
        : yield* logWindowWarning("failed to read connected displays; using defaults", {
            cause: displayBoundsResult.cause,
          }).pipe(Effect.as<readonly Electron.Rectangle[]>([]));
    const initialBounds = resolveInitialMainWindowBounds(persistedBounds, displayBounds);
    const restoredPersistedBounds = persistedBounds !== null && initialBounds === persistedBounds;
    if (persistedBounds !== null && initialBounds === DesktopAppSettings.DEFAULT_MAIN_WINDOW_SIZE) {
      yield* logWindowWarning("saved main window bounds could not be restored; using defaults");
    }
    if (yield* Ref.get(desktopState.quitting)) return Option.none();
    const titleBarOptions = getWindowTitleBarOptions(shouldUseDarkColors, environment.platform);
    const window = yield* electronWindow.create({
      ...initialBounds,
      minWidth: DesktopAppSettings.MIN_MAIN_WINDOW_SIZE.width,
      minHeight: DesktopAppSettings.MIN_MAIN_WINDOW_SIZE.height,
      show: false,
      autoHideMenuBar: true,
      ...(environment.platform === "darwin" ? { disableAutoHideCursor: true } : {}),
      backgroundColor: resolveWindowBackgroundColor(
        shouldUseDarkColors,
        persistedTheme,
        vibrancyOptions,
      ),
      ...vibrancyOptions,
      ...iconOption,
      title: environment.displayName,
      ...titleBarOptions,
      webPreferences: {
        preload: environment.preloadPath,
        // Hidden-renderer throttling stalls first paint; re-enable it after the first reveal.
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        // Guest fullscreen propagates to the embedder; both must opt out to keep it inside the webview.
        // The app's own fullscreen elements reach OS fullscreen through syncHtmlFullscreen.
        disableHtmlFullscreenWindowResize: true,
      },
    });
    if (
      environment.platform === "linux" &&
      (!(
        typeof titleBarOptions.titleBarOverlay === "object" ||
        titleBarOptions.titleBarOverlay === true
      ) ||
        typeof window.setTitleBarOverlay !== "function")
    ) {
      recordLinuxWindowNativeWco(window, false);
    }
    if (yield* Ref.get(desktopState.quitting)) {
      yield* electronWindow.destroyAll;
      return Option.none();
    }

    pendingMainReveals.set(window, Effect.void);
    yield* rendererHistory.register(window.webContents, { surface: "main" });
    if (environment.platform === "darwin") {
      window.setAutoHideCursor(false);
    }
    let boundsPersistFiber: Fiber.Fiber<void, never> | undefined;
    let pendingBoundsPersistFiber: Fiber.Fiber<void, never> | undefined;
    let boundsPersistenceEnabled = persistedBounds === null || restoredPersistedBounds;
    let lastPersistableState: {
      readonly bounds: DesktopAppSettings.DesktopWindowBounds;
      readonly isMaximized: boolean;
    } | null = null;
    const readPersistableState = () => {
      if (window.isDestroyed()) {
        return null;
      }
      // Minimized windows report stale state on some platforms (macOS: not maximized, the
      // pre-move normal frame; Windows: -32000), so they keep the state seen before minimizing.
      if (window.isMinimized()) {
        return lastPersistableState;
      }
      const isMaximized = window.isMaximized();
      const bounds =
        window.isFullScreen() || isMaximized
          ? normalBoundsOnWindowDisplay(
              window.getNormalBounds(),
              window.getBounds(),
              readDisplayBoundsOrEmpty(),
            )
          : window.getBounds();
      const persistableBounds = DesktopAppSettings.normalizeMainWindowBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
      lastPersistableState =
        persistableBounds === null ? null : { bounds: persistableBounds, isMaximized };
      return lastPersistableState;
    };
    const fallbackWindowBounds = boundsPersistenceEnabled
      ? null
      : (readPersistableState()?.bounds ?? null);
    const fallbackWindowMaximized = persistedSettings.mainWindowMaximized;
    const persistCurrentBounds = (): Fiber.Fiber<void, never> | undefined => {
      if (!boundsPersistenceEnabled) {
        return pendingBoundsPersistFiber;
      }
      const state = readPersistableState();
      if (state === null) {
        return pendingBoundsPersistFiber;
      }
      pendingBoundsPersistFiber = runFork(
        desktopSettings.setMainWindowBounds(state.bounds, state.isMaximized).pipe(
          Effect.asVoid,
          Effect.catch((error) =>
            logWindowWarning("failed to persist main window bounds", {
              message: error.message,
            }),
          ),
        ),
      );
      return pendingBoundsPersistFiber;
    };
    const scheduleBoundsPersist = () => {
      const state = readPersistableState();
      if (
        !boundsPersistenceEnabled &&
        (state === null ||
          (fallbackWindowBounds !== null &&
            windowBoundsEqual(state.bounds, fallbackWindowBounds) &&
            state.isMaximized === fallbackWindowMaximized))
      ) {
        return;
      }
      boundsPersistenceEnabled = true;
      if (boundsPersistFiber !== undefined) {
        const fiber = boundsPersistFiber;
        boundsPersistFiber = undefined;
        runFork(Fiber.interrupt(fiber));
      }
      boundsPersistFiber = runFork(
        Effect.sleep(MAIN_WINDOW_BOUNDS_PERSIST_DEBOUNCE_MS).pipe(
          Effect.andThen(
            Effect.sync(() => {
              boundsPersistFiber = undefined;
              void persistCurrentBounds();
            }),
          ),
        ),
      );
    };
    const clearBoundsPersist = () => {
      if (boundsPersistFiber === undefined) {
        return;
      }
      const fiber = boundsPersistFiber;
      boundsPersistFiber = undefined;
      runFork(Fiber.interrupt(fiber));
    };
    const flushBoundsPersist = Effect.sync(() => {
      clearBoundsPersist();
      return persistCurrentBounds();
    }).pipe(
      Effect.flatMap((fiber) =>
        fiber === undefined ? Effect.void : Fiber.join(fiber).pipe(Effect.asVoid),
      ),
    );
    flushMainWindowBounds = flushBoundsPersist;

    yield* previewManager.setMainWindow(window);
    if (yield* Ref.get(desktopState.quitting)) {
      yield* electronWindow.destroyAll;
      return Option.none();
    }
    window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
      if (
        typeof params.partition !== "string" ||
        !previewManager.isBrowserPartition(params.partition)
      ) {
        event.preventDefault();
        return;
      }
      // The guest always runs the app's own preload, whatever the element asked for.
      webPreferences.preload = environment.previewPickPreloadPath;
      webPreferences.sandbox = true;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.disableHtmlFullscreenWindowResize = true;
      if (previewPasskeys.bridgeEnabled) {
        webPreferences.additionalArguments = [
          ...(webPreferences.additionalArguments ?? []),
          PASSKEY_BRIDGE_ARGUMENT,
        ];
      }
      if (!primaryPaste.enabled) {
        webPreferences.additionalArguments = [
          ...(webPreferences.additionalArguments ?? []),
          PRIMARY_PASTE_DISABLED_ARGUMENT,
        ];
      }
    });

    const contextMenuContents = new WeakSet<Electron.WebContents>();
    const installContextMenu = (
      ownerWindow: Electron.BrowserWindow,
      contents: Electron.WebContents,
      isBrowserContents = false,
    ): void => {
      if (contextMenuContents.has(contents)) return;
      contextMenuContents.add(contents);
      contents.on("context-menu", (event, params) => {
        event.preventDefault();
        if (contents.isDestroyed() || ownerWindow.isDestroyed()) return;
        // Right-clicking a guest may leave native editing roles targeting the host renderer.
        contents.focus();

        const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

        if (isBrowserContents) {
          menuTemplate.push(
            {
              label: m(msg("Reload")),
              click: () => {
                if (!contents.isDestroyed()) contents.reload();
              },
            },
            { type: "separator" },
          );
        }

        if (params.misspelledWord) {
          for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
            menuTemplate.push({
              label: suggestion,
              click: () => {
                if (!contents.isDestroyed()) contents.replaceMisspelling(suggestion);
              },
            });
          }
          if (params.dictionarySuggestions.length === 0) {
            menuTemplate.push({ label: m(msg("No suggestions")), enabled: false });
          }
          menuTemplate.push({ type: "separator" });
        }

        if (Option.isSome(ElectronShell.parseSafeExternalUrl(params.linkURL))) {
          menuTemplate.push(
            {
              label: m(msg("Copy Link")),
              click: () => {
                void runPromise(electronShell.copyText(params.linkURL));
              },
            },
            { type: "separator" },
          );
        }

        const mailtoAddress = parseMailtoAddress(params.linkURL);
        if (Option.isSome(mailtoAddress)) {
          menuTemplate.push(
            {
              label: m(msg("Copy Email Address")),
              click: () => {
                void runPromise(electronShell.copyText(mailtoAddress.value));
              },
            },
            { type: "separator" },
          );
        }

        if (params.mediaType === "image") {
          menuTemplate.push({
            label: m(msg("Copy Image")),
            click: () => {
              void runPromise(
                Effect.tryPromise({
                  try: () => copyContextMenuImage(contents, params),
                  catch: (cause) => new ContextMenuImageCopyError({ cause }),
                }).pipe(Effect.catch(() => logWindowWarning("failed to copy context-menu image"))),
              );
            },
          });
          menuTemplate.push({ type: "separator" });
        }

        menuTemplate.push(
          {
            role: "cut",
            label: m(msg("Cut", { $context: "Edit menu item" })),
            enabled: params.editFlags.canCut,
          },
          {
            role: "copy",
            label: m(msg("Copy", { $context: "Edit menu item" })),
            enabled: params.editFlags.canCopy,
          },
          {
            role: "paste",
            label: m(msg("Paste", { $context: "Edit menu item" })),
            enabled: params.editFlags.canPaste,
          },
          {
            role: "selectAll",
            label: m(msg("Select All", { $context: "Edit menu item" })),
            enabled: params.editFlags.canSelectAll,
          },
        );

        void runPromise(
          electronMenu.popupTemplate({
            window: ownerWindow,
            template: menuTemplate,
            ...(params.frame ? { frame: params.frame } : {}),
          }),
        );
      });
      contents.on("did-create-window", (popup) => {
        installContextMenu(popup, popup.webContents, isBrowserContents);
      });
    };
    installContextMenu(window, window.webContents);
    window.webContents.on("did-attach-webview", (_event, contents) => {
      installContextMenu(window, contents, true);
      void runPromise(previewManager.prepareWebview(contents));
    });

    // Popups from every frame in this window arrive here without a caller, so only web links
    // pass. The app opens editors and other applications over IPC.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (Option.isSome(ElectronShell.parseWebExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });
    // Chromium asks this before handing a navigation to an OS protocol handler, and grants it
    // when nothing answers. External links are opened through ElectronShell only.
    window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission !== "openExternal"),
    );
    window.webContents.on("will-navigate", (event, url) => {
      if (
        isSameOriginRendererNavigation({
          applicationUrl,
          navigationUrl: url,
        })
      ) {
        return;
      }

      event.preventDefault();
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
    });

    const quitShortcutHandler = makeQuitShortcutHandler({
      platform: environment.platform,
      getMode: () =>
        runPromise(
          Effect.map(
            clientSettings.get,
            Option.match({
              onNone: () => DEFAULT_CLIENT_SETTINGS.confirmQuit,
              onSome: (settings) => settings.confirmQuit,
            }),
          ),
        ),
      notify: (hint) => {
        if (!window.isDestroyed()) {
          window.webContents.send(QUIT_SHORTCUT_CHANNEL, hint);
        }
      },
      // Hold focus until shortcut release so remaining repeats cannot reach the next app.
      concealWindow: () => concealPendingQuitWindow(window, environment.platform),
      quit: () => {
        if (
          environment.platform === "linux" &&
          !window.isDestroyed() &&
          !window.webContents.isDestroyed()
        ) {
          window.webContents.send(QUIT_SHORTCUT_CHANNEL, { state: "committing" });
          trackFork(
            Effect.sleep(LINUX_EXIT_CURTAIN_MS).pipe(
              Effect.andThen(electronApp.quit),
              Effect.ignoreCause,
            ),
          );
          return;
        }
        void runPromise(electronApp.quit);
      },
    });
    window.webContents.on("before-input-event", (event, input) => {
      quitShortcutHandler(event, input);
      if (window.isDestroyed()) return;
      // Cmd/Ctrl+W reaches the renderer; DevTools uses the native menu shortcut.
      window.webContents.setIgnoreMenuShortcuts(
        (environment.platform === "darwin" ? input.meta : input.control) &&
          !input.alt &&
          !input.shift &&
          input.key.toLowerCase() === "w",
      );
      // A held Cmd/Ctrl+W closes one tab or terminal, not each one behind it.
      if (input.type !== "keyDown" || !input.isAutoRepeat) return;
      const modifier = environment.platform === "darwin" ? input.meta : input.control;
      if (modifier && !input.alt && !input.shift && input.key.toLowerCase() === "w") {
        event.preventDefault();
      }
    });
    window.webContents.on("input-event", (_event, input) => {
      if (window.isDestroyed()) return;
      if (input.type === "gestureScrollBegin") {
        window.webContents.send(TRACKPAD_SCROLL_BEGIN_CHANNEL);
      } else if (input.type === "gestureScrollEnd") {
        window.webContents.send(TRACKPAD_SCROLL_END_CHANNEL);
      }
    });
    // Ctrl+wheel bypasses menus; guest contents emit their own zoom-changed event.
    window.webContents.on("zoom-changed", (_event, direction) => {
      if (window.isDestroyed()) return;
      runFork(zoomWindow(window, direction));
    });

    // The renderer titles the window after the open thread; only a blank title
    // falls back to the app name.
    window.on("page-title-updated", (event, title) => {
      if (title.trim() !== "") return;
      event.preventDefault();
      window.setTitle(environment.displayName);
    });
    const handleWindowFocusChange = (focused: boolean) => {
      syncWindowFocusState(window, focused);
      if (environment.platform === "darwin" || window.isDestroyed()) return;
      runFork(
        electronTheme.shouldUseDarkColors.pipe(
          Effect.tap((dark) =>
            Effect.sync(() => {
              if (window.isDestroyed()) return;
              const { titleBarOverlay } = getWindowTitleBarOptions(
                dark,
                environment.platform,
                focused,
              );
              if (
                typeof titleBarOverlay === "object" &&
                typeof window.setTitleBarOverlay === "function"
              ) {
                try {
                  window.setTitleBarOverlay(titleBarOverlay);
                } catch {
                  if (
                    environment.platform === "linux" &&
                    resolveLinuxWindowNativeWco(window) !== false
                  ) {
                    recordLinuxWindowNativeWco(window, false);
                    emitLinuxWindowState();
                  }
                }
              }
            }),
          ),
        ),
      );
    };
    const emitLinuxWindowState = () => {
      if (
        environment.platform !== "linux" ||
        window.isDestroyed() ||
        window.webContents.isDestroyed()
      ) {
        return;
      }
      window.webContents.send(LINUX_WINDOW_STATE_CHANNEL, buildLinuxWindowState(window));
    };
    const handleMaximizeChange = () => {
      scheduleBoundsPersist();
      emitLinuxWindowState();
    };
    let lastKnownScaleFactor = buildDesktopWindowZoomState(window).deviceScaleFactor ?? 1;
    const emitWindowZoomStateIfScaleChanged = () => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      const state = buildDesktopWindowZoomState(window);
      const nextScale = state.deviceScaleFactor ?? 1;
      if (Math.abs(nextScale - lastKnownScaleFactor) < 0.001) return;
      lastKnownScaleFactor = nextScale;
      window.webContents.send(WINDOW_ZOOM_STATE_CHANNEL, state);
    };
    const handleMove = () => {
      scheduleBoundsPersist();
      emitWindowZoomStateIfScaleChanged();
    };
    window.on("focus", () => handleWindowFocusChange(true));
    window.on("blur", () => handleWindowFocusChange(false));
    window.on("resize", scheduleBoundsPersist);
    window.on("move", handleMove);
    window.on("maximize", handleMaximizeChange);
    window.on("unmaximize", handleMaximizeChange);
    window.on("close", () => {
      runFork(flushBoundsPersist);
    });

    if (environment.platform === "linux") {
      window.on("enter-full-screen", () => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, true);
        }
        emitLinuxWindowState();
      });
      window.on("leave-full-screen", () => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, false);
        }
        emitLinuxWindowState();
      });
    }

    if (environment.platform !== "darwin") {
      // Forward hardware mouse back/forward app commands to the renderer's single history navigation owner.
      window.on("app-command", (_event, command) => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        if (command === "browser-backward") {
          window.webContents.send(MENU_ACTION_CHANNEL, "history.app-command:back");
        } else if (command === "browser-forward") {
          window.webContents.send(MENU_ACTION_CHANNEL, "history.app-command:forward");
        }
      });
    }

    if (environment.platform === "darwin") {
      // Mouse drivers can deliver Back/Forward as macOS swipe gestures instead of buttons.
      window.on("swipe", (_event, direction) => {
        const history = window.webContents.navigationHistory;
        if (direction === "left" && history.canGoBack()) history.goBack();
        else if (direction === "right" && history.canGoForward()) history.goForward();
      });
      window.on("enter-full-screen", () => {
        window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, true);
      });
      window.on("leave-full-screen", () => {
        syncMacosWindowButtons(window);
        window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, false);
      });
    }

    let developmentLoadRetryIndex = 0;
    let developmentLoadRetryFiber: Fiber.Fiber<void, never> | undefined;
    let rendererRecoveryTimestamps: number[] = [];
    const clearDevelopmentLoadRetry = () => {
      if (developmentLoadRetryFiber === undefined) {
        return;
      }
      const retryFiber = developmentLoadRetryFiber;
      developmentLoadRetryFiber = undefined;
      runFork(Fiber.interrupt(retryFiber));
    };
    const loadApplication = () => {
      if (window.isDestroyed()) {
        return;
      }
      void window.loadURL(applicationUrl).catch(() => undefined);
    };
    const scheduleDevelopmentLoadRetry = () => {
      if (developmentLoadRetryFiber !== undefined || window.isDestroyed()) {
        return undefined;
      }

      const retryIndex = Math.min(
        developmentLoadRetryIndex,
        DEVELOPMENT_LOAD_RETRY_DELAYS_MS.length - 1,
      );
      const retryInMs = DEVELOPMENT_LOAD_RETRY_DELAYS_MS[retryIndex] ?? 2_000;
      developmentLoadRetryIndex += 1;
      developmentLoadRetryFiber = runFork(
        Effect.sleep(retryInMs).pipe(
          Effect.andThen(
            Effect.sync(() => {
              developmentLoadRetryFiber = undefined;
              if (!window.isDestroyed()) {
                loadApplication();
              }
            }),
          ),
        ),
      );
      return retryInMs;
    };

    window.webContents.on("did-finish-load", () => {
      if (
        environment.isDevelopment &&
        !isSameOriginRendererNavigation({
          applicationUrl,
          navigationUrl: window.webContents.getURL(),
        })
      ) {
        return;
      }
      clearDevelopmentLoadRetry();
      developmentLoadRetryIndex = 0;
      if (environment.platform === "darwin") syncMacosWindowButtons(window);
      if (typeof window.webContents.insertCSS === "function") {
        void window.webContents.insertCSS(DESKTOP_INACTIVE_WINDOW_CSS).catch(() => undefined);
      }
      syncWindowFocusState(
        window,
        typeof window.isFocused === "function" ? window.isFocused() : true,
      );
      emitLinuxWindowState();
      if (environment.platform === "linux") {
        if (typeof window.webContents.executeJavaScript === "function") {
          trackFork(
            Effect.tryPromise({
              try: () => window.webContents.executeJavaScript(LINUX_NATIVE_WCO_PROBE_SCRIPT),
              catch: () => undefined,
            }).pipe(
              Effect.tap((detected) =>
                Effect.sync(() => {
                  if (typeof detected !== "boolean") return;
                  if (resolveLinuxWindowNativeWco(window) === detected) return;
                  recordLinuxWindowNativeWco(window, detected);
                  emitLinuxWindowState();
                }),
              ),
              Effect.ignore,
            ),
          );
        }
        trackFork(
          electronTheme.linuxPortalAppearance.pipe(
            Effect.tap((appearance) =>
              Effect.sync(() => {
                if (
                  appearance !== null &&
                  !window.isDestroyed() &&
                  !window.webContents.isDestroyed()
                ) {
                  window.webContents.send(LINUX_PORTAL_APPEARANCE_CHANNEL, appearance);
                }
              }),
            ),
            Effect.asVoid,
          ),
        );
      }
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        const retryInMs =
          environment.isDevelopment &&
          isRetryableDevelopmentRendererLoadFailure({
            applicationUrl,
            errorCode,
            isMainFrame,
            validatedUrl: validatedURL,
          })
            ? scheduleDevelopmentLoadRetry()
            : undefined;
        void runPromise(
          logWindowWarning("main window failed to load", {
            errorCode,
            errorDescription,
            url: validatedURL,
            ...(retryInMs === undefined ? {} : { retryInMs }),
          }),
        );
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      const recoverable =
        details.reason === "crashed" ||
        details.reason === "oom" ||
        details.reason === "killed" ||
        details.reason === "abnormal-exit";

      runFork(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          rendererRecoveryTimestamps = rendererRecoveryTimestamps.filter(
            (timestamp) => now - timestamp < RENDERER_RECOVERY_WINDOW_MS,
          );
          const shouldRecover = recoverable && !window.isDestroyed();
          // Past the budget, wait for the oldest attempt to leave the window instead of
          // giving up, so a crash loop backs off but never leaves the window blank.
          const oldestAttempt =
            rendererRecoveryTimestamps.length >= RENDERER_RECOVERY_MAX_ATTEMPTS
              ? rendererRecoveryTimestamps[
                  rendererRecoveryTimestamps.length - RENDERER_RECOVERY_MAX_ATTEMPTS
                ]
              : undefined;
          const reloadInMs =
            oldestAttempt === undefined
              ? RENDERER_RECOVERY_RELOAD_DELAY_MS
              : Math.max(
                  RENDERER_RECOVERY_RELOAD_DELAY_MS,
                  oldestAttempt + RENDERER_RECOVERY_WINDOW_MS - now,
                );
          yield* logWindowWarning("main window render process gone", {
            reason: details.reason,
            exitCode: details.exitCode,
            recovering: shouldRecover,
            ...(shouldRecover ? { reloadInMs } : {}),
          });
          if (!shouldRecover) {
            return;
          }
          rendererRecoveryTimestamps.push(now + reloadInMs);
          yield* Effect.sleep(reloadInMs);
          if (!window.isDestroyed()) {
            loadApplication();
          }
        }),
      );
    });

    const revealSubscribers: RevealSubscription[] = [(fire) => window.once("ready-to-show", fire)];
    if (environment.platform === "linux") {
      revealSubscribers.push((fire) => window.webContents.once("did-finish-load", fire));
    }
    let rendererReady = false;
    let firstRevealComplete = false;
    const revealWhenReady = Effect.gen(function* () {
      if (
        !rendererReady ||
        firstRevealComplete ||
        window.isDestroyed() ||
        (yield* Ref.get(desktopState.quitting))
      )
        return;
      firstRevealComplete = true;
      pendingMainReveals.delete(window);
      window.webContents.setBackgroundThrottling(true);
      if (persistedSettings.mainWindowMaximized) window.maximize();
      yield* electronWindow.reveal(window);
      yield* dismissConnectingSplash;
    });
    pendingMainReveals.set(window, revealWhenReady);
    bindFirstRevealTrigger(revealSubscribers, () => {
      rendererReady = true;
      void runPromise(revealWhenReady);
    });

    // Desktop IPC only answers the main window, so register it before its renderer can call in.
    yield* electronWindow.setMain(window);
    remoteRequestHeaderOwner = window;
    const detachRemoteRequestHeaders = installMainWindowRemoteRequestHeaderPolicy(
      window.webContents.session,
      {
        desktopOrigin: getDesktopOrigin(environment.isDevelopment),
        mainWebContentsId: window.webContents.id,
        clerkFrontendApiHostname: DesktopClerk.desktopClerkFrontendApiHostname,
        devServerOrigin: Option.getOrUndefined(
          Option.map(environment.devServerUrl, (url) => url.origin),
        ),
        isDevelopment: environment.isDevelopment,
      },
    );
    loadApplication();
    if (environment.isDevelopment) {
      window.webContents.openDevTools({ mode: "detach" });
    }

    window.on("closed", () => {
      if (!backendHasStarted) mainClosedDuringStartup = true;
      clearDevelopmentLoadRetry();
      clearBoundsPersist();
      if (remoteRequestHeaderOwner === window) {
        remoteRequestHeaderOwner = null;
        detachRemoteRequestHeaders();
      }
      void runPromise(electronWindow.clearMain(Option.some(window)));
    });

    return Option.some(window);
  });

  const createMain = Effect.gen(function* () {
    const window = yield* createWindow();
    if (Option.isSome(window)) {
      mainClosedDuringStartup = false;
      yield* logWindowInfo("main window created");
    }
    return window;
  }).pipe(Effect.withSpan("desktop.window.createMain"));

  const ensureMain = Effect.gen(function* () {
    if (yield* Ref.get(desktopState.quitting)) return Option.none<Electron.BrowserWindow>();
    const existingWindow = yield* electronWindow.main;
    if (Option.isSome(existingWindow)) {
      return existingWindow;
    }
    return yield* createMain;
  }).pipe(mainWindowMutex.withPermits(1), Effect.withSpan("desktop.window.ensureMain"));

  const requireWindow = (window: Option.Option<Electron.BrowserWindow>) =>
    Option.match(window, {
      onNone: () => Effect.interrupt,
      onSome: Effect.succeed,
    });

  const revealOrCreateMain = Effect.gen(function* () {
    const window = yield* ensureMain.pipe(Effect.flatMap(requireWindow));
    yield* revealMain(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.revealOrCreateMain"));

  const waitingForBackend = Effect.gen(function* () {
    if (yield* Ref.get(backendReadyRef)) return false;
    return (yield* desktopSettings.get).localEnvironmentEnabled;
  });

  const createMainIfBackendReady = Effect.gen(function* () {
    if (yield* Ref.get(desktopState.quitting)) return;
    if (yield* waitingForBackend) return;
    yield* ensureMain;
  }).pipe(Effect.withSpan("desktop.window.createMainIfBackendReady"));

  const showConnectingSplash = Effect.gen(function* () {
    if (yield* Ref.get(desktopState.quitting)) return;
    const existingSplash = yield* Ref.get(splashWindowRef);
    if (Option.isSome(existingSplash)) return;
    const existingWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(existingWindow)) return;

    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const persistedTheme = yield* readPersistedTheme;
    if (yield* Ref.get(desktopState.quitting)) return;
    const splash = yield* electronWindow.create({
      width: 360,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      roundedCorners: true,
      hasShadow: true,
      center: true,
      show: false,
      skipTaskbar: false,
      backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors, persistedTheme),
      title: environment.displayName,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (yield* Ref.get(desktopState.quitting)) {
      yield* electronWindow.destroyAll;
      return;
    }
    yield* rendererHistory.register(splash.webContents, { surface: "splash" });
    yield* Ref.set(splashWindowRef, Option.some(splash));
    let renderedUrl: string | undefined;
    const progressFiber = runFork(
      Effect.gen(function* () {
        if (splash.isDestroyed() || (yield* Ref.get(desktopState.quitting))) return;
        const progress = yield* Ref.get(desktopState.databaseMigrationProgress);
        const url = buildConnectingSplashDataUrl(shouldUseDarkColors, persistedTheme, progress);
        if (url === renderedUrl) return;
        const loaded = yield* Effect.promise(() =>
          splash.loadURL(url).then(
            () => true,
            () => false,
          ),
        );
        if (loaded) renderedUrl = url;
      }).pipe(Effect.repeat(Schedule.spaced("1 second"))),
    );
    splash.once("closed", () => {
      runFork(
        Fiber.interrupt(progressFiber).pipe(
          Effect.andThen(Ref.set(splashWindowRef, Option.none())),
        ),
      );
    });
    splash.once("ready-to-show", () => {
      if (!splash.isDestroyed()) {
        splash.show();
      }
    });
    yield* logWindowInfo("connecting splash shown");
  }).pipe(
    Effect.catch((error) =>
      logWindowWarning("failed to show connecting splash", { message: error.message }),
    ),
    Effect.withSpan("desktop.window.showConnectingSplash"),
  );

  const dispatchRendererEvent = Effect.fn("desktop.window.dispatchRendererEvent")(function* (
    channel: string,
    payload: unknown,
    { reveal = true }: { readonly reveal?: boolean } = {},
  ) {
    if (yield* Ref.get(desktopState.quitting)) return;
    // Only the main renderer loads the app preload that listens on these channels.
    const existingWindow = yield* electronWindow.main;
    if (Option.isNone(existingWindow) && (!reveal || (yield* waitingForBackend))) return;
    const window = Option.isSome(existingWindow) ? existingWindow : yield* ensureMain;
    if (Option.isNone(window) || window.value.isDestroyed()) return;
    const targetWindow = window.value;
    const send = Effect.sync(() => {
      if (!targetWindow.isDestroyed()) targetWindow.webContents.send(channel, payload);
    });
    // Send before best-effort reveal; another process may refuse to yield foreground focus.
    const dispatch = reveal
      ? send.pipe(Effect.andThen(revealMain(targetWindow).pipe(Effect.ignoreCause)))
      : send;
    if (targetWindow.webContents.isLoadingMainFrame()) {
      targetWindow.webContents.once("did-finish-load", () => void runPromise(dispatch));
      return;
    }
    yield* dispatch;
  });

  return DesktopWindow.of({
    createMain: createMain.pipe(Effect.flatMap(requireWindow)),
    ensureMain: ensureMain.pipe(Effect.flatMap(requireWindow)),
    revealOrCreateMain,
    prepareCaptureReveal: Effect.gen(function* () {
      const existingWindow = yield* currentMainWindow;
      if (Option.isSome(existingWindow) && !pendingMainReveals.has(existingWindow.value)) {
        yield* electronWindow.prepareReveal(existingWindow.value);
      }
    }),
    activate: Effect.gen(function* () {
      if (yield* Ref.get(desktopState.quitting)) return;
      const existingWindow = yield* currentMainWindow;
      if (Option.isSome(existingWindow)) {
        yield* revealMain(existingWindow.value);
        return;
      }
      if (mainClosedDuringStartup) {
        yield* ensureMain;
        return;
      }
      const backendReady = yield* Ref.get(backendReadyRef);
      if (!backendReady) {
        const splash = yield* Ref.get(splashWindowRef);
        if (Option.isSome(splash)) {
          yield* electronWindow.reveal(splash.value);
          return;
        }
      }
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.activate")),
    createMainIfBackendReady,
    showConnectingSplash,
    handleBackendReady: Effect.fn("desktop.window.handleBackendReady")(function* (httpBaseUrl) {
      backendHasStarted = true;
      yield* Ref.set(backendReadyRef, true);
      yield* logWindowInfo("backend ready", { source: "http", url: httpBaseUrl.href });
      if (!mainClosedDuringStartup) yield* createMainIfBackendReady;
    }),
    handleBackendNotReady: Ref.set(backendReadyRef, false).pipe(
      Effect.withSpan("desktop.window.handleBackendNotReady"),
    ),
    flushMainWindowBounds: Effect.suspend(() => flushMainWindowBounds).pipe(
      Effect.withSpan("desktop.window.flushMainWindowBounds"),
    ),
    dispatchMenuAction: Effect.fn("desktop.window.dispatchMenuAction")(function* (action, options) {
      yield* Effect.annotateCurrentSpan({ action });
      yield* dispatchRendererEvent(MENU_ACTION_CHANNEL, action, options);
    }),
    dispatchSnapShotEvent: Effect.fn("desktop.window.dispatchSnapShotEvent")(function* (event) {
      yield* Effect.annotateCurrentSpan({
        event: event.type,
        captureId: "id" in event ? (event.id ?? null) : null,
      });
      yield* dispatchRendererEvent(SNAP_SHOT_EVENT_CHANNEL, event, {
        reveal: event.type === "started",
      });
    }),
    zoomMain: Effect.fn("desktop.window.zoomMain")(function* (direction) {
      yield* Effect.annotateCurrentSpan({ direction });
      const window = yield* electronWindow.main;
      if (Option.isNone(window) || window.value.isDestroyed()) {
        return;
      }
      yield* zoomWindow(window.value, direction);
    }),
    runMainContentsCommand: Effect.fn("desktop.window.runMainContentsCommand")(function* (command) {
      yield* Effect.annotateCurrentSpan({ command });
      // A focused OAuth popup must not receive the app's Reload command.
      const window = yield* electronWindow.main;
      if (Option.isNone(window) || window.value.isDestroyed()) return;
      const webContents = window.value.webContents;
      if (command === "reload") webContents.reload();
      else if (command === "forceReload") webContents.reloadIgnoringCache();
      else webContents.toggleDevTools();
    }),
    syncAppearance: Effect.gen(function* () {
      const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
      const persistedTheme = yield* readPersistedTheme;
      const glassOpacity = yield* readGlassOpacity;
      const vibrancyOptions = resolveWindowVibrancyOptions({
        platform: environment.platform,
        glassOpacity,
        prefersReducedTransparency: readPrefersReducedTransparency(),
      });
      yield* electronWindow.syncAllAppearance((window, { titleBarOverlay }) =>
        syncWindowAppearance(
          window,
          titleBarOverlay,
          shouldUseDarkColors,
          environment.platform,
          persistedTheme,
          vibrancyOptions,
        ),
      );
    }).pipe(Effect.withSpan("desktop.window.syncAppearance")),
  });
});

export const layer = Layer.effect(DesktopWindow, make);

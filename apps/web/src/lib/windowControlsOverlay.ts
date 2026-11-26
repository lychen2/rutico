import type { LinuxWindowState } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { isElectron } from "~/env";

import { isMacPlatform, isWindowsPlatform } from "./utils";

const WCO_CLASS_NAME = "wco";
const ELECTRON_CLASS_NAME = "electron";
const ELECTRON_WINDOWS_CLASS_NAME = "electron-windows";
const ELECTRON_LINUX_CLASS_NAME = "electron-linux";
// macOS has no overlay API; traffic lights stay inside this topbar at every zoom level.
const MACOS_TITLEBAR_HEIGHT = 52;
// Matches DesktopWindow.ts TITLEBAR_HEIGHT for Linux native titleBarOverlay.
const LINUX_TITLEBAR_OVERLAY_HEIGHT = 40;
const LINUX_CSD_OVERRIDE_STORAGE_KEY = "t3code:linux-csd-override";

function isLinuxPlatform(platform: string): boolean {
  if (/^linux/i.test(platform)) return true;
  if (typeof window !== "undefined") {
    return window.desktopBridge?.getClientPlatform?.() === "linux";
  }
  return false;
}

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

function getWindowControlsOverlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
}

/** Height of the native caption strip drawn over the page, or 0 when the window has none. */
export function windowControlsOverlayHeight(): number {
  const overlay = getWindowControlsOverlay();
  return overlay?.visible ? overlay.getTitlebarAreaRect().height : 0;
}

export function onWindowControlsOverlayGeometryChange(listener: () => void): () => void {
  const overlay = getWindowControlsOverlay();
  if (!overlay) {
    return () => {};
  }

  overlay.addEventListener("geometrychange", listener);
  return () => {
    overlay.removeEventListener("geometrychange", listener);
  };
}

export function syncDocumentWindowControlsOverlayClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const overlay = getWindowControlsOverlay();
  const update = () => {
    document.documentElement.classList.toggle(WCO_CLASS_NAME, overlay !== null && overlay.visible);
  };

  update();
  return onWindowControlsOverlayGeometryChange(update);
}

function subscribeTitlebarArea(listener: () => void): () => void {
  const overlay = getWindowControlsOverlay();
  overlay?.addEventListener("geometrychange", listener);
  return () => overlay?.removeEventListener("geometrychange", listener);
}

function getNativeTitlebarHeight(): number {
  if (isElectron && isMacPlatform(navigator.platform)) return MACOS_TITLEBAR_HEIGHT;
  const overlay = getWindowControlsOverlay();
  return overlay?.visible ? overlay.getTitlebarAreaRect().bottom : 0;
}

export function useNativeTitlebarHeight(): number {
  return useSyncExternalStore(subscribeTitlebarArea, getNativeTitlebarHeight, () => 0);
}

function getElectronPlatformClassNames(
  platform: string,
):
  | readonly [typeof ELECTRON_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_WINDOWS_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_LINUX_CLASS_NAME] {
  if (isWindowsPlatform(platform)) {
    return [ELECTRON_CLASS_NAME, ELECTRON_WINDOWS_CLASS_NAME];
  }
  if (isLinuxPlatform(platform)) {
    return [ELECTRON_CLASS_NAME, ELECTRON_LINUX_CLASS_NAME];
  }
  return [ELECTRON_CLASS_NAME];
}

let cachedLinuxWindowState: LinuxWindowState | null = null;
const linuxWindowStateListeners = new Set<() => void>();
let stopLinuxWindowStateBridge: (() => void) | null = null;
let stopLinuxWindowWcoListener: (() => void) | null = null;
let documentLinuxWindowSyncActive = false;

function applyLinuxWindowStateAttributes(root: HTMLElement, state: LinuxWindowState | null): void {
  if (state === null) {
    delete root.dataset.windowMaximized;
    delete root.dataset.windowFullscreen;
    delete root.dataset.linuxDesktop;
    delete root.dataset.linuxTilingWm;
    delete root.dataset.linuxHasNativeWco;
    root.style.removeProperty("--linux-overlay-height");
    return;
  }
  const overlay = getWindowControlsOverlay();
  const hasDomWco = overlay !== null && overlay.visible;
  const hasNativeWco = hasDomWco || state.hasNativeWco === true;
  const overlayHeight =
    typeof state.overlayHeight === "number" &&
    Number.isFinite(state.overlayHeight) &&
    state.overlayHeight > 0
      ? state.overlayHeight
      : LINUX_TITLEBAR_OVERLAY_HEIGHT;
  root.dataset.windowMaximized = state.maximized ? "true" : "false";
  root.dataset.windowFullscreen = state.fullscreen ? "true" : "false";
  if (state.linuxDesktop) {
    root.dataset.linuxDesktop = state.linuxDesktop;
  } else {
    delete root.dataset.linuxDesktop;
  }
  root.dataset.linuxTilingWm = state.isTilingWm === true ? "true" : "false";
  root.dataset.linuxHasNativeWco = hasNativeWco ? "true" : "false";
  root.style.setProperty("--linux-overlay-height", `${overlayHeight}px`);
}

function readInitialLinuxWindowState(): LinuxWindowState | null {
  if (typeof window === "undefined") return null;
  const read = window.desktopBridge?.getLinuxWindowState;
  if (typeof read !== "function") return null;
  try {
    return read();
  } catch {
    return null;
  }
}

function notifyLinuxWindowState(next: LinuxWindowState | null): void {
  cachedLinuxWindowState = next;
  if (typeof document !== "undefined") {
    applyLinuxWindowStateAttributes(document.documentElement, next);
  }
  for (const listener of linuxWindowStateListeners) {
    listener();
  }
}

function syncDocumentLinuxWindowState(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }
  documentLinuxWindowSyncActive = true;
  const bridge = window.desktopBridge;
  notifyLinuxWindowState(readInitialLinuxWindowState());
  const unsubscribe =
    typeof bridge?.onLinuxWindowStateChange === "function"
      ? bridge.onLinuxWindowStateChange((state) => {
          notifyLinuxWindowState(state);
        })
      : undefined;
  const unsubscribeWco = onWindowControlsOverlayGeometryChange(() => {
    notifyLinuxWindowState(cachedLinuxWindowState);
  });
  return () => {
    documentLinuxWindowSyncActive = false;
    unsubscribe?.();
    unsubscribeWco();
    applyLinuxWindowStateAttributes(document.documentElement, null);
    cachedLinuxWindowState = null;
  };
}

function subscribeLinuxWindowState(listener: () => void): () => void {
  linuxWindowStateListeners.add(listener);
  if (linuxWindowStateListeners.size === 1 && typeof window !== "undefined") {
    if (cachedLinuxWindowState === null) {
      cachedLinuxWindowState = readInitialLinuxWindowState();
    }
    const bridge = window.desktopBridge;
    if (typeof bridge?.onLinuxWindowStateChange === "function") {
      stopLinuxWindowStateBridge = bridge.onLinuxWindowStateChange((state) => {
        notifyLinuxWindowState(state);
      });
    }
    stopLinuxWindowWcoListener = onWindowControlsOverlayGeometryChange(() => {
      notifyLinuxWindowState(cachedLinuxWindowState);
    });
  }
  return () => {
    linuxWindowStateListeners.delete(listener);
    if (linuxWindowStateListeners.size === 0) {
      stopLinuxWindowStateBridge?.();
      stopLinuxWindowStateBridge = null;
      stopLinuxWindowWcoListener?.();
      stopLinuxWindowWcoListener = null;
      if (!documentLinuxWindowSyncActive) {
        cachedLinuxWindowState = null;
      }
    }
  };
}

function getLinuxWindowStateSnapshot(): LinuxWindowState | null {
  return cachedLinuxWindowState;
}

export function useLinuxWindowState(): LinuxWindowState | null {
  return useSyncExternalStore(subscribeLinuxWindowState, getLinuxWindowStateSnapshot, () => null);
}

/**
 * Guard against double window buttons: never render custom DOM window controls
 * when native Electron `titleBarOverlay` / DOM WindowControlsOverlay is active.
 */
export function shouldShowFallbackLinuxWindowControls(
  state: LinuxWindowState | null,
  hasDomWco: boolean,
  override?: "force" | "hide" | null,
): boolean {
  if (state === null || hasDomWco || state.fullscreen) return false;
  if (state.hasNativeWco === true) return false;
  if (override === "hide") return false;
  if (override === "force") return true;
  return state.isTilingWm !== true;
}

export function readLinuxCsdOverride(): "force" | "hide" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LINUX_CSD_OVERRIDE_STORAGE_KEY);
    return raw === "force" || raw === "hide" ? raw : null;
  } catch {
    return null;
  }
}

export function hasVisibleWindowControlsOverlay(): boolean {
  const overlay = getWindowControlsOverlay();
  return overlay !== null && overlay.visible;
}

export function syncDocumentElectronPlatformClasses(platform: string): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const classNames = getElectronPlatformClassNames(platform);
  document.documentElement.classList.add(...classNames);
  const stopLinuxState = isLinuxPlatform(platform) ? syncDocumentLinuxWindowState() : undefined;
  return () => {
    stopLinuxState?.();
    document.documentElement.classList.remove(...classNames);
  };
}

/**
 * Flags fractional device pixel ratios (common on Linux 1.25x / 1.5x / 1.75x HiDPI displays)
 * on `documentElement` so CSS can apply fractional-DPR optical stroke & hairline refinements.
 */
export function syncDocumentFractionalDprClass(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  const root = document.documentElement;
  const update = () => {
    const dpr = window.devicePixelRatio || 1;
    const fractional = Math.abs(dpr - Math.round(dpr)) > 0.01;
    if (fractional) {
      root.dataset.fractionalDpr = "true";
    } else {
      delete root.dataset.fractionalDpr;
    }
  };
  update();
  window.addEventListener("resize", update, { passive: true });
  return () => {
    window.removeEventListener("resize", update);
    delete root.dataset.fractionalDpr;
  };
}

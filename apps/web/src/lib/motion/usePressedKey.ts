import { useSyncExternalStore } from "react";

import { isMacPlatform } from "~/lib/utils";

const KEY_ALIASES: Record<string, string> = {
  ctrl: "control",
  control: "control",
  "⌃": "control",
  shift: "shift",
  "⇧": "shift",
  alt: "alt",
  opt: "alt",
  option: "alt",
  "⌥": "alt",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  super: "meta",
  win: "meta",
  "⌘": "meta",
  enter: "enter",
  return: "enter",
  "↵": "enter",
  "⏎": "enter",
  esc: "escape",
  escape: "escape",
  arrowup: "arrowup",
  up: "arrowup",
  "↑": "arrowup",
  arrowdown: "arrowdown",
  down: "arrowdown",
  "↓": "arrowdown",
  arrowleft: "arrowleft",
  left: "arrowleft",
  "←": "arrowleft",
  arrowright: "arrowright",
  right: "arrowright",
  "→": "arrowright",
  backspace: "backspace",
  "⌫": "backspace",
  tab: "tab",
  "⇥": "tab",
  space: "space",
  " ": "space",
};

const KNOWN_KEYCAP_LABELS = new Set(Object.keys(KEY_ALIASES));

function detectMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return isMacPlatform(navigator.platform);
}

/** Normalize key names and keycap glyphs (e.g. "Ctrl", "Mod", "↑", "Esc") to canonical keys. */
export function normalizePressedKey(
  rawKey: string,
  options?: { readonly isMac?: boolean },
): string {
  const trimmed = rawKey === " " ? " " : rawKey.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "mod") {
    return (options?.isMac ?? detectMacPlatform()) ? "meta" : "control";
  }
  return KEY_ALIASES[lower] ?? lower;
}

/** Infer a reactive physical key only for unambiguous single-key labels such as Ctrl or Esc. */
export function inferReactiveKeyFromLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const lower = label.trim().toLowerCase();
  if (!lower || !KNOWN_KEYCAP_LABELS.has(lower)) return undefined;
  return lower;
}

export interface PressedKeyEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface PressedKeyStore {
  subscribe(key: string, listener: () => void): () => void;
  isPressed(key: string): boolean;
  getSubscriberCount(): number;
}

/** Create a per-key subscriber store backed by one shared keydown/keyup/blur listener. */
export function createPressedKeyStore(
  target: PressedKeyEventTarget | null = typeof window !== "undefined" ? window : null,
  options?: { readonly isMac?: boolean },
): PressedKeyStore {
  const pressedKeys = new Set<string>();
  const listenersByKey = new Map<string, Set<() => void>>();
  let totalSubscribers = 0;
  let attached = false;

  const notifyKey = (normalized: string) => {
    const listeners = listenersByKey.get(normalized);
    if (!listeners) return;
    for (const listener of listeners) listener();
  };

  const handleKeyDown: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (typeof keyboardEvent.key !== "string") return;
    const normalized = normalizePressedKey(keyboardEvent.key, options);
    if (!normalized || pressedKeys.has(normalized)) return;
    pressedKeys.add(normalized);
    notifyKey(normalized);
  };

  const handleKeyUp: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (typeof keyboardEvent.key !== "string") return;
    const normalized = normalizePressedKey(keyboardEvent.key, options);
    if (!normalized || !pressedKeys.has(normalized)) return;
    pressedKeys.delete(normalized);
    notifyKey(normalized);
  };

  const releaseAll: EventListener = () => {
    if (pressedKeys.size === 0) return;
    const released = Array.from(pressedKeys);
    pressedKeys.clear();
    for (const key of released) notifyKey(key);
  };

  const attach = () => {
    if (attached || !target) return;
    attached = true;
    target.addEventListener("keydown", handleKeyDown);
    target.addEventListener("keyup", handleKeyUp);
    target.addEventListener("blur", releaseAll);
  };

  const detach = () => {
    if (!attached || !target) return;
    attached = false;
    target.removeEventListener("keydown", handleKeyDown);
    target.removeEventListener("keyup", handleKeyUp);
    target.removeEventListener("blur", releaseAll);
    pressedKeys.clear();
  };

  return {
    subscribe(key: string, listener: () => void) {
      const normalized = normalizePressedKey(key, options);
      if (!normalized) return () => {};
      let bucket = listenersByKey.get(normalized);
      if (!bucket) {
        bucket = new Set();
        listenersByKey.set(normalized, bucket);
      }
      bucket.add(listener);
      totalSubscribers += 1;
      attach();
      return () => {
        const current = listenersByKey.get(normalized);
        if (!current?.delete(listener)) return;
        totalSubscribers -= 1;
        if (current.size === 0) listenersByKey.delete(normalized);
        if (totalSubscribers === 0) detach();
      };
    },
    isPressed(key: string) {
      const normalized = normalizePressedKey(key, options);
      return normalized ? pressedKeys.has(normalized) : false;
    },
    getSubscriberCount() {
      return totalSubscribers;
    },
  };
}

let sharedStore: PressedKeyStore | null = null;

function getSharedPressedKeyStore(): PressedKeyStore {
  if (!sharedStore) sharedStore = createPressedKeyStore();
  return sharedStore;
}

const NOOP_SUBSCRIBE = () => () => {};
const ALWAYS_FALSE = () => false;

/** Subscribe to whether a single physical key is currently held down. */
export function usePressedKey(key: string | undefined): boolean {
  const normalized = key ? normalizePressedKey(key) : "";
  const store = getSharedPressedKeyStore();
  return useSyncExternalStore(
    normalized ? (onStoreChange) => store.subscribe(normalized, onStoreChange) : NOOP_SUBSCRIBE,
    normalized ? () => store.isPressed(normalized) : ALWAYS_FALSE,
    ALWAYS_FALSE,
  );
}

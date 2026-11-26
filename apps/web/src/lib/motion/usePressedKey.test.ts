import { describe, expect, it, vi } from "vite-plus/test";

import {
  createPressedKeyStore,
  inferReactiveKeyFromLabel,
  normalizePressedKey,
  type PressedKeyEventTarget,
} from "./usePressedKey";

function createFakeEventTarget() {
  const map = new Map<string, Set<EventListener>>();
  const target: PressedKeyEventTarget = {
    addEventListener(type, listener) {
      let set = map.get(type);
      if (!set) {
        set = new Set();
        map.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type, listener) {
      map.get(type)?.delete(listener);
    },
  };
  return {
    target,
    dispatch(type: string, event: Partial<KeyboardEvent> = {}) {
      for (const listener of map.get(type) ?? []) {
        listener(event as Event);
      }
    },
    listenerCount(type: string) {
      return map.get(type)?.size ?? 0;
    },
  };
}

describe("usePressedKey", () => {
  it("normalizes Linux-first modifiers, arrows, enter, escape, and OS-adaptive Mod", () => {
    expect(normalizePressedKey("Ctrl")).toBe("control");
    expect(normalizePressedKey("Shift")).toBe("shift");
    expect(normalizePressedKey("Alt")).toBe("alt");
    expect(normalizePressedKey("↑")).toBe("arrowup");
    expect(normalizePressedKey("↓")).toBe("arrowdown");
    expect(normalizePressedKey("↵")).toBe("enter");
    expect(normalizePressedKey("Esc")).toBe("escape");
    expect(normalizePressedKey("Mod", { isMac: false })).toBe("control");
    expect(normalizePressedKey("Mod", { isMac: true })).toBe("meta");
  });

  it("infers unambiguous single-key keycap labels and ignores compound shortcuts", () => {
    expect(inferReactiveKeyFromLabel("Ctrl")).toBe("ctrl");
    expect(inferReactiveKeyFromLabel("Esc")).toBe("esc");
    expect(inferReactiveKeyFromLabel("↑")).toBe("↑");
    expect(inferReactiveKeyFromLabel("Ctrl+K")).toBeUndefined();
    expect(inferReactiveKeyFromLabel("K")).toBeUndefined();
  });

  it("notifies only listeners for the pressed key, releases on blur, and detaches when idle", () => {
    const fake = createFakeEventTarget();
    const store = createPressedKeyStore(fake.target, { isMac: false });
    const onCtrl = vi.fn();
    const onEsc = vi.fn();

    const unsubCtrl = store.subscribe("Ctrl", onCtrl);
    const unsubEsc = store.subscribe("Esc", onEsc);
    expect(store.getSubscriberCount()).toBe(2);
    expect(fake.listenerCount("keydown")).toBe(1);

    fake.dispatch("keydown", { key: "Control" });
    expect(store.isPressed("Ctrl")).toBe(true);
    expect(store.isPressed("Mod")).toBe(true);
    expect(store.isPressed("Esc")).toBe(false);
    expect(onCtrl).toHaveBeenCalledTimes(1);
    expect(onEsc).toHaveBeenCalledTimes(0);

    // Repeat keydown does not spam listeners.
    fake.dispatch("keydown", { key: "Control" });
    expect(onCtrl).toHaveBeenCalledTimes(1);

    // Blur releases all held keys cleanly.
    fake.dispatch("blur");
    expect(store.isPressed("Ctrl")).toBe(false);
    expect(onCtrl).toHaveBeenCalledTimes(2);
    expect(onEsc).toHaveBeenCalledTimes(0);

    unsubCtrl();
    unsubEsc();
    expect(store.getSubscriberCount()).toBe(0);
    expect(fake.listenerCount("keydown")).toBe(0);
    expect(fake.listenerCount("keyup")).toBe(0);
    expect(fake.listenerCount("blur")).toBe(0);
  });
});

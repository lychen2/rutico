import { describe, expect, it, vi } from "vite-plus/test";

import { DESKTOP_PASTE_AS_TEXT_EVENT, installDesktopPasteAsText } from "./desktopPasteAsText";

function createTestScope(): Disposable {
  return {
    [Symbol.dispose]() {
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    },
  };
}

describe("installDesktopPasteAsText", () => {
  it("dispatches paste-as-text and spawns caret pulse on menu action", () => {
    using _scope = createTestScope();
    let menuListener: ((action: string) => void) | undefined;
    const pasteAsText = vi.fn(async () => undefined);
    const input = document.createElement("textarea");
    input.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 240, height: 48 }) as DOMRect;
    document.body.append(input);
    input.focus();

    let dispatched = false;
    input.addEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, () => {
      dispatched = true;
    });

    const dispose = installDesktopPasteAsText(
      {
        onMenuAction: (listener) => {
          menuListener = listener;
          return () => undefined;
        },
        pasteAsText,
        getClientPlatform: () => "linux",
        getPrimaryPasteEnabled: () => true,
      },
      window,
    );

    try {
      menuListener?.("paste-as-text");
      expect(dispatched).toBe(true);
      expect(pasteAsText).toHaveBeenCalledOnce();
      const pulse = document.querySelector(".t3-paste-pulse");
      expect(pulse?.getAttribute("data-paste-kind")).toBe("paste-as-text");
    } finally {
      dispose?.();
    }
  });

  it("shows primary-selection pulse on Linux middle-click only when gtk-enable-primary-paste is enabled", () => {
    using _scope = createTestScope();
    const textarea = document.createElement("textarea");
    document.body.append(textarea);

    const disposeEnabled = installDesktopPasteAsText(
      {
        onMenuAction: () => () => undefined,
        pasteAsText: async () => undefined,
        getClientPlatform: () => "linux",
        getPrimaryPasteEnabled: () => true,
      },
      document,
    );

    try {
      textarea.dispatchEvent(
        new MouseEvent("mouseup", { button: 1, clientX: 120, clientY: 160, bubbles: true }),
      );
      expect(
        document.querySelector('.t3-paste-pulse[data-paste-kind="primary-selection"]'),
      ).not.toBeNull();
    } finally {
      disposeEnabled?.();
    }

    document.body.innerHTML = "";
    const disabledTextarea = document.createElement("textarea");
    document.body.append(disabledTextarea);

    const disposeDisabled = installDesktopPasteAsText(
      {
        onMenuAction: () => () => undefined,
        pasteAsText: async () => undefined,
        getClientPlatform: () => "linux",
        getPrimaryPasteEnabled: () => false,
      },
      document,
    );

    try {
      disabledTextarea.dispatchEvent(
        new MouseEvent("mouseup", { button: 1, clientX: 120, clientY: 160, bubbles: true }),
      );
      expect(
        document.querySelector('.t3-paste-pulse[data-paste-kind="primary-selection"]'),
      ).toBeNull();
    } finally {
      disposeDisabled?.();
    }
  });
});

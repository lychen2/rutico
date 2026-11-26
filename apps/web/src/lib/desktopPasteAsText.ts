import type { DesktopBridge } from "@t3tools/contracts";

export const DESKTOP_PASTE_AS_TEXT_EVENT = "t3:paste-as-text";

const PASTE_PULSE_DURATION_MS = 280;

function isEditablePasteTarget(node: EventTarget | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled;
  if (node instanceof HTMLInputElement) {
    return (
      !node.readOnly &&
      !node.disabled &&
      !["button", "checkbox", "radio", "submit", "reset", "file", "hidden", "range"].includes(
        node.type,
      )
    );
  }
  return node.closest('[contenteditable="true"], [role="textbox"]') !== null;
}

function resolvePastePulsePoint(
  element: Element | null,
  pointer?: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } | null {
  if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
    return pointer;
  }
  if (typeof window !== "undefined") {
    const selection = window.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (typeof range?.getBoundingClientRect === "function") {
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
    }
  }
  if (element instanceof HTMLElement && typeof element.getBoundingClientRect === "function") {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    }
  }
  return null;
}

function showPasteCaretPulse(
  element: Element | null,
  kind: "paste-as-text" | "primary-selection",
  pointer?: { readonly x: number; readonly y: number },
): void {
  if (typeof document === "undefined" || !document.body) return;
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  const point = resolvePastePulsePoint(element, pointer);
  if (!point) return;

  const pulse = document.createElement("span");
  pulse.className = "t3-paste-pulse";
  pulse.dataset.pasteKind = kind;
  pulse.setAttribute("aria-hidden", "true");
  pulse.style.left = `${point.x}px`;
  pulse.style.top = `${point.y}px`;
  document.body.append(pulse);
  window.setTimeout(() => {
    pulse.remove();
  }, PASTE_PULSE_DURATION_MS + 40);
}

/**
 * Arm composer paste handling before Electron delivers the native clipboard event. The event
 * bubbles from the focused element, so a composer can listen on its own form or on `target`.
 * On Linux, also provides subtle caret-area confirmation for Ctrl+Shift+V and middle-click
 * Primary Selection paste (respecting `gtk-enable-primary-paste`).
 */
export function installDesktopPasteAsText(
  bridge:
    | Pick<
        DesktopBridge,
        "onMenuAction" | "pasteAsText" | "getClientPlatform" | "getPrimaryPasteEnabled"
      >
    | undefined,
  target: EventTarget,
): (() => void) | undefined {
  if (!bridge) return undefined;
  const disposeMenuAction = bridge.onMenuAction((action) => {
    if (action !== "paste-as-text") return;
    const active = document.activeElement;
    (active ?? target).dispatchEvent(new Event(DESKTOP_PASTE_AS_TEXT_EVENT, { bubbles: true }));
    showPasteCaretPulse(active, "paste-as-text");
    void bridge.pasteAsText();
  });

  const isLinux =
    typeof bridge.getClientPlatform === "function" && bridge.getClientPlatform() === "linux";
  const primaryPasteAllowed =
    typeof bridge.getPrimaryPasteEnabled !== "function" ||
    bridge.getPrimaryPasteEnabled() !== false;

  if (!isLinux || !primaryPasteAllowed) {
    return disposeMenuAction;
  }

  const onMiddleClickUp = (event: Event) => {
    if (!(event instanceof MouseEvent) || event.button !== 1 || event.defaultPrevented) return;
    if (!isEditablePasteTarget(event.target)) return;
    showPasteCaretPulse(event.target, "primary-selection", {
      x: event.clientX,
      y: event.clientY,
    });
  };
  target.addEventListener("mouseup", onMiddleClickUp, true);

  return () => {
    disposeMenuAction();
    target.removeEventListener("mouseup", onMiddleClickUp, true);
  };
}

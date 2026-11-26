type VirtualKeyboard = EventTarget & {
  readonly boundingRect: Pick<DOMRectReadOnly, "height">;
  readonly overlaysContent: boolean;
};

type KeyboardWindow = Pick<Window, "innerHeight" | "visualViewport"> & {
  readonly navigator: Navigator & { readonly virtualKeyboard?: VirtualKeyboard };
};

const KEYBOARD_THRESHOLD = 150;

function viewportSnapshot(viewport: VisualViewport) {
  return {
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    scale: viewport.scale,
  };
}

export function createSoftwareKeyboardStore(win: KeyboardWindow | undefined, isDesktop: boolean) {
  const listeners = new Set<() => void>();
  let viewportOpen = false;
  let viewportInsetPx = 0;
  const viewport = isDesktop ? undefined : win?.visualViewport;
  const keyboard = isDesktop ? undefined : win?.navigator.virtualKeyboard;
  let previous = viewport ? viewportSnapshot(viewport) : undefined;

  // Single-path resolution (Astra P1-6): never sum VirtualKeyboard and visualViewport insets.
  // When VirtualKeyboard is in overlay mode or actively reports height, it is the sole source.
  const isNativeOverlayPath = () =>
    Boolean(keyboard && (keyboard.overlaysContent || keyboard.boundingRect.height > 0));

  const getInsetPx = (): number => {
    if (isDesktop || !win) return 0;
    if (isNativeOverlayPath()) {
      return Math.max(0, Math.round(keyboard!.boundingRect.height));
    }
    return viewportOpen ? viewportInsetPx : 0;
  };

  const getSnapshot = () => {
    if (isNativeOverlayPath()) {
      return keyboard!.boundingRect.height > 0;
    }
    return viewportOpen;
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const computeViewportInset = (current: ReturnType<typeof viewportSnapshot>) => {
    if (!win) return 0;
    return Math.max(0, Math.round(win.innerHeight - current.height * current.scale));
  };

  const onViewportResize = () => {
    if (!viewport || !win) return;
    const current = viewportSnapshot(viewport);
    // Adapted from Ionic's keyboard assist, MIT, Copyright (c) 2015-present Drifty Co.
    // https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/keyboard/keyboard.ts
    const scaledHeightDifference = previous
      ? (previous.height - current.height) * current.scale
      : 0;
    if (Math.abs(current.height - win.innerHeight / current.scale) <= 1) {
      viewportOpen = false;
      viewportInsetPx = 0;
    } else if (
      !viewportOpen &&
      previous?.width === current.width &&
      scaledHeightDifference > KEYBOARD_THRESHOLD
    ) {
      viewportOpen = true;
      viewportInsetPx = computeViewportInset(current);
    } else if (viewportOpen) {
      viewportInsetPx = computeViewportInset(current);
    }
    previous = current;
    notify();
  };

  const subscribe = (listener: () => void) => {
    if (isDesktop || !win) return () => {};
    if (listeners.size === 0) {
      if (viewport) {
        previous = viewportSnapshot(viewport);
        // A composer can mount after the keyboard has already opened.
        const initialDiff = win.innerHeight - previous.height * previous.scale;
        viewportOpen = initialDiff > KEYBOARD_THRESHOLD;
        viewportInsetPx = viewportOpen ? Math.max(0, Math.round(initialDiff)) : 0;
        viewport.addEventListener("resize", onViewportResize);
      }
      keyboard?.addEventListener("geometrychange", notify);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        viewport?.removeEventListener("resize", onViewportResize);
        keyboard?.removeEventListener("geometrychange", notify);
      }
    };
  };

  return { getSnapshot, getInsetPx, subscribe };
}

/**
 * Publishes the active software keyboard pixel inset to `--software-keyboard-inset` on
 * `documentElement` so bottom sheets and mobile dialogs avoid Android Gboard without double-lifting.
 */
export function syncDocumentSoftwareKeyboardInset(
  store: ReturnType<typeof createSoftwareKeyboardStore>,
  doc: Pick<Document, "documentElement"> | undefined = globalThis.document,
): () => void {
  if (!doc?.documentElement?.style) return () => {};
  const root = doc.documentElement;
  const apply = () => {
    const insetPx = store.getInsetPx();
    root.style.setProperty("--software-keyboard-inset", `${insetPx}px`);
    root.dataset.softwareKeyboardOpen = store.getSnapshot() ? "true" : "false";
  };
  const unsubscribe = store.subscribe(apply);
  apply();
  return () => {
    unsubscribe();
    root.style.setProperty("--software-keyboard-inset", "0px");
    delete root.dataset.softwareKeyboardOpen;
  };
}

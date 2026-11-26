import { useGT } from "gt-react";
import { useSyncExternalStore } from "react";

import { isMacPlatform } from "../lib/utils";

const HOLD_HINT_LINGER_MS = 1200;

type QuitHintMode = "hold" | "double-click";

interface QuitHintSnapshot {
  readonly mode: QuitHintMode | null;
  readonly holding: boolean;
  readonly generation: number;
}

const EMPTY_SNAPSHOT: QuitHintSnapshot = { mode: null, holding: false, generation: 0 };

let snapshot: QuitHintSnapshot = EMPTY_SNAPSHOT;
let pressedMode: QuitHintMode = "hold";
let hideTimer: number | undefined;
const listeners = new Set<() => void>();
let stopBridge: (() => void) | null = null;

function setSnapshot(next: QuitHintSnapshot) {
  if (
    next.mode === snapshot.mode &&
    next.holding === snapshot.holding &&
    next.generation === snapshot.generation
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribeQuitHint(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    stopBridge =
      window.desktopBridge?.onQuitShortcut((hint) => {
        window.clearTimeout(hideTimer);
        if (hint.state === "down") {
          pressedMode = hint.mode;
          setSnapshot({
            mode: hint.mode,
            holding: hint.mode === "hold",
            generation: snapshot.generation + 1,
          });
          return;
        }
        if (pressedMode === "double-click") {
          setSnapshot({ mode: null, holding: false, generation: snapshot.generation });
          return;
        }
        setSnapshot({ mode: "hold", holding: false, generation: snapshot.generation });
        hideTimer = window.setTimeout(() => {
          setSnapshot({ mode: null, holding: false, generation: snapshot.generation });
        }, HOLD_HINT_LINGER_MS);
      }) ?? null;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.clearTimeout(hideTimer);
    stopBridge?.();
    stopBridge = null;
    snapshot = EMPTY_SNAPSHOT;
  };
}

const readQuitHint = () => snapshot;

export function QuitHoldOverlay() {
  const { mode, holding, generation } = useSyncExternalStore(
    subscribeQuitHint,
    readQuitHint,
    readQuitHint,
  );
  const gt = useGT();

  if (!mode) return null;
  const shortcut = isMacPlatform(navigator.platform) ? "⌘Q" : "Ctrl+Q";
  const message =
    mode === "hold"
      ? gt("Hold {shortcut} or press twice to quit", { shortcut })
      : gt("Press {shortcut} again to quit", { shortcut });
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[22%] z-100 flex justify-center px-4"
    >
      <div className="t3-quit-hold-hud dialog-glass relative overflow-hidden rounded-2xl border px-6 py-3.5 text-center text-base font-semibold tracking-tight text-foreground sm:text-lg">
        <span>{message}</span>
        {mode === "hold" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-foreground/10"
          >
            <span
              key={generation}
              data-holding={holding ? "true" : "false"}
              className="t3-quit-hold-progress block h-full w-full origin-left bg-foreground/75"
            />
          </span>
        ) : null}
      </div>
    </div>
  );
}

import { useGT } from "gt-react";
import { useSyncExternalStore } from "react";

import { isMacPlatform } from "../lib/utils";

const HOLD_HINT_LINGER_MS = 1200;
const COMMITTING_FALLBACK_RESET_MS = 1500;
const RADIAL_RING_RADIUS = 15;
const RADIAL_RING_CIRCUMFERENCE = 2 * Math.PI * RADIAL_RING_RADIUS;

type QuitHintMode = "hold" | "double-click";

interface QuitHintSnapshot {
  readonly mode: QuitHintMode | null;
  readonly holding: boolean;
  readonly committing: boolean;
  readonly generation: number;
}

const EMPTY_SNAPSHOT: QuitHintSnapshot = {
  mode: null,
  holding: false,
  committing: false,
  generation: 0,
};

let snapshot: QuitHintSnapshot = EMPTY_SNAPSHOT;
let pressedMode: QuitHintMode = "hold";
let hideTimer: number | undefined;
const listeners = new Set<() => void>();
let stopBridge: (() => void) | null = null;

function setSnapshot(next: QuitHintSnapshot) {
  if (
    next.mode === snapshot.mode &&
    next.holding === snapshot.holding &&
    next.committing === snapshot.committing &&
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
        if (hint.state === "committing") {
          setSnapshot({
            mode: snapshot.mode ?? pressedMode,
            holding: false,
            committing: true,
            generation: snapshot.generation,
          });
          hideTimer = window.setTimeout(() => {
            setSnapshot(EMPTY_SNAPSHOT);
          }, COMMITTING_FALLBACK_RESET_MS);
          return;
        }
        if (hint.state === "down") {
          pressedMode = hint.mode;
          setSnapshot({
            mode: hint.mode,
            holding: hint.mode === "hold",
            committing: false,
            generation: snapshot.generation + 1,
          });
          return;
        }
        // Keep the Linux 90ms exit curtain steady through the trailing keyUp.
        if (snapshot.committing) return;
        if (pressedMode === "double-click") {
          setSnapshot({
            mode: null,
            holding: false,
            committing: false,
            generation: snapshot.generation,
          });
          return;
        }
        setSnapshot({
          mode: "hold",
          holding: false,
          committing: false,
          generation: snapshot.generation,
        });
        hideTimer = window.setTimeout(() => {
          setSnapshot({
            mode: null,
            holding: false,
            committing: false,
            generation: snapshot.generation,
          });
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
  const { mode, holding, committing, generation } = useSyncExternalStore(
    subscribeQuitHint,
    readQuitHint,
    readQuitHint,
  );
  const gt = useGT();

  if (!mode && !committing) return null;
  const shortcut = isMacPlatform(navigator.platform) ? "⌘Q" : "Ctrl+Q";
  const message =
    mode === "double-click"
      ? gt("Press {shortcut} again to quit", { shortcut })
      : gt("Hold {shortcut} or press twice to quit", { shortcut });

  return (
    <>
      {committing ? (
        <div
          aria-hidden="true"
          data-slot="linux-exit-curtain"
          className="t3-linux-exit-curtain pointer-events-none fixed inset-0 z-110"
        />
      ) : null}
      {mode ? (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-[22%] z-100 flex justify-center px-4"
        >
          <div
            data-slot="quit-hold-hud"
            data-mode={mode}
            data-holding={holding ? "true" : "false"}
            data-committing={committing ? "true" : "false"}
            className="t3-quit-hold-hud surface-optical-chrome relative flex items-center gap-3.5 overflow-hidden rounded-2xl border px-5 py-3 text-base font-semibold tracking-tight text-foreground sm:text-lg"
          >
            <span className="relative flex size-9 shrink-0 items-center justify-center">
              <svg aria-hidden="true" viewBox="0 0 36 36" className="size-9 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r={RADIAL_RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.16"
                  strokeWidth="2.5"
                />
                <circle
                  key={`${generation}-${mode}`}
                  cx="18"
                  cy="18"
                  r={RADIAL_RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={RADIAL_RING_CIRCUMFERENCE}
                  data-holding={holding ? "true" : "false"}
                  data-committing={committing ? "true" : "false"}
                  data-mode={mode}
                  className="t3-quit-radial-progress"
                />
              </svg>
              <svg
                aria-hidden="true"
                viewBox="32 20 76 86"
                className="pointer-events-none absolute size-3.5 text-foreground"
              >
                <path
                  d="M35 34C35 29.5817 38.5817 26 43 26H66.5C80.5833 26 90 34.4 90 46.5C90 57.6 82.05 65.4 69.8 66.8H51V54.2H65.2C71.7 54.2 75.6 51.3 75.6 46.5C75.6 41.7 71.7 38.8 65.2 38.8H50.2V94C50.2 98.4183 46.6183 102 42.2 102H40.5C37.4624 102 35 99.5376 35 96.5V34Z"
                  fill="currentColor"
                />
                <path
                  d="M56.5 70.5H72.2C74.9 70.5 77.4 71.9 78.8 74.2L94.4 99.2C95.3 100.6 94.1 102.4 92.5 102L84.8 99.8L79.6 102.5C78.4 103.1 76.9 102.6 76.2 101.5L56.5 70.5Z"
                  fill="currentColor"
                  fillOpacity="0.78"
                />
              </svg>
            </span>
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
      ) : null}
    </>
  );
}

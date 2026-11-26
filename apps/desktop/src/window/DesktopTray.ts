// @effect-diagnostics nodeBuiltinImport:off -- Pure PNG tray icon synthesis uses node:zlib deflateSync without external image dependencies.
import * as NodeZlib from "node:zlib";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { DesktopTrayAgentStatus, DesktopTrayState } from "@t3tools/contracts";
import * as Electron from "electron";
import { msg } from "gt-i18n";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { m } from "../i18n/messages.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

class DesktopTrayUnavailableError extends Schema.TaggedError<DesktopTrayUnavailableError>()(
  "DesktopTrayUnavailableError",
  {
    message: Schema.String,
  },
) {}

const TRAY_STATUSES: readonly DesktopTrayAgentStatus[] = [
  "idle",
  "running",
  "approval",
  "completed",
  "error",
];

const STATUS_ORB_COLORS: Readonly<
  Record<
    DesktopTrayAgentStatus,
    {
      readonly core: readonly [number, number, number];
      readonly rim: readonly [number, number, number];
    }
  >
> = {
  idle: { core: [128, 125, 146], rim: [192, 189, 212] },
  running: { core: [124, 92, 255], rim: [188, 170, 255] },
  approval: { core: [245, 158, 11], rim: [253, 224, 71] },
  completed: { core: [16, 185, 129], rim: [110, 231, 183] },
  error: { core: [239, 68, 68], rim: [252, 165, 165] },
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC32_TABLE[(c ^ bytes[i]!) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

function renderStatusOrbPng(status: DesktopTrayAgentStatus, size: number): Buffer {
  const { core, rim } = STATUS_ORB_COLORS[status];
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outerRadius = size * 0.42;
  const innerRadius = size * 0.28;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const offset = rowStart + 1 + x * 4;
      if (dist > outerRadius + 0.75) {
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
        raw[offset + 3] = 0;
        continue;
      }
      const alpha = Math.min(1, Math.max(0, outerRadius + 0.75 - dist));
      const highlight = Math.max(
        0,
        1 - Math.hypot(dx + outerRadius * 0.28, dy + outerRadius * 0.28) / (outerRadius * 0.95),
      );
      const inRim = dist > innerRadius;
      const mix = inRim ? 0.55 : highlight * 0.42;
      raw[offset] = Math.round(core[0] + (rim[0] - core[0]) * mix);
      raw[offset + 1] = Math.round(core[1] + (rim[1] - core[1]) * mix);
      raw[offset + 2] = Math.round(core[2] + (rim[2] - core[2]) * mix);
      raw[offset + 3] = Math.round(alpha * (inRim ? 235 : 255));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = NodeZlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildCachedStatusImages(): Record<DesktopTrayAgentStatus, Electron.NativeImage> {
  const cache = {} as Record<DesktopTrayAgentStatus, Electron.NativeImage>;
  for (const status of TRAY_STATUSES) {
    const img1x = renderStatusOrbPng(status, 22);
    const img2x = renderStatusOrbPng(status, 44);
    const nativeImg = Electron.nativeImage.createFromBuffer(img1x, {
      width: 22,
      height: 22,
      scaleFactor: 1,
    });
    if (typeof nativeImg.addRepresentation === "function") {
      nativeImg.addRepresentation({
        scaleFactor: 2,
        width: 22,
        height: 22,
        buffer: img2x,
      });
    }
    cache[status] = nativeImg;
  }
  return cache;
}

export interface DesktopTrayHandle {
  readonly setImage: (image: Electron.NativeImage) => void;
  readonly setToolTip: (toolTip: string) => void;
  readonly setContextMenu: (menu: Electron.Menu | null) => void;
  readonly isDestroyed: () => boolean;
  readonly destroy: () => void;
}

export interface DesktopTrayDependencies {
  readonly createTray: (image: Electron.NativeImage) => DesktopTrayHandle;
  readonly buildMenu: (template: Electron.MenuItemConstructorOptions[]) => Electron.Menu;
  readonly buildImages?: () => Record<DesktopTrayAgentStatus, Electron.NativeImage>;
}

const DEFAULT_TRAY_STATE: DesktopTrayState = {
  status: "idle",
  runningCount: 0,
  approvalCount: 0,
  unreadCount: 0,
  threads: [],
};

function trayStatusGlyph(status: DesktopTrayAgentStatus): string {
  switch (status) {
    case "approval":
      return "◆";
    case "error":
      return "!";
    case "running":
      return "●";
    case "completed":
      return "✓";
    case "idle":
      return "○";
  }
}

function formatTraySummary(displayName: string, state: DesktopTrayState): string {
  if (state.summary && state.summary.trim().length > 0) {
    return `${displayName}: ${state.summary.trim()}`;
  }
  const parts: string[] = [];
  if ((state.approvalCount ?? 0) > 0) {
    parts.push(`${state.approvalCount} awaiting approval`);
  }
  if ((state.runningCount ?? 0) > 0) {
    parts.push(`${state.runningCount} running`);
  }
  if ((state.unreadCount ?? 0) > 0) {
    parts.push(`${state.unreadCount} unread`);
  }
  if (parts.length > 0) {
    return `${displayName}: ${parts.join(", ")}`;
  }
  switch (state.status) {
    case "approval":
      return `${displayName}: Approval needed`;
    case "error":
      return `${displayName}: Needs attention`;
    case "running":
      return `${displayName}: Agent running`;
    case "completed":
      return `${displayName}: Completed`;
    case "idle":
      return `${displayName}: Idle`;
  }
}

function trayStateSignature(state: DesktopTrayState): string {
  const threads = (state.threads ?? [])
    .slice(0, 5)
    .map((item) => `${item.environmentId}:${item.threadId}:${item.status}:${item.title}`)
    .join("|");
  return `${state.status}|${state.runningCount ?? 0}|${state.approvalCount ?? 0}|${state.unreadCount ?? 0}|${state.summary ?? ""}|${threads}`;
}

function truncateLabel(value: string, maxLength = 44): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    readonly initialize: Effect.Effect<void>;
    readonly updateState: (state: DesktopTrayState) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopTray") {}

type DesktopTrayRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopWindow.DesktopWindow
  | ElectronApp.ElectronApp
  | ElectronWindow.ElectronWindow;

const { logInfo: logTrayInfo, logWarning: logTrayWarning } = makeComponentLogger("desktop-tray");

export const makeWith = Effect.fn("desktop.tray.make")(function* (deps: DesktopTrayDependencies) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const context = yield* Effect.context<DesktopTrayRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  let tray: DesktopTrayHandle | null = null;
  let cachedImages: Record<DesktopTrayAgentStatus, Electron.NativeImage> | null = null;
  let initialized = false;
  let lastStatus: DesktopTrayAgentStatus | null = null;
  let lastTooltip: string | null = null;
  let lastMenuSignature: string | null = null;
  let currentState: DesktopTrayState = DEFAULT_TRAY_STATE;

  const runTrayAction = <E>(effect: Effect.Effect<void, E, DesktopTrayRuntimeServices>) => {
    void runPromise(
      effect.pipe(Effect.catchCause((cause) => logTrayWarning("tray action failed", { cause }))),
    );
  };

  const toggleMainWindow = Effect.gen(function* () {
    const main = yield* electronWindow.main;
    if (
      Option.isSome(main) &&
      !main.value.isDestroyed() &&
      main.value.isVisible() &&
      main.value.isFocused()
    ) {
      main.value.hide();
      return;
    }
    yield* desktopWindow.activate;
  });

  const buildContextMenu = (state: DesktopTrayState): Electron.Menu => {
    const summaryLabel = formatTraySummary(environment.displayName, state);
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: summaryLabel, enabled: false },
      { type: "separator" },
      {
        label: m(msg("Show / Hide Window")),
        click: () => runTrayAction(toggleMainWindow),
      },
      {
        label: m(msg("New Thread")),
        click: () =>
          runTrayAction(desktopWindow.dispatchMenuAction("new-thread", { reveal: true })),
      },
      {
        label: m(msg("Command Palette")),
        click: () =>
          runTrayAction(desktopWindow.dispatchMenuAction("command-palette", { reveal: true })),
      },
    ];

    const threads = (state.threads ?? []).slice(0, 5);
    if (threads.length > 0) {
      template.push({ type: "separator" });
      for (const thread of threads) {
        const action = `open-thread:${encodeURIComponent(thread.environmentId)}:${encodeURIComponent(thread.threadId)}`;
        template.push({
          label: `${trayStatusGlyph(thread.status)} ${truncateLabel(thread.title || "Untitled thread")}`,
          click: () => runTrayAction(desktopWindow.dispatchMenuAction(action, { reveal: true })),
        });
      }
    }

    template.push(
      { type: "separator" },
      {
        label: m(msg("Settings...")),
        click: () =>
          runTrayAction(desktopWindow.dispatchMenuAction("open-settings", { reveal: true })),
      },
      {
        label: m(msg("Quit")),
        click: () => runTrayAction(electronApp.quit),
      },
    );

    return deps.buildMenu(template);
  };

  const applyStateToTray = (state: DesktopTrayState) => {
    currentState = state;
    if (!tray || tray.isDestroyed() || !cachedImages) return;

    if (lastStatus !== state.status) {
      tray.setImage(cachedImages[state.status]);
      lastStatus = state.status;
    }

    const tooltip = formatTraySummary(environment.displayName, state);
    if (lastTooltip !== tooltip) {
      tray.setToolTip(tooltip);
      lastTooltip = tooltip;
    }

    const signature = trayStateSignature(state);
    if (lastMenuSignature !== signature) {
      // Linux StatusNotifierItem relies solely on setContextMenu; never dual-bind a conflicting "click" handler.
      tray.setContextMenu(buildContextMenu(state));
      lastMenuSignature = signature;
    }
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (tray && !tray.isDestroyed()) {
        try {
          tray.destroy();
        } catch {}
      }
      tray = null;
      cachedImages = null;
      lastStatus = null;
      lastTooltip = null;
      lastMenuSignature = null;
    }),
  );

  const initialize = Effect.gen(function* () {
    if (initialized || environment.platform !== "linux") return;
    initialized = true;
    yield* Effect.try({
      try: () => {
        cachedImages = (deps.buildImages ?? buildCachedStatusImages)();
        tray = deps.createTray(cachedImages[currentState.status]);
        lastStatus = currentState.status;
        applyStateToTray(currentState);
      },
      catch: (error) =>
        new DesktopTrayUnavailableError({
          message: error instanceof Error ? error.message : String(error),
        }),
    }).pipe(
      Effect.andThen(logTrayInfo("Linux StatusNotifierItem tray initialized")),
      Effect.catchTags({
        DesktopTrayUnavailableError: (error) => {
          // Bare Sway/Niri/GNOME without an SNI host: gracefully stay a silent no-op.
          tray = null;
          cachedImages = null;
          return logTrayInfo("Linux system tray unavailable; continuing without tray", {
            message: error.message,
          });
        },
      }),
    );
  });

  const updateState = Effect.fn("desktop.tray.updateState")(function* (state: DesktopTrayState) {
    yield* Effect.sync(() => {
      applyStateToTray(state);
    });
  });

  return DesktopTray.of({
    initialize,
    updateState,
  });
});

/** @public */
export const make = makeWith({
  createTray: (image) => new Electron.Tray(image),
  buildMenu: (template) => Electron.Menu.buildFromTemplate(template),
});

export const layer = Layer.effect(DesktopTray, make);

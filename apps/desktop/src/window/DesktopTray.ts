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

import * as DesktopAssets from "../app/DesktopAssets.ts";
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

const STATUS_BADGE_COLORS: Readonly<
  Record<
    Exclude<DesktopTrayAgentStatus, "idle">,
    {
      readonly core: readonly [number, number, number];
      readonly highlight: readonly [number, number, number];
    }
  >
> = {
  running: { core: [139, 92, 246], highlight: [196, 181, 253] },
  approval: { core: [245, 158, 11], highlight: [253, 224, 71] },
  completed: { core: [16, 185, 129], highlight: [110, 231, 183] },
  error: { core: [239, 68, 68], highlight: [252, 165, 165] },
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

function encodeRgbaPng(rgba: Uint8Array, size: number): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    const srcStart = y * size * 4;
    raw.set(rgba.subarray(srcStart, srcStart + size * 4), rowStart + 1);
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

function roundedSquareSdf(
  x: number,
  y: number,
  cx: number,
  cy: number,
  half: number,
  corner: number,
): number {
  const qx = Math.abs(x - cx) - (half - corner);
  const qy = Math.abs(y - cy) - (half - corner);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner;
}

function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / lenSq)) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function renderFallbackMonogramRgba(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const pad = size * 0.04;
  const half = size / 2 - pad;
  const corner = half * 0.54;
  const stroke = Math.max(1.2, size * 0.09);

  // Normalized "R" glyph coordinates inside the squircle badge.
  const left = size * 0.34;
  const right = size * 0.61;
  const top = size * 0.25;
  const mid = size * 0.52;
  const bottom = size * 0.76;
  const bowlCx = size * 0.51;
  const bowlCy = (top + mid) / 2;
  const bowlR = (mid - top) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sdf = roundedSquareSdf(x, y, cx, cy, half, corner);
      const shapeAlpha = Math.min(1, Math.max(0, 0.5 - sdf));
      if (shapeAlpha <= 0) continue;

      const t = Math.min(1, Math.max(0, y / Math.max(1, size - 1)));
      let r = Math.round(92 + (40 - 92) * t);
      let g = Math.round(64 + (29 - 64) * t);
      let b = Math.round(148 + (62 - 148) * t);

      // Subtle inner sheen along the squircle edge so the badge stays legible on dark trays.
      if (sdf > -1.2) {
        const edge = Math.min(1, Math.max(0, 1 + sdf / 1.2));
        const sheen = edge * 0.24;
        r = Math.round(r + (232 - r) * sheen);
        g = Math.round(g + (222 - g) * sheen);
        b = Math.round(b + (252 - b) * sheen);
      }

      const stemDist = segmentDistance(x, y, left, top, left, bottom);
      const topBarDist = segmentDistance(x, y, left, top, bowlCx, top);
      const midBarDist = segmentDistance(x, y, left, mid, bowlCx, mid);
      const legDist = segmentDistance(x, y, bowlCx - size * 0.02, mid, right + size * 0.05, bottom);
      const bowlDist =
        x >= bowlCx
          ? Math.abs(Math.hypot(x - bowlCx, y - bowlCy) - bowlR)
          : Math.min(Math.hypot(x - bowlCx, y - top), Math.hypot(x - bowlCx, y - mid));
      const glyphDist =
        Math.min(stemDist, topBarDist, midBarDist, legDist, bowlDist) - stroke * 0.5;
      const glyphAlpha = Math.min(1, Math.max(0, 0.5 - glyphDist));

      if (glyphAlpha > 0) {
        r = Math.round(r + (248 - r) * glyphAlpha);
        g = Math.round(g + (244 - g) * glyphAlpha);
        b = Math.round(b + (255 - b) * glyphAlpha);
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(shapeAlpha * 255);
    }
  }
  return rgba;
}

function applySquircleMask(source: Uint8Array, size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const pad = size * 0.04;
  const half = size / 2 - pad;
  const corner = half * 0.54;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sdf = roundedSquareSdf(x, y, cx, cy, half, corner);
      const shapeAlpha = Math.min(1, Math.max(0, 0.5 - sdf));
      if (shapeAlpha <= 0) continue;

      const idx = (y * size + x) * 4;
      const srcAlpha = (source[idx + 3] ?? 0) / 255;
      const outAlpha = shapeAlpha * srcAlpha;
      if (outAlpha <= 0) continue;

      let r = source[idx] ?? 0;
      let g = source[idx + 1] ?? 0;
      let b = source[idx + 2] ?? 0;

      if (sdf > -1.1) {
        const edge = Math.min(1, Math.max(0, 1 + sdf / 1.1));
        const sheen = edge * 0.18;
        r = Math.round(r + (235 - r) * sheen);
        g = Math.round(g + (226 - g) * sheen);
        b = Math.round(b + (252 - b) * sheen);
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(outAlpha * 255);
    }
  }
  return rgba;
}

/**
 * Composites a rounded-squircle Rutico tray icon with a crisp bottom-right cutout status badge
 * (idle keeps the clean icon with no badge dot).
 */
export function composeTrayIconPng(
  baseRgba: Uint8Array | null,
  status: DesktopTrayAgentStatus,
  size: number,
): Buffer {
  const pixels =
    baseRgba !== null && baseRgba.length >= size * size * 4
      ? applySquircleMask(baseRgba, size)
      : renderFallbackMonogramRgba(size);

  if (status !== "idle") {
    const { core, highlight } = STATUS_BADGE_COLORS[status];
    const bx = size * 0.77;
    const by = size * 0.77;
    const badgeRadius = size * 0.21;
    const cutoutRadius = badgeRadius + Math.max(1.25, size * 0.065);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - bx;
        const dy = y - by;
        const dist = Math.hypot(dx, dy);
        if (dist > cutoutRadius + 0.75) continue;

        const idx = (y * size + x) * 4;
        // Part the underlying icon smoothly around the status dot for crisp legibility on any bar.
        const cutoutKeep = Math.min(1, Math.max(0, dist - (cutoutRadius - 0.5)));
        const dstA = ((pixels[idx + 3] ?? 0) / 255) * cutoutKeep;
        const dstR = pixels[idx] ?? 0;
        const dstG = pixels[idx + 1] ?? 0;
        const dstB = pixels[idx + 2] ?? 0;

        const srcA = Math.min(1, Math.max(0, badgeRadius + 0.5 - dist));
        if (srcA <= 0) {
          pixels[idx + 3] = Math.round(dstA * 255);
          continue;
        }

        const spec = Math.max(
          0,
          1 - Math.hypot(dx + badgeRadius * 0.28, dy + badgeRadius * 0.28) / (badgeRadius * 1.15),
        );
        const mix = spec * 0.42;
        const srcR = core[0] + (highlight[0] - core[0]) * mix;
        const srcG = core[1] + (highlight[1] - core[1]) * mix;
        const srcB = core[2] + (highlight[2] - core[2]) * mix;

        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) {
          pixels[idx + 3] = 0;
          continue;
        }
        pixels[idx] = Math.round((srcR * srcA + dstR * dstA * (1 - srcA)) / outA);
        pixels[idx + 1] = Math.round((srcG * srcA + dstG * dstA * (1 - srcA)) / outA);
        pixels[idx + 2] = Math.round((srcB * srcA + dstB * dstA * (1 - srcA)) / outA);
        pixels[idx + 3] = Math.round(outA * 255);
      }
    }
  }

  return encodeRgbaPng(pixels, size);
}

function loadBaseIconRgba(iconPath: string | null, size: number): Uint8Array | null {
  if (!iconPath) return null;
  try {
    const loaded = Electron.nativeImage.createFromPath(iconPath);
    if (loaded.isEmpty()) return null;
    const { width, height } = loaded.getSize();
    if (width <= 0 || height <= 0) return null;
    // Trim outer transparent margin and frame stroke on high-res app icons so the portrait
    // fills the 22px/44px tray icon cleanly without a bulky border box.
    const insetRatio = width >= 128 && height >= 128 ? 0.088 : 0;
    const cropX = Math.round(width * insetRatio);
    const cropY = Math.round(height * insetRatio);
    const cropW = Math.max(1, width - cropX * 2);
    const cropH = Math.max(1, height - cropY * 2);
    const cropped =
      insetRatio > 0 ? loaded.crop({ x: cropX, y: cropY, width: cropW, height: cropH }) : loaded;
    const resized = cropped.resize({ width: size, height: size, quality: "best" });
    const resizedSize = resized.getSize();
    if (resizedSize.width !== size || resizedSize.height !== size) return null;
    const bgra = resized.toBitmap();
    if (bgra.length < size * size * 4) return null;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size * 4; i += 4) {
      const b = bgra[i]!;
      const g = bgra[i + 1]!;
      const r = bgra[i + 2]!;
      const a = bgra[i + 3]!;
      if (a === 0) continue;
      if (a === 255) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      } else {
        rgba[i] = Math.min(255, Math.round((r * 255) / a));
        rgba[i + 1] = Math.min(255, Math.round((g * 255) / a));
        rgba[i + 2] = Math.min(255, Math.round((b * 255) / a));
        rgba[i + 3] = a;
      }
    }
    return rgba;
  } catch {
    return null;
  }
}

function buildCachedStatusImages(
  iconPath: string | null,
): Record<DesktopTrayAgentStatus, Electron.NativeImage> {
  const base1x = loadBaseIconRgba(iconPath, 22);
  const base2x = loadBaseIconRgba(iconPath, 44);
  const cache = {} as Record<DesktopTrayAgentStatus, Electron.NativeImage>;
  for (const status of TRAY_STATUSES) {
    const img1x = composeTrayIconPng(base1x, status, 22);
    const img2x = composeTrayIconPng(base2x, status, 44);
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
  readonly buildImages?: (
    iconPath: string | null,
  ) => Record<DesktopTrayAgentStatus, Electron.NativeImage>;
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
  const desktopAssets = yield* Effect.serviceOption(DesktopAssets.DesktopAssets);
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
    const iconPath = Option.isSome(desktopAssets)
      ? yield* desktopAssets.value.iconPaths.pipe(
          Effect.map((paths) => Option.getOrNull(paths.png)),
          Effect.catchCause(() => Effect.succeed(null)),
        )
      : null;
    yield* Effect.try({
      try: () => {
        cachedImages = (deps.buildImages ?? buildCachedStatusImages)(iconPath);
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

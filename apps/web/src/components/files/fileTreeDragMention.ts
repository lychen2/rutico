import {
  COMPOSER_MENTION_DRAG_TYPE,
  composerMentionFromTreePath,
} from "~/components/chat/composerMentionDrag";
import { prefersReducedMotion } from "~/lib/motion/springs";

interface FileTreeDragTransfer {
  setData(format: string, data: string): void;
  setDragImage?(image: Element, x: number, y: number): void;
}

export interface FileTreeDragStartEvent {
  readonly dataTransfer: FileTreeDragTransfer | null;
  readonly clientX?: number;
  readonly clientY?: number;
  composedPath(): ReadonlyArray<unknown>;
}

export interface FileTreeDragMentionHost {
  /** The path a dragged row mentions; defaults to the tree path itself. */
  mentionPath?(treePath: string): string;
}

export interface FileTreeDragMentionController {
  isDragInProgress(): boolean;
  handleSelectionChange(selectedPaths: ReadonlyArray<string>): void;
  handleDragStart(event: FileTreeDragStartEvent): void;
  handleDragEnd(deselect: (treePath: string) => void): void;
}

export interface FileTreeDragFlightEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly name: string;
  readonly directory: string;
}

export interface FileTreeDragFlightState {
  readonly primary: FileTreeDragFlightEntry;
  readonly count: number;
  readonly initialX: number;
  readonly initialY: number;
}

const MAX_FLIGHT_TILT_DEG = 5;
const FLIGHT_VELOCITY_TILT_FACTOR = 0.15;
const FLIGHT_OFFSET_X = 14;
const FLIGHT_OFFSET_Y = 14;

/** Maps horizontal drag velocity (px/frame) into subtle aerodynamic card tilt. */
export function computeDragFlightTiltDeg(vxPxPerFrame: number): number {
  if (!Number.isFinite(vxPxPerFrame)) return 0;
  const raw = vxPxPerFrame * FLIGHT_VELOCITY_TILT_FACTOR;
  if (Math.abs(raw) < 0.08) return 0;
  return Math.max(-MAX_FLIGHT_TILT_DEG, Math.min(MAX_FLIGHT_TILT_DEG, raw));
}

function parseDragFlightEntry(treePath: string): FileTreeDragFlightEntry {
  const isDirectory = treePath.endsWith("/");
  const cleanPath = treePath.replace(/\/+$/, "");
  const slashIndex = cleanPath.lastIndexOf("/");
  return {
    path: cleanPath,
    kind: isDirectory ? "directory" : "file",
    name: slashIndex === -1 ? cleanPath : cleanPath.slice(slashIndex + 1),
    directory: slashIndex === -1 ? "" : cleanPath.slice(0, slashIndex),
  };
}

let cachedBlankDragImage: HTMLCanvasElement | null = null;

function getTransparentDragImage(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (cachedBlankDragImage) return cachedBlankDragImage;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  cachedBlankDragImage = canvas;
  return canvas;
}

let activeFlight: FileTreeDragFlightState | null = null;
const flightListeners = new Set<() => void>();
let flightElement: HTMLElement | null = null;
let flightTargetX = 0;
let flightTargetY = 0;
let flightLastX = 0;
let flightVelocityX = 0;
let flightRafId: number | null = null;
let detachWindowDragListeners: (() => void) | null = null;

function notifyFlightListeners() {
  for (const listener of flightListeners) {
    listener();
  }
}

function writeFlightTransform(x: number, y: number, tiltDeg: number) {
  if (!flightElement) return;
  const roundedX = Math.round(x + FLIGHT_OFFSET_X);
  const roundedY = Math.round(y + FLIGHT_OFFSET_Y);
  if (tiltDeg === 0) {
    flightElement.style.transform = `translate3d(${roundedX}px, ${roundedY}px, 0)`;
    return;
  }
  flightElement.style.transform = `translate3d(${roundedX}px, ${roundedY}px, 0) rotate(${tiltDeg.toFixed(2)}deg)`;
}

function tickFlightFrame() {
  flightRafId = null;
  if (activeFlight === null) return;
  const dx = flightTargetX - flightLastX;
  flightLastX = flightTargetX;
  // Blend instantaneous horizontal delta with smooth aerodynamic decay.
  flightVelocityX = flightVelocityX * 0.72 + dx * 0.65;
  const tiltDeg = prefersReducedMotion() ? 0 : computeDragFlightTiltDeg(flightVelocityX);
  writeFlightTransform(flightTargetX, flightTargetY, tiltDeg);

  if (Math.abs(flightVelocityX) > 0.08 && !prefersReducedMotion()) {
    flightRafId = window.requestAnimationFrame(tickFlightFrame);
  }
}

function scheduleFlightFrame() {
  if (typeof window === "undefined" || flightRafId !== null) return;
  flightRafId = window.requestAnimationFrame(tickFlightFrame);
}

function stopFileTreeDragFlight() {
  if (flightRafId !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(flightRafId);
    flightRafId = null;
  }
  detachWindowDragListeners?.();
  detachWindowDragListeners = null;
  flightVelocityX = 0;
  if (activeFlight !== null) {
    activeFlight = null;
    notifyFlightListeners();
  }
}

function startFileTreeDragFlight(
  draggedPaths: ReadonlyArray<string>,
  startX: number,
  startY: number,
) {
  if (typeof window === "undefined" || draggedPaths.length === 0) return;
  const primaryPath = draggedPaths[0];
  if (!primaryPath) return;

  stopFileTreeDragFlight();
  flightTargetX = startX;
  flightTargetY = startY;
  flightLastX = startX;
  flightVelocityX = 0;

  activeFlight = {
    primary: parseDragFlightEntry(primaryPath),
    count: draggedPaths.length,
    initialX: startX,
    initialY: startY,
  };
  notifyFlightListeners();

  const onDragCoordinate = (event: DragEvent) => {
    // Chromium emits a trailing (0, 0) drag event right before dragend; ignore it.
    if (event.clientX === 0 && event.clientY === 0) return;
    flightTargetX = event.clientX;
    flightTargetY = event.clientY;
    scheduleFlightFrame();
  };

  const onDragDone = () => {
    stopFileTreeDragFlight();
  };

  window.addEventListener("dragover", onDragCoordinate, { capture: true, passive: true });
  window.addEventListener("drag", onDragCoordinate, { capture: true, passive: true });
  window.addEventListener("drop", onDragDone, { capture: true, passive: true });
  window.addEventListener("dragend", onDragDone, { capture: true, passive: true });

  detachWindowDragListeners = () => {
    window.removeEventListener("dragover", onDragCoordinate, { capture: true });
    window.removeEventListener("drag", onDragCoordinate, { capture: true });
    window.removeEventListener("drop", onDragDone, { capture: true });
    window.removeEventListener("dragend", onDragDone, { capture: true });
  };
}

export function subscribeFileTreeDragFlight(listener: () => void): () => void {
  flightListeners.add(listener);
  return () => {
    flightListeners.delete(listener);
  };
}

export function getFileTreeDragFlightSnapshot(): FileTreeDragFlightState | null {
  return activeFlight;
}

export function attachFileTreeDragFlightElement(element: HTMLElement | null): void {
  flightElement = element;
  if (element && activeFlight) {
    writeFlightTransform(flightTargetX, flightTargetY, 0);
  }
}

const itemPathOf = (node: unknown): string | null => {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const element = node as { getAttribute?: (name: string) => string | null };
  return typeof element.getAttribute === "function" ? element.getAttribute("data-item-path") : null;
};

export function createFileTreeDragMentionController(
  host: FileTreeDragMentionHost,
): FileTreeDragMentionController {
  let selection: ReadonlyArray<string> = [];
  let draggedPaths: ReadonlyArray<string> = [];
  return {
    isDragInProgress: () => draggedPaths.length > 0,
    handleSelectionChange(selectedPaths) {
      selection = selectedPaths;
    },
    handleDragStart(event) {
      if (event.dataTransfer === null) {
        return;
      }
      // Require a tree-row origin; text/plain fallback would misclassify selected panel text as a mention.
      let itemPath: string | null = null;
      for (const node of event.composedPath()) {
        itemPath = itemPathOf(node);
        if (itemPath !== null) {
          break;
        }
      }
      if (itemPath === null) {
        return;
      }
      const dragged = selection.includes(itemPath) ? selection : [itemPath];
      const mentions = dragged
        .map((path) => {
          const treePath = path.replace(/\/+$/, "");
          return composerMentionFromTreePath(
            treePath && host.mentionPath ? host.mentionPath(treePath) : path,
          );
        })
        .filter((mention): mention is string => mention !== null);
      if (mentions.length === 0) {
        return;
      }
      draggedPaths = dragged;
      event.dataTransfer.setData(COMPOSER_MENTION_DRAG_TYPE, mentions.join(" "));

      // Replace the coarse native OS drag bitmap with our optical velocity-tilted flight card.
      if (typeof event.clientX === "number" && typeof event.clientY === "number") {
        const blank = getTransparentDragImage();
        if (blank && typeof event.dataTransfer.setDragImage === "function") {
          event.dataTransfer.setDragImage(blank, 0, 0);
        }
        startFileTreeDragFlight(dragged, event.clientX, event.clientY);
      }
    },
    handleDragEnd(deselect) {
      stopFileTreeDragFlight();
      if (draggedPaths.length === 0) {
        return;
      }
      for (const path of draggedPaths) {
        deselect(path);
      }
      draggedPaths = [];
    },
  };
}

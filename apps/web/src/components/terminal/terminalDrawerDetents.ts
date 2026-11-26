export const TERMINAL_DRAWER_COMPACT_HEIGHT = 220;
const TERMINAL_DRAWER_BALANCED_RATIO = 0.4;
const TERMINAL_DRAWER_TALL_RATIO = 0.65;
const TERMINAL_DRAWER_SNAP_RADIUS_PX = 14;
export const TERMINAL_DRAWER_COLLAPSE_THRESHOLD_PX = 120;

export type TerminalDrawerDetentKind = "compact" | "balanced" | "tall";

export interface TerminalDrawerDetent {
  readonly kind: TerminalDrawerDetentKind;
  readonly height: number;
}

function clampHeight(height: number, minHeight: number, maxHeight: number): number {
  const safeMax = Math.max(minHeight, maxHeight);
  return Math.min(safeMax, Math.max(minHeight, Math.round(height)));
}

export function resolveTerminalDrawerDetents(input: {
  readonly referenceHeight: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}): readonly TerminalDrawerDetent[] {
  const referenceHeight = Math.max(input.maxHeight, input.referenceHeight);
  const candidates: readonly TerminalDrawerDetent[] = [
    {
      kind: "compact",
      height: clampHeight(TERMINAL_DRAWER_COMPACT_HEIGHT, input.minHeight, input.maxHeight),
    },
    {
      kind: "balanced",
      height: clampHeight(
        referenceHeight * TERMINAL_DRAWER_BALANCED_RATIO,
        input.minHeight,
        input.maxHeight,
      ),
    },
    {
      kind: "tall",
      height: clampHeight(
        referenceHeight * TERMINAL_DRAWER_TALL_RATIO,
        input.minHeight,
        input.maxHeight,
      ),
    },
  ];
  const detents: TerminalDrawerDetent[] = [];
  for (const candidate of candidates) {
    if (detents.some((existing) => Math.abs(existing.height - candidate.height) < 20)) continue;
    detents.push(candidate);
  }
  return detents;
}

export function resolveTerminalDrawerDragHeight(input: {
  readonly rawHeight: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly referenceHeight: number;
  readonly bypassSnap?: boolean;
}): {
  readonly height: number;
  readonly snappedDetent: TerminalDrawerDetentKind | null;
  readonly shouldCollapse: boolean;
} {
  if (input.rawHeight < TERMINAL_DRAWER_COLLAPSE_THRESHOLD_PX) {
    return {
      height: clampHeight(input.minHeight, input.minHeight, input.maxHeight),
      snappedDetent: null,
      shouldCollapse: true,
    };
  }
  const clamped = clampHeight(input.rawHeight, input.minHeight, input.maxHeight);
  if (input.bypassSnap) {
    return { height: clamped, snappedDetent: null, shouldCollapse: false };
  }
  const detents = resolveTerminalDrawerDetents({
    referenceHeight: input.referenceHeight,
    minHeight: input.minHeight,
    maxHeight: input.maxHeight,
  });
  let nearest: TerminalDrawerDetent | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const detent of detents) {
    const distance = Math.abs(clamped - detent.height);
    if (distance <= TERMINAL_DRAWER_SNAP_RADIUS_PX && distance < nearestDistance) {
      nearest = detent;
      nearestDistance = distance;
    }
  }
  return {
    height: nearest ? nearest.height : clamped,
    snappedDetent: nearest ? nearest.kind : null,
    shouldCollapse: false,
  };
}

export function nextTerminalDrawerDoubleClickHeight(input: {
  readonly currentHeight: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly referenceHeight: number;
}): number {
  const detents = resolveTerminalDrawerDetents({
    referenceHeight: input.referenceHeight,
    minHeight: input.minHeight,
    maxHeight: input.maxHeight,
  });
  const compact =
    detents.find((detent) => detent.kind === "compact")?.height ??
    clampHeight(TERMINAL_DRAWER_COMPACT_HEIGHT, input.minHeight, input.maxHeight);
  const tall =
    detents.find((detent) => detent.kind === "tall")?.height ??
    clampHeight(
      input.referenceHeight * TERMINAL_DRAWER_TALL_RATIO,
      input.minHeight,
      input.maxHeight,
    );
  const midpoint = (compact + tall) / 2;
  return input.currentHeight >= midpoint ? compact : tall;
}

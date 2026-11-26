export type PredictiveBackLayer = "modal" | "rail" | "panel" | "screen-stack";
export type PredictiveBackPhase = "start" | "progress" | "cancel" | "commit";
export type PredictiveBackEdge = 0 | 1;

export interface RawPredictiveBackPayload {
  readonly phase: PredictiveBackPhase;
  readonly progress?: number;
  readonly swipeEdge?: number;
  readonly touchX?: number;
  readonly touchY?: number;
  readonly source?: "compat" | "native-panel" | "native-rail";
  readonly hadGesture?: boolean;
}

export interface PredictiveBackEvent {
  readonly phase: PredictiveBackPhase;
  readonly progress: number;
  readonly swipeEdge: PredictiveBackEdge;
  readonly touchX: number;
  readonly touchY: number;
  readonly owner: PredictiveBackLayer;
  readonly hadGesture: boolean;
}

export interface PredictiveBackOwnerHandlers {
  readonly layer: PredictiveBackLayer;
  /**
   * Called at gesture start when this owner wins arbitration.
   * Only the locked owner receives subsequent progress/cancel/commit events.
   */
  readonly onStart?: (event: PredictiveBackEvent) => void;
  readonly onProgress?: (event: PredictiveBackEvent) => void;
  readonly onCancel?: (event: PredictiveBackEvent) => void;
  /**
   * Called at most once when the back gesture or hardware back press commits.
   * Note: for `"modal"` and `"screen-stack"` preview observers driven by the API 33-35 compat shim,
   * React Navigation / react-native-screens handles the actual pop via RN back dispatch, so `onCommit`
   * should only clean up preview state rather than popping a second time.
   */
  readonly onCommit?: (event: PredictiveBackEvent) => void;
}

const LAYER_PRIORITY: Readonly<Record<PredictiveBackLayer, number>> = {
  modal: 300,
  rail: 200,
  panel: 100,
  "screen-stack": 0,
};

interface RegisteredOwner {
  readonly id: number;
  readonly order: number;
  readonly handlers: PredictiveBackOwnerHandlers;
}

export interface PredictiveBackArbiter {
  register(handlers: PredictiveBackOwnerHandlers): () => void;
  dispatch(payload: RawPredictiveBackPayload): PredictiveBackLayer | null;
  activeOwnerLayer(): PredictiveBackLayer | null;
  countByLayer(layer: PredictiveBackLayer): number;
  reset(): void;
}

function normalizeEdge(edge: number | undefined): PredictiveBackEdge {
  return edge === 1 ? 1 : 0;
}

function clampProgress(progress: number | undefined): number {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function finiteNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Deterministic single-owner Predictive Back arbiter.
 * Priority: modal -> expanded rail -> panel -> screen-stack (ties broken by LIFO registration).
 * Locks the winning owner at `start` so mid-gesture state changes never split or double-commit.
 */
export function createPredictiveBackArbiter(
  onOwnerCountsChange?: (counts: { readonly modal: number; readonly panel: number }) => void,
): PredictiveBackArbiter {
  const owners = new Map<number, RegisteredOwner>();
  let nextId = 1;
  let lockedOwnerId: number | null = null;
  let gestureActive = false;

  const countByLayer = (layer: PredictiveBackLayer): number => {
    let count = 0;
    for (const entry of owners.values()) {
      if (entry.handlers.layer === layer) count += 1;
    }
    return count;
  };

  const notifyCounts = () => {
    onOwnerCountsChange?.({
      modal: countByLayer("modal"),
      panel: countByLayer("panel"),
    });
  };

  const pickHighestPriorityOwner = (
    preferredLayer?: PredictiveBackLayer,
  ): RegisteredOwner | null => {
    let best: RegisteredOwner | null = null;
    for (const entry of owners.values()) {
      if (preferredLayer !== undefined && entry.handlers.layer !== preferredLayer) {
        continue;
      }
      if (best === null) {
        best = entry;
        continue;
      }
      const entryPriority = LAYER_PRIORITY[entry.handlers.layer];
      const bestPriority = LAYER_PRIORITY[best.handlers.layer];
      if (
        entryPriority > bestPriority ||
        (entryPriority === bestPriority && entry.order > best.order)
      ) {
        best = entry;
      }
    }
    return best;
  };

  const resolveTarget = (payload: RawPredictiveBackPayload): RegisteredOwner | null => {
    if (lockedOwnerId !== null) {
      return owners.get(lockedOwnerId) ?? null;
    }
    // Native panel callback only fires when native arbitration chose PANEL as sole owner.
    if (payload.source === "native-panel") {
      return pickHighestPriorityOwner("panel");
    }
    return pickHighestPriorityOwner();
  };

  return {
    register(handlers) {
      const id = nextId++;
      owners.set(id, { id, order: id, handlers });
      notifyCounts();
      return () => {
        owners.delete(id);
        if (lockedOwnerId === id) {
          lockedOwnerId = null;
          gestureActive = false;
        }
        notifyCounts();
      };
    },
    dispatch(payload) {
      if (payload.phase === "start") {
        // Ignore re-entrant starts while an owner already holds an active gesture.
        if (gestureActive && lockedOwnerId !== null && owners.has(lockedOwnerId)) {
          return owners.get(lockedOwnerId)!.handlers.layer;
        }
        const winner = resolveTarget(payload);
        if (winner === null) {
          lockedOwnerId = null;
          gestureActive = false;
          return null;
        }
        lockedOwnerId = winner.id;
        gestureActive = true;
        const event: PredictiveBackEvent = {
          phase: "start",
          progress: clampProgress(payload.progress),
          swipeEdge: normalizeEdge(payload.swipeEdge),
          touchX: finiteNumber(payload.touchX),
          touchY: finiteNumber(payload.touchY),
          owner: winner.handlers.layer,
          hadGesture: true,
        };
        winner.handlers.onStart?.(event);
        return winner.handlers.layer;
      }

      if (payload.phase === "progress") {
        // Only the locked owner receives progress events; never broadcast to other layers.
        if (!gestureActive || lockedOwnerId === null) return null;
        const winner = owners.get(lockedOwnerId);
        if (!winner) return null;
        const event: PredictiveBackEvent = {
          phase: "progress",
          progress: clampProgress(payload.progress),
          swipeEdge: normalizeEdge(payload.swipeEdge),
          touchX: finiteNumber(payload.touchX),
          touchY: finiteNumber(payload.touchY),
          owner: winner.handlers.layer,
          hadGesture: true,
        };
        winner.handlers.onProgress?.(event);
        return winner.handlers.layer;
      }

      if (payload.phase === "cancel") {
        const winner = lockedOwnerId !== null ? (owners.get(lockedOwnerId) ?? null) : null;
        lockedOwnerId = null;
        gestureActive = false;
        if (!winner) return null;
        const event: PredictiveBackEvent = {
          phase: "cancel",
          progress: 0,
          swipeEdge: normalizeEdge(payload.swipeEdge),
          touchX: finiteNumber(payload.touchX),
          touchY: finiteNumber(payload.touchY),
          owner: winner.handlers.layer,
          hadGesture: true,
        };
        winner.handlers.onCancel?.(event);
        return winner.handlers.layer;
      }

      // Commit fires once for the locked owner, or resolves the current top owner for discrete
      // API 33 / hardware-button back presses that arrive without a preceding start event.
      const hadGesture = gestureActive || payload.hadGesture === true;
      const winner = resolveTarget(payload);
      lockedOwnerId = null;
      gestureActive = false;
      if (!winner) return null;
      const event: PredictiveBackEvent = {
        phase: "commit",
        progress: 1,
        swipeEdge: normalizeEdge(payload.swipeEdge),
        touchX: finiteNumber(payload.touchX),
        touchY: finiteNumber(payload.touchY),
        owner: winner.handlers.layer,
        hadGesture,
      };
      winner.handlers.onCommit?.(event);
      return winner.handlers.layer;
    },
    activeOwnerLayer() {
      if (lockedOwnerId !== null) {
        return owners.get(lockedOwnerId)?.handlers.layer ?? null;
      }
      return pickHighestPriorityOwner()?.handlers.layer ?? null;
    },
    countByLayer,
    reset() {
      owners.clear();
      lockedOwnerId = null;
      gestureActive = false;
      notifyCounts();
    },
  };
}

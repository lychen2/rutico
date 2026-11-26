import { describe, expect, it, vi } from "vite-plus/test";

import {
  createPredictiveBackArbiter,
  type PredictiveBackEvent,
  type PredictiveBackLayer,
} from "./androidPredictiveBackArbiter";

describe("createPredictiveBackArbiter", () => {
  it("enforces deterministic single-owner arbitration: modal -> rail -> panel -> screen-stack", () => {
    const counts: Array<{ readonly modal: number; readonly panel: number }> = [];
    const arbiter = createPredictiveBackArbiter((next) => counts.push(next));

    const stackCommit = vi.fn();
    const panelCommit = vi.fn();
    const railCommit = vi.fn();
    const modalCommit = vi.fn();

    const unsubStack = arbiter.register({ layer: "screen-stack", onCommit: stackCommit });
    expect(arbiter.activeOwnerLayer()).toBe("screen-stack");

    const unsubPanel = arbiter.register({ layer: "panel", onCommit: panelCommit });
    expect(arbiter.activeOwnerLayer()).toBe("panel");

    const unsubRail = arbiter.register({ layer: "rail", onCommit: railCommit });
    expect(arbiter.activeOwnerLayer()).toBe("rail");

    const unsubModal = arbiter.register({ layer: "modal", onCommit: modalCommit });
    expect(arbiter.activeOwnerLayer()).toBe("modal");

    expect(arbiter.dispatch({ phase: "commit" })).toBe("modal");
    expect(modalCommit).toHaveBeenCalledTimes(1);
    expect(railCommit).not.toHaveBeenCalled();
    expect(panelCommit).not.toHaveBeenCalled();
    expect(stackCommit).not.toHaveBeenCalled();

    unsubModal();
    expect(arbiter.dispatch({ phase: "commit" })).toBe("rail");
    expect(railCommit).toHaveBeenCalledTimes(1);
    expect(panelCommit).not.toHaveBeenCalled();

    unsubRail();
    expect(arbiter.dispatch({ phase: "commit" })).toBe("panel");
    expect(panelCommit).toHaveBeenCalledTimes(1);
    expect(stackCommit).not.toHaveBeenCalled();

    unsubPanel();
    expect(arbiter.dispatch({ phase: "commit" })).toBe("screen-stack");
    expect(stackCommit).toHaveBeenCalledTimes(1);

    unsubStack();
    expect(arbiter.activeOwnerLayer()).toBeNull();
    expect(counts.at(-1)).toEqual({ modal: 0, panel: 0 });
  });

  it("locks the winning owner at start and cancels without committing", () => {
    const arbiter = createPredictiveBackArbiter();
    const panelEvents: PredictiveBackEvent[] = [];
    const modalEvents: PredictiveBackEvent[] = [];

    arbiter.register({
      layer: "panel",
      onStart: (event) => panelEvents.push(event),
      onProgress: (event) => panelEvents.push(event),
      onCancel: (event) => panelEvents.push(event),
      onCommit: (event) => panelEvents.push(event),
    });

    expect(arbiter.dispatch({ phase: "start", progress: 0.05, swipeEdge: 0 })).toBe("panel");

    // Registering a modal mid-gesture must not steal the active swipe.
    arbiter.register({
      layer: "modal",
      onStart: (event) => modalEvents.push(event),
      onProgress: (event) => modalEvents.push(event),
      onCancel: (event) => modalEvents.push(event),
      onCommit: (event) => modalEvents.push(event),
    });

    expect(arbiter.dispatch({ phase: "progress", progress: 0.42, swipeEdge: 0 })).toBe("panel");
    expect(arbiter.dispatch({ phase: "cancel", swipeEdge: 0 })).toBe("panel");

    expect(panelEvents.map((e) => e.phase)).toEqual(["start", "progress", "cancel"]);
    expect(panelEvents[1]?.progress).toBeCloseTo(0.42);
    expect(modalEvents).toHaveLength(0);

    // After cancel releases the lock, the next gesture goes to the modal.
    expect(arbiter.dispatch({ phase: "start", progress: 0.1, swipeEdge: 1 })).toBe("modal");
    expect(arbiter.dispatch({ phase: "commit", swipeEdge: 1 })).toBe("modal");
    expect(modalEvents.map((e) => e.phase)).toEqual(["start", "commit"]);
    expect(modalEvents[1]?.swipeEdge).toBe(1);
    expect(modalEvents[1]?.hadGesture).toBe(true);
  });

  it("handles discrete API 33 / button back commits without prior start and ignores orphan progress", () => {
    const arbiter = createPredictiveBackArbiter();
    const phases: Array<{ readonly owner: PredictiveBackLayer; readonly hadGesture: boolean }> = [];

    arbiter.register({
      layer: "screen-stack",
      onProgress: () => phases.push({ owner: "screen-stack", hadGesture: true }),
      onCommit: (event) => phases.push({ owner: event.owner, hadGesture: event.hadGesture }),
    });

    expect(arbiter.dispatch({ phase: "progress", progress: 0.5 })).toBeNull();
    expect(arbiter.dispatch({ phase: "commit" })).toBe("screen-stack");
    expect(phases).toEqual([{ owner: "screen-stack", hadGesture: false }]);
  });

  it("routes native-panel events exclusively to the active panel owner", () => {
    const arbiter = createPredictiveBackArbiter();
    const stackCommit = vi.fn();
    const panelCommit = vi.fn();

    arbiter.register({ layer: "screen-stack", onCommit: stackCommit });
    arbiter.register({ layer: "panel", onCommit: panelCommit });

    expect(arbiter.dispatch({ phase: "start", source: "native-panel", progress: 0 })).toBe("panel");
    expect(arbiter.dispatch({ phase: "commit", source: "native-panel" })).toBe("panel");
    expect(panelCommit).toHaveBeenCalledTimes(1);
    expect(stackCommit).not.toHaveBeenCalled();
  });
});

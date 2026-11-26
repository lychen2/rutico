import { Atom, AtomRegistry } from "effect/reactivity";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  os: "ios" as "ios" | "android",
  appActive: true,
  selectionAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  performAndroidHapticsAsync: vi.fn(async () => {}),
  threadAtom: null as Atom.Writable<unknown, unknown> | null,
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return harness.os;
    },
  },
}));
vi.mock("expo-haptics", () => ({
  AndroidHaptics: {
    Confirm: "confirm",
    Reject: "reject",
    Gesture_Start: "gesture-start",
    Gesture_End: "gesture-end",
    Segment_Tick: "segment-tick",
    Segment_Frequent_Tick: "segment-frequent-tick",
    Clock_Tick: "clock-tick",
    Toggle_On: "toggle-on",
    Toggle_Off: "toggle-off",
    Context_Click: "context-click",
    Drag_Start: "drag-start",
    Long_Press: "long-press",
  },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Soft: "soft" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  performAndroidHapticsAsync: harness.performAndroidHapticsAsync,
  selectionAsync: harness.selectionAsync,
  impactAsync: harness.impactAsync,
  notificationAsync: harness.notificationAsync,
}));
vi.mock("../../lib/appState", () => ({
  isAppActive: () => harness.appActive,
}));
vi.mock("../../state/threads", () => ({
  environmentThreadDetails: {
    threadAtom: () => harness.threadAtom,
  },
}));

import {
  shouldFireRunFailedHaptic,
  shouldFireStreamCompleteHaptic,
  shouldFireToolCompleteHaptic,
  shouldTickStreamHaptic,
  threadStreamHaptics,
} from "./threadStreamHaptics";

const mark = (id: string, textLength: number) => ({ id, textLength });

describe("shouldTickStreamHaptic", () => {
  it("ticks for a new stream even inside the throttle window", () => {
    expect(
      shouldTickStreamHaptic({
        previous: mark("a", 40),
        latest: mark("b", 1),
        lastTickAt: 0,
        now: 10,
      }),
    ).toBe(true);
    expect(
      shouldTickStreamHaptic({ previous: null, latest: mark("a", 1), lastTickAt: 0, now: 10 }),
    ).toBe(true);
  });

  it("throttles growth of the same stream", () => {
    const growth = { previous: mark("a", 10), latest: mark("a", 20), lastTickAt: 1_000 };
    expect(shouldTickStreamHaptic({ ...growth, now: 1_200 })).toBe(false);
    expect(shouldTickStreamHaptic({ ...growth, now: 1_320 })).toBe(true);
  });

  it("stays quiet when nothing streams or the text did not grow", () => {
    expect(
      shouldTickStreamHaptic({ previous: mark("a", 10), latest: null, lastTickAt: 0, now: 5_000 }),
    ).toBe(false);
    expect(
      shouldTickStreamHaptic({
        previous: mark("a", 10),
        latest: mark("a", 10),
        lastTickAt: 0,
        now: 5_000,
      }),
    ).toBe(false);
  });
});

describe("shouldFireStreamCompleteHaptic", () => {
  it("fires only when an observed streaming message settles into a completed message", () => {
    expect(
      shouldFireStreamCompleteHaptic({
        previous: mark("a", 40),
        latest: null,
        completedMessagePresent: true,
      }),
    ).toBe(true);
    expect(
      shouldFireStreamCompleteHaptic({
        previous: mark("a", 40),
        latest: null,
        completedMessagePresent: false,
      }),
    ).toBe(false);
    expect(
      shouldFireStreamCompleteHaptic({
        previous: null,
        latest: null,
        completedMessagePresent: true,
      }),
    ).toBe(false);
  });
});

describe("shouldFireToolCompleteHaptic and shouldFireRunFailedHaptic", () => {
  it("detects tool completion increments and newly failed runs", () => {
    expect(
      shouldFireToolCompleteHaptic({ previousCompletedCount: 1, currentCompletedCount: 2 }),
    ).toBe(true);
    expect(
      shouldFireToolCompleteHaptic({ previousCompletedCount: 2, currentCompletedCount: 2 }),
    ).toBe(false);
    expect(
      shouldFireRunFailedHaptic({ previousFailedRunId: null, latestFailedRunId: "run-1" }),
    ).toBe(true);
    expect(
      shouldFireRunFailedHaptic({ previousFailedRunId: "run-1", latestFailedRunId: "run-1" }),
    ).toBe(false);
  });
});

describe("threadStreamHaptics foreground gating & completion", () => {
  beforeEach(() => {
    harness.os = "ios";
    harness.appActive = true;
    harness.selectionAsync.mockClear();
    harness.impactAsync.mockClear();
    harness.notificationAsync.mockClear();
    harness.performAndroidHapticsAsync.mockClear();
  });

  it("suppresses haptics while backgrounded and fires a light completion impact in the foreground", () => {
    harness.threadAtom = Atom.make<unknown>({
      projection: {
        messages: [{ id: "m1", role: "assistant", streaming: true, text: "Hello" }],
      },
    });
    const registry = AtomRegistry.make();
    const unmount = registry.mount(
      threadStreamHaptics({
        environmentId: "env-haptic-1" as EnvironmentId,
        threadId: "thread-haptic-1" as ThreadId,
      }),
    );

    try {
      // Initial seed stays silent.
      expect(harness.selectionAsync).not.toHaveBeenCalled();
      expect(harness.impactAsync).not.toHaveBeenCalled();

      // Backgrounded updates stay silent.
      harness.appActive = false;
      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m2", role: "assistant", streaming: true, text: "Hi" }],
        },
      });
      expect(harness.selectionAsync).not.toHaveBeenCalled();

      // Returning to foreground resumes ticking for new streams and fires Light on completion.
      harness.appActive = true;
      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m3", role: "assistant", streaming: true, text: "Done?" }],
        },
      });
      expect(harness.selectionAsync).toHaveBeenCalledTimes(1);

      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m3", role: "assistant", streaming: false, text: "Done!" }],
        },
      });
      expect(harness.impactAsync).toHaveBeenCalledTimes(1);
      expect(harness.impactAsync).toHaveBeenCalledWith("light");
    } finally {
      unmount();
    }
  });

  it("fires Android semantic haptic ladder for stream token, tool completion, turn completion and failure", () => {
    harness.os = "android";
    harness.threadAtom = Atom.make<unknown>({
      projection: {
        messages: [],
        turnItems: [],
        runs: [],
      },
    });
    const registry = AtomRegistry.make();
    const unmount = registry.mount(
      threadStreamHaptics({
        environmentId: "env-android-1" as EnvironmentId,
        threadId: "thread-android-1" as ThreadId,
      }),
    );

    try {
      // 1. First token -> Clock_Tick
      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m1", role: "assistant", streaming: true, text: "Hel" }],
          turnItems: [],
          runs: [],
        },
      });
      expect(harness.performAndroidHapticsAsync).toHaveBeenLastCalledWith("clock-tick");

      // 2. Tool completion -> Segment_Tick
      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m1", role: "assistant", streaming: true, text: "Hel" }],
          turnItems: [{ item: { type: "command_execution", status: "completed" } }],
          runs: [],
        },
      });
      expect(harness.performAndroidHapticsAsync).toHaveBeenLastCalledWith("segment-tick");

      // 3. Turn completion -> Confirm
      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m1", role: "assistant", streaming: false, text: "Hello!" }],
          turnItems: [{ item: { type: "command_execution", status: "completed" } }],
          runs: [],
        },
      });
      expect(harness.performAndroidHapticsAsync).toHaveBeenLastCalledWith("confirm");

      // 4. Run failure -> Reject
      registry.set(harness.threadAtom, {
        projection: {
          messages: [{ id: "m1", role: "assistant", streaming: false, text: "Hello!" }],
          turnItems: [{ item: { type: "command_execution", status: "completed" } }],
          runs: [{ id: "run-fail-1", status: "failed" }],
        },
      });
      expect(harness.performAndroidHapticsAsync).toHaveBeenLastCalledWith("reject");
    } finally {
      unmount();
    }
  });
});

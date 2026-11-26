import { Atom, AtomRegistry } from "effect/reactivity";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  appActive: true,
  selectionAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  threadAtom: null as Atom.Writable<unknown, unknown> | null,
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  selectionAsync: harness.selectionAsync,
  impactAsync: harness.impactAsync,
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
  shouldFireStreamCompleteHaptic,
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

describe("threadStreamHaptics foreground gating & completion", () => {
  beforeEach(() => {
    harness.appActive = true;
    harness.selectionAsync.mockClear();
    harness.impactAsync.mockClear();
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
});

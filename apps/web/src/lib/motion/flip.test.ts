import { describe, expect, it, vi } from "vite-plus/test";

import {
  cancelFlip,
  captureFlipSnapshot,
  captureFlipSnapshots,
  playFlip,
  playFlipBatch,
  type FlipRect,
} from "./flip";
import { useSharedIndicator } from "./useSharedIndicator";

function makeMockElement(rect: FlipRect) {
  let currentRect = rect;
  const animations: Array<{
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    playState: AnimationPlayState;
    currentTime: number;
    cancel: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
  }> = [];

  const element = {
    ownerDocument: {
      defaultView: {
        matchMedia: () => ({ matches: false }),
        getComputedStyle: () => ({ transform: "none" }),
      },
    },
    getBoundingClientRect: () => ({
      ...currentRect,
      right: currentRect.left + currentRect.width,
      bottom: currentRect.top + currentRect.height,
      x: currentRect.left,
      y: currentRect.top,
      toJSON: () => currentRect,
    }),
    animate: vi.fn((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const anim = {
        keyframes,
        options,
        playState: "running" as AnimationPlayState,
        currentTime: 40,
        cancel: vi.fn(() => {
          anim.playState = "idle";
        }),
        addEventListener: vi.fn(),
      };
      animations.push(anim);
      return anim as unknown as Animation;
    }),
    setRect(next: FlipRect) {
      currentRect = next;
    },
    animations,
  };

  return element as unknown as HTMLElement & {
    setRect: (next: FlipRect) => void;
    animations: typeof animations;
  };
}

describe("interruptible WAAPI FLIP coordinator", () => {
  it("batches reads before writes and plays linear pre-sampled spring keyframes", () => {
    const elA = makeMockElement({ left: 0, top: 0, width: 100, height: 40 });
    const elB = makeMockElement({ left: 0, top: 60, width: 100, height: 40 });

    const before = captureFlipSnapshots([elA, elB]);
    expect(before.get(elA)).toEqual({ left: 0, top: 0, width: 100, height: 40 });

    elA.setRect({ left: 120, top: 20, width: 140, height: 40 });
    elB.setRect({ left: 0, top: 100, width: 100, height: 40 });

    const started = playFlipBatch([
      { element: elA, first: before.get(elA)!, options: { scale: true } },
      { element: elB, first: before.get(elB)! },
    ]);

    expect(started.size).toBe(2);
    expect(elA.animations[0]?.options.easing).toBe("linear");
    expect(elA.animations[0]?.keyframes.length).toBeGreaterThan(8);
    expect(String(elA.animations[0]?.keyframes[0]?.transform)).toContain("translate3d(-120.00px");
    expect(String(elA.animations[0]?.keyframes.at(-1)?.transform)).toContain("translate3d(0.00px");

    cancelFlip(elA);
    expect(elA.animations[0]?.cancel).toHaveBeenCalledOnce();
  });

  it("cancels in-flight animation and applies inverse child scaling when interrupting", () => {
    const parent = makeMockElement({ left: 10, top: 10, width: 80, height: 32 });
    const child = makeMockElement({ left: 10, top: 10, width: 80, height: 32 });
    const first = captureFlipSnapshot(parent);

    parent.setRect({ left: 110, top: 10, width: 160, height: 32 });
    const firstAnim = playFlip(parent, first, {
      scale: true,
      inverseScaleChildren: [child],
    });
    expect(firstAnim).not.toBeNull();
    expect(child.animations).toHaveLength(1);
    expect(String(child.animations[0]?.keyframes[0]?.transform)).toContain("scale(2.0000");

    // Interrupt mid-flight to a new position
    parent.setRect({ left: 20, top: 10, width: 120, height: 32 });
    const secondAnim = playFlip(parent, { left: 110, top: 10, width: 160, height: 32 });
    expect(secondAnim).not.toBeNull();
    expect(parent.animations[0]?.cancel).toHaveBeenCalledOnce();
    expect(child.animations[0]?.cancel).toHaveBeenCalledOnce();
  });

  it("exports useSharedIndicator hook", () => {
    expect(typeof useSharedIndicator).toBe("function");
  });
});

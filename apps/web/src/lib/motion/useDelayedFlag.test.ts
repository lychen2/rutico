import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDelayedFlagController } from "./useDelayedFlag";

describe("createDelayedFlagController (useDelayedFlag anti-flicker gate)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses sub-300ms loading flashes completely", () => {
    const observed: boolean[] = [];
    const controller = createDelayedFlagController((visible) => observed.push(visible), {
      delayMs: 300,
      minHoldMs: 500,
    });

    controller.setActive(true);
    vi.advanceTimersByTime(250);
    expect(controller.getVisible()).toBe(false);

    controller.setActive(false);
    vi.advanceTimersByTime(600);
    expect(controller.getVisible()).toBe(false);
    expect(observed).toEqual([]);
    controller.dispose();
  });

  it("shows after delayMs and holds visible for at least minHoldMs", () => {
    const observed: boolean[] = [];
    const controller = createDelayedFlagController((visible) => observed.push(visible), {
      delayMs: 300,
      minHoldMs: 500,
    });

    controller.setActive(true);
    vi.advanceTimersByTime(299);
    expect(controller.getVisible()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(controller.getVisible()).toBe(true);

    // Stop 100ms after showing -> must hold 400ms more.
    vi.advanceTimersByTime(100);
    controller.setActive(false);
    expect(controller.getVisible()).toBe(true);

    vi.advanceTimersByTime(399);
    expect(controller.getVisible()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(controller.getVisible()).toBe(false);
    expect(observed).toEqual([true, false]);
    controller.dispose();
  });

  it("stays visible seamlessly when reactivated during the minimum hold window", () => {
    const observed: boolean[] = [];
    const controller = createDelayedFlagController((visible) => observed.push(visible), {
      delayMs: 300,
      minHoldMs: 500,
    });

    controller.setActive(true);
    vi.advanceTimersByTime(350);
    expect(controller.getVisible()).toBe(true);

    controller.setActive(false);
    vi.advanceTimersByTime(200);
    controller.setActive(true);
    vi.advanceTimersByTime(600);
    expect(controller.getVisible()).toBe(true);
    expect(observed).toEqual([true]);
    controller.dispose();
  });

  it("cancels pending timers cleanly on dispose", () => {
    const observed: boolean[] = [];
    const controller = createDelayedFlagController((visible) => observed.push(visible), {
      delayMs: 300,
      minHoldMs: 500,
    });

    controller.setActive(true);
    vi.advanceTimersByTime(150);
    controller.dispose();
    vi.advanceTimersByTime(500);
    expect(controller.getVisible()).toBe(false);
    expect(observed).toEqual([]);
  });
});

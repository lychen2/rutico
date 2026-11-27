import { describe, expect, it, vi } from "vite-plus/test";

import {
  getRecentThemeTransitionOrigin,
  recordThemeTransitionOrigin,
  runSpatialRouteTransition,
  runThemeViewTransition,
} from "./themeTransition";

function createMockDocument(options?: {
  supportsViewTransition?: boolean;
  visibilityState?: DocumentVisibilityState;
  backgroundColor?: string;
  reducedMotion?: boolean;
}) {
  const classes = new Set<string>();
  const dataset: Record<string, string | undefined> = {};
  const properties = new Map<string, string>();
  const animate = vi.fn();
  const skipTransition = vi.fn();

  const root = {
    dataset,
    offsetHeight: 800,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      has: (name: string) => classes.has(name),
    },
    style: {
      setProperty: (k: string, v: string) => properties.set(k, v),
      removeProperty: (k: string) => properties.delete(k),
    },
    animate,
  };

  let resolveReady: (() => void) | undefined;
  let resolveFinished: (() => void) | undefined;
  const startViewTransition = options?.supportsViewTransition
    ? vi.fn((cb: () => void) => {
        cb();
        return {
          ready: new Promise<void>((resolve) => {
            resolveReady = resolve;
          }),
          finished: new Promise<void>((resolve) => {
            resolveFinished = resolve;
          }),
          skipTransition,
        };
      })
    : undefined;

  const doc = {
    documentElement: root,
    visibilityState: options?.visibilityState ?? "visible",
    ...(startViewTransition ? { startViewTransition } : {}),
  } as unknown as Document;

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: () => ({ matches: options?.reducedMotion ?? false }),
    getComputedStyle: () => ({ backgroundColor: options?.backgroundColor ?? "rgb(20, 20, 20)" }),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    },
  } as unknown as Window;

  return {
    doc,
    win,
    classes,
    dataset,
    properties,
    animate,
    skipTransition,
    startViewTransition,
    flushReady: async () => {
      resolveReady?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    flushFinished: async () => {
      resolveFinished?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("themeTransition View Transition iris ripple", () => {
  it("commits synchronously when startViewTransition is unsupported, hidden, transparent, or reduced-motion", () => {
    for (const opts of [
      { supportsViewTransition: false },
      { supportsViewTransition: true, visibilityState: "hidden" as const },
      { supportsViewTransition: true, backgroundColor: "rgba(0, 0, 0, 0)" },
      { supportsViewTransition: true, reducedMotion: true },
    ]) {
      const mock = createMockDocument(opts);
      const commit = vi.fn();
      const animated = runThemeViewTransition(commit, { doc: mock.doc, win: mock.win });
      expect(animated).toBe(false);
      expect(commit).toHaveBeenCalledOnce();
      expect(mock.classes.has("no-transitions")).toBe(false);
    }
  });

  it("animates iris clipPath from pointer origin with expanded linear() easing and skips previous on rapid clicks", async () => {
    const mock = createMockDocument({ supportsViewTransition: true });
    recordThemeTransitionOrigin(240, 120, 1000);
    expect(getRecentThemeTransitionOrigin(1200)).toEqual({ x: 240, y: 120 });
    expect(getRecentThemeTransitionOrigin(2000)).toBeNull();

    const commitFirst = vi.fn();
    const animatedFirst = runThemeViewTransition(commitFirst, {
      doc: mock.doc,
      win: mock.win,
      origin: { x: 100, y: 80 },
    });
    expect(animatedFirst).toBe(true);
    expect(commitFirst).toHaveBeenCalledOnce();
    expect(mock.dataset.themeTransition).toBe("iris");

    await mock.flushReady();
    expect(mock.animate).toHaveBeenCalledOnce();
    const [, timing] = mock.animate.mock.calls[0]!;
    expect(timing.pseudoElement).toBe("::view-transition-new(root)");
    expect(String(timing.easing).startsWith("linear(0,")).toBe(true);
    expect(String(timing.easing).includes("var(")).toBe(false);

    // Rapid second click skips the in-flight transition cleanly without throwing.
    const commitSecond = vi.fn();
    runThemeViewTransition(commitSecond, {
      doc: mock.doc,
      win: mock.win,
      origin: { x: 640, y: 400 },
    });
    expect(mock.skipTransition).toHaveBeenCalledOnce();
    expect(commitSecond).toHaveBeenCalledOnce();

    await mock.flushFinished();
    expect(mock.dataset.themeTransition).toBeUndefined();
    expect(mock.classes.has("no-transitions")).toBe(false);
  });
});

describe("runSpatialRouteTransition", () => {
  it("propagates commitRoute rejections when motion is enabled and when reduced motion is active", async () => {
    const routeFailure = new Error("route navigation failed");

    // Motion enabled: View Transition callback rejects and transition.finished also rejects.
    const animatedMock = createMockDocument({ supportsViewTransition: true, reducedMotion: false });
    (
      animatedMock.doc as unknown as {
        startViewTransition: (cb: () => void | Promise<void>) => {
          ready: Promise<void>;
          finished: Promise<void>;
          skipTransition: () => void;
        };
      }
    ).startViewTransition = vi.fn((cb) => {
      const updateResult = Promise.resolve(cb());
      return {
        ready: updateResult.catch(() => {}),
        finished: updateResult,
        skipTransition: animatedMock.skipTransition,
      };
    });

    await expect(
      runSpatialRouteTransition(
        async () => {
          throw routeFailure;
        },
        { doc: animatedMock.doc, win: animatedMock.win },
      ),
    ).rejects.toBe(routeFailure);
    expect(animatedMock.dataset.spatialRouteTransition).toBeUndefined();

    // Motion disabled: reduced motion takes the direct commitRoute path and rejects identically.
    const reducedMock = createMockDocument({ supportsViewTransition: true, reducedMotion: true });
    await expect(
      runSpatialRouteTransition(
        async () => {
          throw routeFailure;
        },
        { doc: reducedMock.doc, win: reducedMock.win },
      ),
    ).rejects.toBe(routeFailure);
    expect(reducedMock.dataset.spatialRouteTransition).toBeUndefined();
  });

  it("still resolves when only the visual View Transition is skipped after commitRoute succeeds", async () => {
    const mock = createMockDocument({ supportsViewTransition: true, reducedMotion: false });
    const commitRoute = vi.fn(async () => {});
    (
      mock.doc as unknown as {
        startViewTransition: (cb: () => void | Promise<void>) => {
          ready: Promise<void>;
          finished: Promise<void>;
          skipTransition: () => void;
        };
      }
    ).startViewTransition = vi.fn((cb) => {
      const updateResult = Promise.resolve(cb());
      return {
        ready: Promise.reject(new DOMException("Transition skipped", "AbortError")).catch(() => {}),
        finished: updateResult.then(() =>
          Promise.reject(new DOMException("Transition skipped", "AbortError")),
        ),
        skipTransition: mock.skipTransition,
      };
    });

    await expect(
      runSpatialRouteTransition(commitRoute, { doc: mock.doc, win: mock.win }),
    ).resolves.toBe(true);
    expect(commitRoute).toHaveBeenCalledOnce();
    expect(mock.dataset.spatialRouteTransition).toBeUndefined();
  });
});

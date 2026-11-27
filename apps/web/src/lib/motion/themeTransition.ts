/**
 * Origin-expanding View Transition iris ripple for theme switching; commits
 * synchronously on unsupported browsers, hidden tabs, transparent roots, or reduced motion.
 */

import { getSpringWaapiTiming, prefersReducedMotion } from "./springs";

export interface ThemeTransitionOrigin {
  readonly x: number;
  readonly y: number;
}

interface ViewTransitionLike {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition?: () => void;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (updateCallback: () => void | Promise<void>) => ViewTransitionLike;
};

const POINTER_ORIGIN_TTL_MS = 500;
const IRIS_DURATION_MS = 420;

let lastPointerOrigin: {
  readonly x: number;
  readonly y: number;
  readonly timestampMs: number;
} | null = null;
let pointerTrackerAttached = false;
let activeTransition: ViewTransitionLike | null = null;

function ensurePointerOriginTracker(): void {
  if (pointerTrackerAttached || typeof window === "undefined") return;
  pointerTrackerAttached = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      lastPointerOrigin = {
        x: event.clientX,
        y: event.clientY,
        timestampMs: Date.now(),
      };
    },
    { capture: true, passive: true },
  );
}

/** Explicit hook for tests or non-pointer callers to seed the next transition origin. */
export function recordThemeTransitionOrigin(x: number, y: number, timestampMs = Date.now()): void {
  lastPointerOrigin = { x, y, timestampMs };
}

export function getRecentThemeTransitionOrigin(nowMs = Date.now()): ThemeTransitionOrigin | null {
  if (!lastPointerOrigin) return null;
  if (nowMs - lastPointerOrigin.timestampMs > POINTER_ORIGIN_TTL_MS) return null;
  return { x: lastPointerOrigin.x, y: lastPointerOrigin.y };
}

function isTransparentColor(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0 0 0 / 0)"
  );
}

function commitWithNoTransitions(doc: Document, win: Window, commitTheme: () => void): void {
  const root = doc.documentElement;
  root.classList.add("no-transitions");
  commitTheme();
  // Force style flush so `.no-transitions` applies to the committed theme frame.
  void root.offsetHeight;
  if (typeof win.requestAnimationFrame === "function") {
    win.requestAnimationFrame(() => {
      root.classList.remove("no-transitions");
    });
  } else {
    root.classList.remove("no-transitions");
  }
}

export function runThemeViewTransition(
  commitTheme: () => void,
  options?: {
    readonly origin?: ThemeTransitionOrigin;
    readonly forceImmediate?: boolean;
    readonly doc?: DocumentWithViewTransition;
    readonly win?: Window;
  },
): boolean {
  const doc = (options?.doc ??
    (typeof document === "undefined" ? undefined : (document as DocumentWithViewTransition))) as
    | DocumentWithViewTransition
    | undefined;
  const win = options?.win ?? (typeof window === "undefined" ? undefined : window);
  if (!doc || !win) {
    commitTheme();
    return false;
  }

  ensurePointerOriginTracker();

  const root = doc.documentElement;
  const canAnimate =
    !options?.forceImmediate &&
    typeof doc.startViewTransition === "function" &&
    doc.visibilityState !== "hidden" &&
    !prefersReducedMotion(win) &&
    root.dataset.mobileComposerRouteTransition !== "true";

  if (!canAnimate) {
    commitWithNoTransitions(doc, win, commitTheme);
    return false;
  }

  const rootBg =
    typeof win.getComputedStyle === "function"
      ? win.getComputedStyle(root).backgroundColor
      : "rgb(0, 0, 0)";
  if (isTransparentColor(rootBg)) {
    commitWithNoTransitions(doc, win, commitTheme);
    return false;
  }

  // Cancel any in-flight theme ripple cleanly on rapid repeated toggles.
  if (activeTransition) {
    try {
      activeTransition.skipTransition?.();
    } catch {
      // Ignore already-settled transitions.
    }
    activeTransition = null;
  }

  const origin = options?.origin ??
    getRecentThemeTransitionOrigin() ?? {
      x: win.innerWidth / 2,
      y: win.innerHeight / 2,
    };
  const maxRadius = Math.hypot(
    Math.max(origin.x, win.innerWidth - origin.x),
    Math.max(origin.y, win.innerHeight - origin.y),
  );

  root.dataset.themeTransition = "iris";
  root.style.setProperty("--theme-transition-x", `${origin.x.toFixed(1)}px`);
  root.style.setProperty("--theme-transition-y", `${origin.y.toFixed(1)}px`);
  root.style.setProperty("--theme-transition-radius", `${Math.ceil(maxRadius)}px`);

  let transition: ViewTransitionLike;
  try {
    transition = doc.startViewTransition!(() => {
      root.classList.add("no-transitions");
      commitTheme();
      void root.offsetHeight;
    });
  } catch {
    delete root.dataset.themeTransition;
    commitWithNoTransitions(doc, win, commitTheme);
    return false;
  }

  activeTransition = transition;
  const springTiming = getSpringWaapiTiming("spatial");

  void transition.ready
    .then(() => {
      if (activeTransition !== transition || typeof root.animate !== "function") return;
      root.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x.toFixed(1)}px ${origin.y.toFixed(1)}px)`,
            `circle(${Math.ceil(maxRadius)}px at ${origin.x.toFixed(1)}px ${origin.y.toFixed(1)}px)`,
          ],
        },
        {
          duration: IRIS_DURATION_MS,
          easing: springTiming.easing,
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // Skipped or aborted transitions are expected on rapid clicks.
    });

  void transition.finished
    .catch(() => {})
    .finally(() => {
      root.classList.remove("no-transitions");
      if (activeTransition === transition) {
        activeTransition = null;
        delete root.dataset.themeTransition;
      }
    });

  return true;
}

/**
 * Single-document spatial View Transition for major shell handoffs (e.g. /welcome → workspace);
 * guards unsupported browsers, hidden tabs, transparent roots, re-entrancy, and reduced motion.
 */
export async function runSpatialRouteTransition(
  commitRoute: () => void | Promise<void>,
  options?: {
    readonly transitionName?: string;
    readonly doc?: DocumentWithViewTransition;
    readonly win?: Window;
  },
): Promise<boolean> {
  const doc = (options?.doc ??
    (typeof document === "undefined" ? undefined : (document as DocumentWithViewTransition))) as
    | DocumentWithViewTransition
    | undefined;
  const win = options?.win ?? (typeof window === "undefined" ? undefined : window);
  if (!doc || !win) {
    await commitRoute();
    return false;
  }

  const root = doc.documentElement;
  const canAnimate =
    typeof doc.startViewTransition === "function" &&
    doc.visibilityState !== "hidden" &&
    !prefersReducedMotion(win) &&
    root.dataset.mobileComposerRouteTransition !== "true";

  if (!canAnimate) {
    await commitRoute();
    return false;
  }

  const rootBg =
    typeof win.getComputedStyle === "function"
      ? win.getComputedStyle(root).backgroundColor
      : "rgb(0, 0, 0)";
  if (isTransparentColor(rootBg)) {
    await commitRoute();
    return false;
  }

  if (activeTransition) {
    try {
      activeTransition.skipTransition?.();
    } catch {
      // Ignore already-settled transitions.
    }
    activeTransition = null;
  }

  const transitionName = options?.transitionName ?? "welcome-to-workspace";
  root.dataset.spatialRouteTransition = transitionName;

  let commitSettled: Promise<void> | null = null;
  let commitError: { readonly value: unknown } | null = null;
  let transition: ViewTransitionLike;
  try {
    transition = doc.startViewTransition!(() => {
      const callbackPromise = Promise.resolve().then(() => commitRoute());
      commitSettled = callbackPromise.catch((error) => {
        commitError = { value: error };
      });
      return callbackPromise;
    });
  } catch {
    delete root.dataset.spatialRouteTransition;
    if (commitSettled === null) {
      await commitRoute();
    } else {
      await commitSettled;
      if (commitError !== null) {
        throw (commitError as { readonly value: unknown }).value;
      }
    }
    return false;
  }

  activeTransition = transition;
  try {
    await transition.finished;
  } catch {
    // Skipped or aborted visual transitions are expected if the user navigates again immediately.
  } finally {
    if (activeTransition === transition) {
      activeTransition = null;
      delete root.dataset.spatialRouteTransition;
    }
  }
  if (commitSettled !== null) {
    await commitSettled;
  }
  if (commitError !== null) {
    throw (commitError as { readonly value: unknown }).value;
  }
  return true;
}

if (typeof window !== "undefined") {
  ensurePointerOriginTracker();
}

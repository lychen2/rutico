import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";

export const SIDEBAR_REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const sidebarWorkbenchEase = "cubic-bezier(.2,.8,.2,1)";

const SIDEBAR_RIPPLE_AMPLITUDE_PX = 3.5;
const SIDEBAR_RIPPLE_DECAY = 0.7;
const SIDEBAR_RIPPLE_STAGGER_MS = 24;
const SIDEBAR_RIPPLE_MAX_DISTANCE = 4;

/**
 * Tip 005 damped spring neighbor ripple (`A * 0.7^n`, `24ms * n` stagger)
 * fired when a dragged thread crosses into a neighboring row boundary.
 */
export function triggerSidebarDragRipple(
  list: HTMLElement,
  overThreadKey: string | null,
  direction: 1 | -1 = 1,
): number {
  if (!overThreadKey) return 0;
  const win = list.ownerDocument.defaultView ?? globalThis.window;
  if (prefersReducedMotion(win)) return 0;

  const rows = Array.from(list.children).filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.hasAttribute("data-thread-item"),
  );
  const centerIndex = rows.findIndex(
    (node) => node.getAttribute("data-thread-item") === overThreadKey,
  );
  if (centerIndex === -1) return 0;

  const timing = getSpringWaapiTiming("snappy");
  let rippledCount = 0;

  for (let distance = 1; distance <= SIDEBAR_RIPPLE_MAX_DISTANCE; distance += 1) {
    const amplitude = SIDEBAR_RIPPLE_AMPLITUDE_PX * Math.pow(SIDEBAR_RIPPLE_DECAY, distance);
    const delay = distance * SIDEBAR_RIPPLE_STAGGER_MS;
    const candidates = [
      { index: centerIndex - distance, sign: -direction },
      { index: centerIndex + distance, sign: direction },
    ];
    for (const candidate of candidates) {
      const neighbor = rows[candidate.index];
      if (!neighbor || typeof neighbor.animate !== "function") continue;
      const offsetPx = Number((candidate.sign * amplitude).toFixed(2));
      neighbor.animate(
        [
          { transform: "translate3d(0, 0, 0)" },
          { transform: `translate3d(0, ${offsetPx}px, 0)`, offset: 0.36 },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: Math.max(220, timing.duration),
          delay,
          easing: timing.easing,
          composite: "add",
        },
      );
      rippledCount += 1;
    }
  }

  return rippledCount;
}

const motionTiming = { duration: 150, easing: sidebarWorkbenchEase };
const attentionExitTiming = { duration: 350, easing: sidebarWorkbenchEase };
const EXIT_ROW = "data-sidebar-motion-exit";
const ROW_KEY = "data-sidebar-motion-key";
const rowTravel = (height: number) => Math.min(height, 40);
// Fades clone removed rows and animate clones and entries; intervening layout reads force reflows.
const MAX_FADED_ROWS_PER_UPDATE = 40;

type RowPosition = { top: number; left: number; width: number; height: number };

function progress(animation: Animation) {
  return animation.playState === "finished"
    ? 1
    : (animation.effect?.getComputedTiming().progress ?? 0);
}

/** Position the list so all direct children's offsetTop share an origin. */
export function createSidebarListMotion(parent: HTMLElement, attentionExit = false) {
  let positions: Map<HTMLElement, RowPosition> | null = null;
  let disposed = false;
  const reducedMotion = parent.ownerDocument.defaultView?.matchMedia(SIDEBAR_REDUCED_MOTION);
  const running = new Map<HTMLElement, { animation: Animation; offset: number }>();
  const entering = new Map<HTMLElement, { animation: Animation; travel: number }>();
  const exiting = new Map<HTMLElement, Animation>();
  let released: Map<HTMLElement, number> | null = null;
  const scroller = parent.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
  let scrollTop = scroller?.scrollTop ?? 0;
  const trackScroll = () => {
    scrollTop = scroller?.scrollTop ?? 0;
  };
  scroller?.addEventListener("scroll", trackScroll, { passive: true });

  const remainingOffset = (node: HTMLElement) => {
    const current = running.get(node);
    const run = current ? current.offset * (1 - progress(current.animation)) : 0;
    const entry = entering.get(node);
    const enter = entry ? entry.travel * (1 - progress(entry.animation)) : 0;
    return run + enter;
  };
  const clearFades = () => {
    for (const entry of entering.values()) entry.animation.cancel();
    for (const animation of exiting.values()) animation.cancel();
    for (const node of exiting.keys()) node.remove();
    entering.clear();
    exiting.clear();
  };
  const fadeOut = (node: HTMLElement, position: RowPosition, travel: number, shift: number) => {
    if (position.height === 0) return;
    const clone = node.cloneNode(true) as HTMLElement;
    for (const exitingChild of clone.querySelectorAll(`[${EXIT_ROW}]`)) exitingChild.remove();
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (
          (attribute.name === "id" && element.namespaceURI !== "http://www.w3.org/2000/svg") ||
          attribute.name === "data-thread-item" ||
          attribute.name === "data-thread-selection-safe" ||
          attribute.name === "data-sidebar-row" ||
          attribute.name === "data-testid"
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute(
      EXIT_ROW,
      node.getAttribute(ROW_KEY) ?? node.getAttribute("data-thread-item") ?? "",
    );
    clone.inert = true;
    Object.assign(clone.style, {
      position: "absolute",
      top: `${position.top + remainingOffset(node) + shift}px`,
      left: `${position.left}px`,
      width: `${position.width}px`,
      height: `${position.height}px`,
      margin: "0",
      boxSizing: "border-box",
      contentVisibility: "visible",
      transform: "none",
      transition: "none",
      pointerEvents: "none",
    });
    parent.append(clone);
    const entry = entering.get(node);
    const entryProgress = entry ? progress(entry.animation) : 1;
    const animation = clone.animate(
      [
        {
          opacity: entryProgress,
          transform: attentionExit ? "translate(0, 0)" : "translate(0, 0) scale(1)",
        },
        {
          opacity: 0,
          transform: attentionExit
            ? `translateX(${parent.matches(":dir(rtl)") ? 16 : -16}px)`
            : `translateY(${travel}px) scale(0.985)`,
        },
      ],
      attentionExit ? attentionExitTiming : motionTiming,
    );
    exiting.set(clone, animation);
    animation.addEventListener(
      "finish",
      () => {
        clone.remove();
        exiting.delete(clone);
      },
      { once: true },
    );
  };

  const cancel = (node: HTMLElement) => {
    running.get(node)?.animation.cancel();
    running.delete(node);
  };
  const suspend = () => {
    for (const node of running.keys()) cancel(node);
    clearFades();
    positions = null;
    released = null;
  };
  reducedMotion?.addEventListener("change", suspend);
  const move = (node: HTMLElement, offset: number) => {
    cancel(node);
    const entry = entering.get(node);
    if (entry) entry.travel = 0;
    if (offset === 0 && !entry) return;
    const animation = node.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
      motionTiming,
    );
    running.set(node, { animation, offset });
    animation.addEventListener(
      "finish",
      () => {
        if (running.get(node)?.animation === animation) running.delete(node);
      },
      { once: true },
    );
  };

  return {
    update(animate: boolean) {
      if (disposed) return;
      // A hidden list (the closed narrow sheet stays mounted) reports zero
      // offsets, which would make the first pass after it opens animate every row.
      if (reducedMotion?.matches || parent.getClientRects().length === 0) {
        suspend();
        return;
      }
      const next = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
          .map((node) => [
            node,
            {
              top: node.offsetTop,
              left: node.offsetLeft,
              width: node.offsetWidth,
              height: node.offsetHeight,
            },
          ]),
      );
      let fadeCount = 0;
      if (positions !== null) {
        for (const [node, position] of positions) {
          if (!next.has(node) && position.height > 0) fadeCount++;
        }
        for (const [node, position] of next) {
          if (!positions.has(node) && position.height > 0) fadeCount++;
        }
      }
      const shouldAnimate =
        animate &&
        positions !== null &&
        !reducedMotion?.matches &&
        fadeCount <= MAX_FADED_ROWS_PER_UPDATE;
      // A removal near the bottom shrinks the list and the browser clamps scrollTop, moving
      // every row on screen; offsets include that shift so those rows slide instead of jump.
      let shift = 0;
      if (scroller !== null) {
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (scrollTop > max && scroller.scrollTop >= max - 1)
          shift = scroller.scrollTop - scrollTop;
      }
      const movedDelta = new Map<HTMLElement, number>();
      const nextOrder = [...next.keys()];
      const oldOrder = positions === null ? [] : [...positions.keys()];
      const ridingDelta = (
        order: readonly HTMLElement[],
        index: number,
        retained: (node: HTMLElement) => boolean,
      ) => {
        for (let cursor = index - 1; cursor >= 0; cursor--) {
          const node = order[cursor]!;
          const delta = movedDelta.get(node);
          if (delta !== undefined) return delta;
          if (retained(node)) return remainingOffset(node);
        }
        return undefined;
      };
      if (!shouldAnimate) clearFades();
      else {
        for (const [node, position] of next) {
          const previousTop = positions!.get(node)?.top;
          // Discard a previous ghost before a rapid reversal paints its live replacement.
          if (previousTop === undefined && exiting.size > 0) {
            const key = node.getAttribute(ROW_KEY) ?? node.getAttribute("data-thread-item");
            if (key !== null) {
              for (const [ghost, animation] of exiting) {
                if (ghost.getAttribute(EXIT_ROW) !== key) continue;
                animation.cancel();
                ghost.remove();
                exiting.delete(ghost);
              }
            }
          }
          if (previousTop === undefined || previousTop + shift === position.top) continue;
          movedDelta.set(node, previousTop + remainingOffset(node) - position.top + shift);
        }
        for (const [node, position] of positions!) {
          if (next.has(node)) continue;
          const delta = ridingDelta(oldOrder, oldOrder.indexOf(node), (n) => next.has(n));
          fadeOut(node, position, delta === undefined ? rowTravel(position.height) : -delta, shift);
        }
      }
      for (const [node, entry] of entering) {
        if (!next.has(node)) {
          entry.animation.cancel();
          entering.delete(node);
        }
      }
      for (const node of running.keys()) {
        if (!shouldAnimate || !next.has(node)) cancel(node);
      }
      if (shouldAnimate) {
        for (const [index, node] of nextOrder.entries()) {
          const position = next.get(node)!;
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined) {
            if (position.height > 0) {
              const delta = ridingDelta(nextOrder, index, (n) => positions!.has(n));
              const travel = delta === undefined ? -rowTravel(position.height) : delta;
              const animation = node.animate(
                [
                  { opacity: 0, transform: `translateY(${travel}px)` },
                  { opacity: 1, transform: "translateY(0px)" },
                ],
                motionTiming,
              );
              entering.set(node, { animation, travel });
              animation.addEventListener(
                "finish",
                () => {
                  if (entering.get(node)?.animation === animation) entering.delete(node);
                },
                { once: true },
              );
            }
            continue;
          }
          const delta = movedDelta.get(node);
          // Computed progress includes easing; carry forward only our translation, never dnd-kit's
          // transforms.
          if (delta !== undefined) move(node, delta);
        }
      }
      if (released !== null) {
        if (!reducedMotion?.matches) {
          for (const [node, position] of next) {
            const top = released.get(node);
            if (top !== undefined) move(node, top - position.top);
          }
        }
        released = null;
      }
      positions = next;
      if (scroller !== null) scrollTop = scroller.scrollTop;
    },
    release() {
      suspend();
      if (reducedMotion?.matches) return;
      const origin = parent.getBoundingClientRect().top;
      released = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
          .map((node) => [node, node.getBoundingClientRect().top - origin]),
      );
    },
    suspend,
    dispose() {
      reducedMotion?.removeEventListener("change", suspend);
      suspend();
      scroller?.removeEventListener("scroll", trackScroll);
      disposed = true;
    },
  };
}

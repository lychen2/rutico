import { useEffect, type RefObject } from "react";

import { REDUCED_MOTION_QUERY } from "./springs";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * Tracks fine-pointer coordinates relative to a single surface element and writes
 * `--specular-x` / `--specular-y` in an rAF-coalesced pass (zero React re-renders,
 * zero ancestor CSS variable broadcasts, automatic no-op on touch & reduced motion).
 */
export function useSpecularPointer(ref: RefObject<HTMLElement | null>): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds rAF-throttled pointer listeners directly to the target DOM surface
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const win = element.ownerDocument.defaultView ?? globalThis.window;
    if (!win || typeof win.matchMedia !== "function") return;

    const finePointer = win.matchMedia(FINE_POINTER_QUERY);
    const reducedMotion = win.matchMedia(REDUCED_MOTION_QUERY);

    let rafId: number | null = null;
    let pendingX = 0;
    let pendingY = 0;
    let active = false;

    const flush = () => {
      rafId = null;
      if (!active) return;
      element.style.setProperty("--specular-x", `${pendingX.toFixed(1)}px`);
      element.style.setProperty("--specular-y", `${pendingY.toFixed(1)}px`);
    };

    const clear = () => {
      active = false;
      if (rafId !== null) {
        win.cancelAnimationFrame(rafId);
        rafId = null;
      }
      element.removeAttribute("data-specular-active");
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !finePointer.matches || reducedMotion.matches) {
        if (active) clear();
        return;
      }
      const rect = element.getBoundingClientRect();
      pendingX = event.clientX - rect.left;
      pendingY = event.clientY - rect.top;
      if (!active) {
        active = true;
        element.setAttribute("data-specular-active", "true");
      }
      if (rafId === null) {
        rafId = win.requestAnimationFrame(flush);
      }
    };

    const onMediaChange = () => {
      if (!finePointer.matches || reducedMotion.matches) clear();
    };

    element.addEventListener("pointermove", onPointerMove, { passive: true });
    element.addEventListener("pointerleave", clear, { passive: true });
    finePointer.addEventListener("change", onMediaChange);
    reducedMotion.addEventListener("change", onMediaChange);

    return () => {
      clear();
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerleave", clear);
      finePointer.removeEventListener("change", onMediaChange);
      reducedMotion.removeEventListener("change", onMediaChange);
    };
  }, [ref]);
}

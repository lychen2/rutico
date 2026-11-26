import { useEffect, type CSSProperties, type PointerEvent, type RefObject } from "react";

import { prefersReducedMotion } from "~/lib/motion/springs";
import { observeResize } from "~/lib/observeResize";

export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
  button[data-type='item'], button[data-type='item']::before {
    border-radius: var(--radius-md);
    transition: background-color 120ms ease-out, color 120ms ease-out;
  }
  button[data-type='item'] [data-item-section='chevron'] svg,
  button[data-type='item'] svg[data-icon-name*='chevron'] {
    transition: transform 160ms var(--spring-snappy, cubic-bezier(0.23, 1, 0.32, 1));
  }
  [data-item-section='indent'],
  [data-indent-guide] {
    transition: opacity 150ms ease-out, border-color 150ms ease-out;
  }
  button[data-type='item']:hover [data-item-section='indent'],
  button[data-type='item'][aria-expanded='true'] [data-item-section='indent'] {
    opacity: 0.92;
  }
  svg[data-icon-name='t3-tree-icon-loading'] { opacity: 0.6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='t3-tree-icon-loading'] { animation: t3-tree-spin 1s linear infinite; }
    button[data-type='item'] {
      transition: background-color 120ms ease-out, color 120ms ease-out, opacity 140ms ease-out;
    }
    @starting-style {
      button[data-type='item'] { opacity: 0.35; }
    }
  }
  @media (prefers-reduced-motion: reduce) {
    button[data-type='item'],
    button[data-type='item']::before,
    button[data-type='item'] [data-item-section='chevron'] svg,
    button[data-type='item'] svg[data-icon-name*='chevron'] {
      transition: none;
    }
  }
  @keyframes t3-tree-spin { to { transform: rotate(360deg); } }
`;

export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
    ["--trees-fg-muted-override" as string]: "var(--contrast-muted-foreground)",
    ["--trees-status-ignored-override" as string]: "var(--contrast-muted-foreground)",
  };
}

function findTreeShadowRoot(container: HTMLElement): ShadowRoot | null {
  const directHost = container.querySelector<HTMLElement>("file-tree, [data-file-tree-root]");
  if (directHost?.shadowRoot) return directHost.shadowRoot;
  for (const child of container.querySelectorAll<HTMLElement>("*")) {
    if (child.shadowRoot) return child.shadowRoot;
  }
  return null;
}

function findScrollableElement(shadowRoot: ShadowRoot): HTMLElement | null {
  const candidates = shadowRoot.querySelectorAll<HTMLElement>(
    "[data-file-tree-virtualized-scroll], [data-scroll-container], [role='tree'], div",
  );
  for (const node of candidates) {
    if (node.scrollHeight > node.clientHeight + 2 && node.clientHeight > 0) {
      return node;
    }
  }
  return shadowRoot.querySelector<HTMLElement>("[role='tree']") ?? null;
}

/**
 * Synchronizes a single-layer GPU 2px active-file laser rail and Kubai Tip 008
 * dynamic `data-more-above` / `data-more-below` scroll-edge masks with a virtualized
 * `@pierre/trees` Shadow DOM tree without caching virtualized row DOM nodes (Astra P1-4).
 */
export function usePierreTreeRailAndEdgeFade(
  containerRef: RefObject<HTMLDivElement | null>,
  railRef: RefObject<HTMLDivElement | null>,
): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs Shadow DOM virtualized tree selection & scroll edge masks to a GPU laser rail without React re-renders
  useEffect(() => {
    const container = containerRef.current;
    const rail = railRef.current;
    if (!container || !rail) return;

    let shadowRoot: ShadowRoot | null = null;
    let shadowObserver: MutationObserver | null = null;
    let frameId: number | null = null;
    let hasPositioned = false;

    const update = (allowMotion: boolean) => {
      const root = shadowRoot ?? findTreeShadowRoot(container);
      if (!root) {
        rail.style.opacity = "0";
        container.dataset.moreAbove = "false";
        container.dataset.moreBelow = "false";
        return;
      }

      const scroller = findScrollableElement(root);
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 2) {
        container.dataset.moreAbove = scroller.scrollTop > 3 ? "true" : "false";
        container.dataset.moreBelow =
          scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 3 ? "true" : "false";
      } else {
        container.dataset.moreAbove = "false";
        container.dataset.moreBelow = "false";
      }

      // Query live mounted selected item directly inside Shadow DOM (never retain virtual row refs).
      const selected = root.querySelector<HTMLElement>(
        "button[data-type='item'][aria-selected='true'], button[data-type='item'][data-item-selected='true']",
      );
      if (!selected) {
        rail.style.opacity = "0";
        hasPositioned = false;
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const rowRect = selected.getBoundingClientRect();
      const visibleInViewport =
        rowRect.height > 0 &&
        rowRect.bottom > containerRect.top + 1 &&
        rowRect.top < containerRect.bottom - 1;
      if (!visibleInViewport) {
        rail.style.opacity = "0";
        return;
      }

      const inset = 3;
      const y = rowRect.top - containerRect.top + inset;
      const height = Math.max(8, rowRect.height - inset * 2);
      const win = container.ownerDocument.defaultView ?? globalThis.window;
      const instant = !allowMotion || !hasPositioned || prefersReducedMotion(win);

      rail.style.transition = instant
        ? "opacity 100ms ease-out"
        : "transform 170ms var(--spring-snappy), height 170ms var(--spring-snappy), opacity 110ms ease-out";
      rail.style.height = `${height.toFixed(1)}px`;
      rail.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      rail.style.opacity = "1";
      hasPositioned = true;
    };

    const schedule = (allowMotion: boolean) => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        update(allowMotion);
      });
    };

    const handleShadowScroll = () => schedule(false);

    const bindShadow = () => {
      const nextRoot = findTreeShadowRoot(container);
      if (!nextRoot || nextRoot === shadowRoot) return;
      if (shadowRoot) {
        shadowRoot.removeEventListener("scroll", handleShadowScroll, true);
      }
      shadowObserver?.disconnect();
      shadowRoot = nextRoot;
      shadowRoot.addEventListener("scroll", handleShadowScroll, { capture: true, passive: true });
      shadowObserver = new MutationObserver(() => schedule(true));
      shadowObserver.observe(shadowRoot, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["aria-selected", "data-item-selected", "aria-expanded", "style"],
      });
      schedule(false);
    };

    const lightObserver = new MutationObserver(() => {
      bindShadow();
      schedule(false);
    });
    lightObserver.observe(container, { childList: true, subtree: true });

    bindShadow();
    const stopResize = observeResize(container, () => schedule(false));

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      lightObserver.disconnect();
      shadowObserver?.disconnect();
      if (shadowRoot) {
        shadowRoot.removeEventListener("scroll", handleShadowScroll, true);
      }
      stopResize();
    };
  }, [containerRef, railRef]);
}

// Clipped labels are unreadable and the tree cannot scroll sideways, so a clipped row gets its full name as a native tooltip.
export function titleClippedPierreTreeRow(event: PointerEvent<HTMLElement>) {
  const row = event.nativeEvent
    .composedPath()
    .find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.matches("button[data-type='item']"),
    );
  if (!row) return;
  const label = row.getAttribute("aria-label");
  const clipped = Array.from(
    row.querySelectorAll<HTMLElement>("[data-truncate-content='visible']"),
  ).some((element) => element.scrollWidth > element.clientWidth);
  if (label && clipped) row.title = label;
  else row.removeAttribute("title");
}

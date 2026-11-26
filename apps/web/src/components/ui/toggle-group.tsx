import type { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import { prefersReducedMotion } from "~/lib/motion/springs";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { Toggle as ToggleComponent, type toggleVariants } from "~/components/ui/toggle";

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

// Enforced inline so unstyled mounts never intercept clicks or shift segment layout.
const CLIP_LAYER_STYLE: React.CSSProperties = {
  pointerEvents: "none",
  position: "absolute",
  inset: 0,
};

const STRIPPED_MIRROR_ATTRIBUTES = [
  "id",
  "tabindex",
  "role",
  "name",
  "for",
  "aria-controls",
  "aria-labelledby",
  "aria-describedby",
] as const;

const INTERACTIVE_MIRROR_TAGS = new Set(["button", "a", "input", "select", "textarea"]);

/**
 * Mirrors child nodes without duplicating light-DOM text nodes: contiguous
 * non-whitespace text is rendered via `[data-slot="toggle-clip-text"]::after`
 * (`content: attr(data-clip-text)`), preventing duplicate `getByText` /
 * `textContent` / find-in-page matches while preserving pixel-identical clipping.
 */
function appendVisualOnlyNodes(sourceParent: Node, targetParent: Element, doc: Document): void {
  let pendingText = "";

  const flushPendingText = () => {
    if (pendingText.length === 0) return;
    const text = pendingText;
    pendingText = "";
    if (!/\S/.test(text)) {
      targetParent.append(doc.createTextNode(text));
      return;
    }
    const textHost = doc.createElement("span");
    textHost.setAttribute("aria-hidden", "true");
    textHost.dataset.slot = "toggle-clip-text";
    textHost.dataset.clipText = text;
    targetParent.append(textHost);
  };

  for (const child of Array.from(sourceParent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      pendingText += child.nodeValue ?? "";
      continue;
    }
    flushPendingText();
    if (!(child instanceof Element)) continue;

    if (child.namespaceURI === "http://www.w3.org/2000/svg") {
      const clonedSvg = child.cloneNode(true);
      if (!(clonedSvg instanceof Element)) continue;
      for (const meta of clonedSvg.querySelectorAll("title, desc")) {
        meta.remove();
      }
      for (const el of [clonedSvg, ...clonedSvg.querySelectorAll("*")]) {
        for (const attr of STRIPPED_MIRROR_ATTRIBUTES) {
          el.removeAttribute(attr);
        }
        el.setAttribute("aria-hidden", "true");
      }
      targetParent.append(clonedSvg);
      continue;
    }

    const tag = child.tagName.toLowerCase();
    const cloned = INTERACTIVE_MIRROR_TAGS.has(tag)
      ? doc.createElement("span")
      : child.cloneNode(false);
    if (!(cloned instanceof Element)) continue;
    if (INTERACTIVE_MIRROR_TAGS.has(tag)) {
      cloned.className = child.className;
    }
    for (const attr of STRIPPED_MIRROR_ATTRIBUTES) {
      cloned.removeAttribute(attr);
    }
    cloned.setAttribute("aria-hidden", "true");
    appendVisualOnlyNodes(child, cloned, doc);
    targetParent.append(cloned);
  }

  flushPendingText();
}

/**
 * Builds an inert, non-interactive visual mirror of segmented toggle labels for
 * Emil Kowalski's dual-layer `clip-path: inset()` effect — zero duplicate buttons,
 * zero duplicate IDs, zero duplicate DOM text nodes, zero focusable elements (Astra P1-3).
 */
function buildVisualOnlyMirror(sourceRoot: HTMLElement, mirrorContainer: HTMLElement): void {
  const doc = sourceRoot.ownerDocument;
  const buttons = sourceRoot.querySelectorAll<HTMLElement>(':scope > [data-slot="toggle"]');
  const fragment = doc.createDocumentFragment();
  for (const button of buttons) {
    const mirrorItem = doc.createElement("span");
    mirrorItem.className = button.className;
    mirrorItem.setAttribute("aria-hidden", "true");
    mirrorItem.dataset.slot = "toggle-clip-label";
    mirrorItem.style.pointerEvents = "none";
    mirrorItem.style.background = "transparent";
    mirrorItem.style.boxShadow = "none";
    mirrorItem.style.color = "var(--foreground)";
    mirrorItem.style.width = `${button.offsetWidth}px`;
    mirrorItem.style.height = `${button.offsetHeight}px`;

    appendVisualOnlyNodes(button, mirrorItem, doc);
    fragment.append(mirrorItem);
  }
  mirrorContainer.replaceChildren(fragment);
}

function attachSegmentedClipLayer(group: HTMLElement, clipLayer: HTMLElement): () => void {
  let hasClippedOnce = false;
  let isRebuilding = false;
  let observer: MutationObserver | null = null;

  const syncClip = (allowMotion: boolean) => {
    const pressed = group.querySelector<HTMLElement>(':scope > [data-slot="toggle"][data-pressed]');
    const groupWidth = group.clientWidth;
    const groupHeight = group.clientHeight;
    if (!pressed || groupWidth <= 0 || groupHeight <= 0) {
      clipLayer.style.opacity = "0";
      hasClippedOnce = false;
      return;
    }

    const top = pressed.offsetTop;
    const left = pressed.offsetLeft;
    const right = Math.max(0, groupWidth - (left + pressed.offsetWidth));
    const bottom = Math.max(0, groupHeight - (top + pressed.offsetHeight));
    const win = group.ownerDocument.defaultView ?? globalThis.window;
    const instant = !allowMotion || !hasClippedOnce || prefersReducedMotion(win);

    clipLayer.style.transition = instant
      ? "opacity 100ms ease-out"
      : "clip-path var(--duration-fluid) var(--spring-fluid), opacity 100ms ease-out";
    clipLayer.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px round var(--radius-md))`;
    clipLayer.style.opacity = "1";
    hasClippedOnce = true;
  };

  const rebuildAndSync = (allowMotion: boolean) => {
    if (isRebuilding) return;
    isRebuilding = true;
    try {
      buildVisualOnlyMirror(group, clipLayer);
      syncClip(allowMotion);
    } finally {
      observer?.takeRecords();
      isRebuilding = false;
    }
  };

  observer = new MutationObserver((records) => {
    if (isRebuilding) return;
    const externalRecords = records.filter((record) => {
      if (clipLayer.contains(record.target)) return false;
      if (record.type === "childList" && record.target === group) {
        const touched = [...record.addedNodes, ...record.removedNodes];
        if (touched.length > 0 && touched.every((node) => node === clipLayer)) {
          return false;
        }
      }
      return true;
    });
    if (externalRecords.length === 0) return;

    const contentChanged = externalRecords.some(
      (record) => record.type === "childList" || record.type === "characterData",
    );
    if (contentChanged) {
      rebuildAndSync(true);
    } else {
      syncClip(true);
    }
  });

  rebuildAndSync(false);

  observer.observe(group, {
    attributes: true,
    subtree: true,
    childList: true,
    characterData: true,
    attributeFilter: ["data-pressed"],
  });

  const stopResize = observeResize(group, () => rebuildAndSync(false));
  return () => {
    observer?.disconnect();
    observer = null;
    stopResize();
  };
}

function ToggleGroup({
  className,
  variant = "segmented",
  size: sizeProp,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props & VariantProps<typeof toggleVariants>) {
  const size =
    sizeProp === undefined ? (variant === "segmented" ? "segmented" : "default") : sizeProp;
  const value = { size, variant };
  const isSegmented = variant === "segmented";
  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const clipLayerRef = React.useRef<HTMLDivElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes dual-layer clip-path inset pill with active segmented toggle
  React.useLayoutEffect(() => {
    if (!isSegmented) return;
    const group = groupRef.current;
    const clipLayer = clipLayerRef.current;
    if (!group || !clipLayer) return;
    return attachSegmentedClipLayer(group, clipLayer);
  }, [isSegmented]);

  return (
    <ToggleGroupPrimitive
      ref={groupRef}
      className={cn(
        "relative flex w-fit *:focus-visible:z-10 dark:*:[[data-slot=separator]:has(+[data-slot=toggle]:hover)]:before:bg-input/64 dark:*:[[data-slot=separator]:has(+[data-slot=toggle][data-pressed])]:before:bg-input dark:*:[[data-slot=toggle]:hover+[data-slot=separator]]:before:bg-input/64 dark:*:[[data-slot=toggle][data-pressed]+[data-slot=separator]]:before:bg-input",
        orientation === "horizontal"
          ? "*:pointer-coarse:after:min-w-auto"
          : "*:pointer-coarse:after:min-h-auto",
        variant === "segmented"
          ? "gap-0.5 rounded-lg bg-input/40 p-0.5 ring-1 ring-inset ring-border/50"
          : variant === "default"
            ? "gap-0.5"
            : orientation === "horizontal"
              ? "*:not-first:not-data-[slot=separator]:before:-start-[0.5px] *:not-last:not-data-[slot=separator]:before:-end-[0.5px] *:not-first:rounded-s-none *:not-last:rounded-e-none *:not-first:border-s-0 *:not-last:border-e-0 *:not-first:before:rounded-s-none *:not-last:before:rounded-e-none"
              : "*:not-first:not-data-[slot=separator]:before:-top-[0.5px] *:not-last:not-data-[slot=separator]:before:-bottom-[0.5px] flex-col *:not-first:rounded-t-none *:not-last:rounded-b-none *:not-first:border-t-0 *:not-last:border-b-0 *:not-first:before:rounded-t-none *:not-last:before:rounded-b-none *:data-[slot=toggle]:not-last:before:hidden dark:*:last:before:hidden dark:*:first:before:block",
        className,
      )}
      data-size={size}
      data-slot="toggle-group"
      data-variant={variant}
      orientation={orientation}
      {...props}
    >
      <ToggleGroupContext value={value}>{children}</ToggleGroupContext>
      {isSegmented ? (
        <div
          ref={clipLayerRef}
          aria-hidden="true"
          inert
          data-slot="toggle-group-clip-layer"
          style={CLIP_LAYER_STYLE}
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex select-none gap-0.5 p-0.5 bg-background text-foreground shadow-xs/10 opacity-0 dark:bg-input/72",
            orientation === "vertical" && "flex-col",
          )}
        />
      ) : null}
    </ToggleGroupPrimitive>
  );
}

function Toggle({
  className,
  children,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.use(ToggleGroupContext);

  const resolvedVariant = variant ?? context.variant;
  const resolvedSize = size ?? context.size;

  return (
    <ToggleComponent
      className={className}
      data-size={resolvedSize}
      data-variant={resolvedVariant}
      size={resolvedSize}
      variant={resolvedVariant}
      {...props}
    >
      {children}
    </ToggleComponent>
  );
}

export { ToggleGroup, Toggle, Toggle as ToggleGroupItem };

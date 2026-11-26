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

/**
 * Builds an inert, non-interactive visual mirror of segmented toggle labels for
 * Emil Kowalski's dual-layer `clip-path: inset()` effect — zero duplicate buttons,
 * zero duplicate IDs, zero focusable elements (Astra P1-3).
 */
function buildVisualOnlyMirror(sourceRoot: HTMLElement, mirrorContainer: HTMLElement): void {
  const buttons = sourceRoot.querySelectorAll<HTMLElement>(':scope > [data-slot="toggle"]');
  const fragment = sourceRoot.ownerDocument.createDocumentFragment();
  for (const button of buttons) {
    const mirrorItem = sourceRoot.ownerDocument.createElement("span");
    mirrorItem.className = button.className;
    mirrorItem.setAttribute("aria-hidden", "true");
    mirrorItem.dataset.slot = "toggle-clip-label";
    mirrorItem.style.pointerEvents = "none";
    mirrorItem.style.background = "transparent";
    mirrorItem.style.boxShadow = "none";
    mirrorItem.style.color = "var(--foreground)";
    mirrorItem.style.width = `${button.offsetWidth}px`;
    mirrorItem.style.height = `${button.offsetHeight}px`;

    for (const child of Array.from(button.childNodes)) {
      const cloned = child.cloneNode(true);
      if (cloned instanceof Element) {
        for (const el of [cloned, ...cloned.querySelectorAll("*")]) {
          el.removeAttribute("id");
          el.removeAttribute("tabindex");
          el.removeAttribute("role");
          el.removeAttribute("name");
          el.removeAttribute("for");
          el.removeAttribute("aria-controls");
          el.removeAttribute("aria-labelledby");
          el.removeAttribute("aria-describedby");
        }
      }
      mirrorItem.append(cloned);
    }
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

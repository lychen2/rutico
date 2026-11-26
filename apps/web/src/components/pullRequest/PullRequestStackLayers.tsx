import type { PullRequestRef, PullRequestStack } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import "~/styles/workspace-hubs.css";

import { MenuItem, MenuGroupLabel } from "../ui/menu";
import { PullRequestStackLayerContent } from "./PullRequestStackLayerContent";
import { buildStackRailNodes } from "./pullRequestStackRail.logic";

export function PullRequestStackLayers({
  stack,
  reference,
  onSelect,
  pending = false,
}: {
  stack: PullRequestStack;
  reference: PullRequestRef;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  pending?: boolean;
}) {
  const nodes = buildStackRailNodes(stack, reference.number);
  const hasCurrentInStack = nodes.some((node) => node.isCurrent);

  return (
    <div
      ref={observeVisibleAnimation}
      data-slot="pr-stack-metro-rail"
      className="max-h-80 overflow-y-auto"
    >
      {nodes.map((node) => {
        const { layer, isCurrent, isBelowCurrent, isTop, tone } = node;
        const topRailActive = isBelowCurrent;
        const bottomRailActive = isCurrent || isBelowCurrent;
        return (
          <MenuItem
            key={layer.number}
            onClick={() => {
              onSelect?.({ ...reference, number: layer.number });
            }}
            disabled={!onSelect || pending}
            aria-current={isCurrent ? "true" : undefined}
            className="relative"
          >
            <span
              aria-hidden="true"
              data-slot="pr-stack-rail-col"
              className="relative flex w-5 shrink-0 self-stretch items-center justify-center"
            >
              {!isTop ? (
                <span
                  className={cn(
                    "absolute top-0 bottom-1/2 left-1/2 w-[2px] -translate-x-1/2 rounded-full transition-colors duration-180 motion-reduce:transition-none",
                    topRailActive ? "bg-primary/70" : "bg-border",
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "absolute top-1/2 bottom-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full transition-colors duration-180 motion-reduce:transition-none",
                  bottomRailActive ? "bg-primary/70" : "bg-border",
                )}
              />
              <span
                data-slot="pr-stack-rail-node"
                data-current={isCurrent ? "true" : undefined}
                data-tone={tone}
                className={cn(
                  "relative z-1 rounded-full border-2 transition-transform duration-180 ease-(--spring-snappy) motion-reduce:transition-none",
                  isCurrent
                    ? "size-2.5 border-primary bg-primary"
                    : tone === "merged"
                      ? "size-2 border-info bg-info/30"
                      : tone === "closed"
                        ? "size-2 border-destructive/75 bg-background"
                        : tone === "draft"
                          ? "size-2 border-muted-foreground/70 bg-background"
                          : "size-2 border-success bg-background",
                )}
              />
            </span>
            <PullRequestStackLayerContent layer={layer} />
            {isCurrent ? <CheckIcon aria-hidden className="size-3.5 text-primary" /> : null}
          </MenuItem>
        );
      })}
      <MenuGroupLabel>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="relative flex w-5 shrink-0 items-center justify-center"
          >
            <span
              className={cn(
                "absolute -top-2 bottom-1/2 left-1/2 w-[2px] -translate-x-1/2",
                hasCurrentInStack ? "bg-primary/70" : "bg-border",
              )}
            />
            <span
              className={cn(
                "relative z-1 size-2 rotate-45 rounded-xs border",
                hasCurrentInStack
                  ? "border-primary/80 bg-primary/20"
                  : "border-muted-foreground/60 bg-background",
              )}
            />
          </span>
          <span className="font-mono text-xs">↳ {stack.base}</span>
        </span>
      </MenuGroupLabel>
    </div>
  );
}

import type * as React from "react";

import { inferReactiveKeyFromLabel, usePressedKey } from "~/lib/motion/usePressedKey";
import { cn } from "~/lib/utils";

function Kbd({
  className,
  variant = "default",
  reactiveKey,
  children,
  ...props
}: React.ComponentProps<"kbd"> & {
  /** `outline` draws a physical key, so the hint stays distinct inside surrounding text. */
  variant?: "default" | "outline";
  /** Physical key to track for live keycap depression; pass `false` to opt out. */
  reactiveKey?: string | false;
}) {
  const trackedKey =
    reactiveKey === false ? undefined : (reactiveKey ?? inferReactiveKeyFromLabel(children));
  const isPressed = usePressedKey(trackedKey);

  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded px-1 font-medium font-sans tabular-nums text-muted-foreground text-xs transition-[transform,box-shadow,background-color,color] duration-120 ease-(--spring-snappy) motion-reduce:transition-none [&_svg:not([class*='size-'])]:size-3",
        variant === "outline"
          ? "border border-b-2 border-foreground/15 px-1.5"
          : "bg-foreground/[0.07] ring-1 ring-inset ring-foreground/10 shadow-[0_1px_0_--theme(--color-black/10%)] dark:shadow-[0_1px_0_--theme(--color-black/40%)]",
        className,
      )}
      data-key-pressed={isPressed ? "true" : undefined}
      data-slot="kbd"
      {...props}
    >
      {children}
    </kbd>
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };

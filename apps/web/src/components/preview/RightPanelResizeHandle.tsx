import type { ComponentProps } from "react";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props extends Pick<
  ComponentProps<"div">,
  "tabIndex" | "onKeyDown" | "aria-valuenow" | "aria-valuemin" | "aria-valuemax"
> {
  handlers: ResizableWidthHandlers;
  className?: string;
  label?: string;
}

export function RightPanelResizeHandle({ handlers, className, label, ...separatorProps }: Props) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      {...separatorProps}
      className={cn(
        "group resize-divider-handle absolute inset-y-0 -left-1.5 z-40 w-3 cursor-col-resize touch-none select-none any-pointer-coarse:left-0 any-pointer-coarse:w-2",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="resize-divider-rail pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 ease-out group-hover:bg-border group-focus-visible:bg-primary/60 group-active:bg-primary/60 motion-reduce:transition-none any-pointer-coarse:left-0"
      />
      <span
        aria-hidden
        className="resize-divider-pill pointer-events-none absolute top-1/2 left-1/2 h-8 w-0.75 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/55 opacity-0 transition-[opacity,background-color,scale] duration-150 ease-out group-hover:opacity-100 group-focus-visible:bg-primary/80 group-focus-visible:opacity-100 motion-safe:group-active:scale-y-125 group-active:bg-primary/80 group-active:opacity-100 motion-reduce:transition-none any-pointer-coarse:left-0"
      />
      <span
        aria-hidden
        data-resize-hud
        className="resize-ratio-hud surface-optical-chrome surface-elevated-rim pointer-events-none absolute top-0 left-4 z-50 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-2xs font-medium tabular-nums text-foreground opacity-0 will-change-transform"
      />
    </div>
  );
}

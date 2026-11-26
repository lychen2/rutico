import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useRef } from "react";

import { rubberbandClamp } from "~/lib/motion/rubberBand";
import { prefersReducedMotion } from "~/lib/motion/springs";
import { cn } from "~/lib/utils";

const DRAG_ACTIVATION_PX = 4;

type SwitchPointerEvent = Parameters<NonNullable<SwitchPrimitive.Root.Props["onPointerDown"]>>[0];
type SwitchClickEvent = Parameters<NonNullable<SwitchPrimitive.Root.Props["onClick"]>>[0];

function Switch({
  className,
  size = "default",
  mixed = false,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...props
}: SwitchPrimitive.Root.Props & { size?: "default" | "sm"; mixed?: boolean }) {
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    wasChecked: boolean;
    travel: number;
    moved: boolean;
    lastOffset: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const resetThumbInlineStyle = () => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    thumb.style.transform = "";
    thumb.style.transition = "";
  };

  const handlePointerDown = (event: SwitchPointerEvent) => {
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    const root = event.currentTarget;
    if (root.hasAttribute("data-disabled") || root.getAttribute("aria-disabled") === "true") return;
    const thumb = thumbRef.current;
    if (!thumb) return;

    const travel = Math.max(0, root.clientWidth - thumb.offsetWidth - 4);
    const wasChecked = root.hasAttribute("data-checked");
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      wasChecked,
      travel,
      moved: false,
      lastOffset: wasChecked ? travel : 0,
    };
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may not have an active pointerId to capture.
    }
  };

  const handlePointerMove = (event: SwitchPointerEvent) => {
    onPointerMove?.(event);
    const drag = dragRef.current;
    const thumb = thumbRef.current;
    if (!drag || !thumb || drag.pointerId !== event.pointerId || drag.travel <= 0) return;

    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < DRAG_ACTIVATION_PX) return;
    drag.moved = true;

    const baseOffset = drag.wasChecked ? drag.travel : 0;
    const rawOffset = baseOffset + dx;
    const resisted = rubberbandClamp(rawOffset, 0, drag.travel, drag.travel * 0.45, 0.35);
    drag.lastOffset = rawOffset;

    if (!prefersReducedMotion()) {
      thumb.style.transition = "none";
      const deltaFromRest = resisted - baseOffset;
      thumb.style.transform = `translate3d(${deltaFromRest.toFixed(1)}px, 0, 0) scaleX(1.12)`;
    }
  };

  const finishDrag = (event: SwitchPointerEvent, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    resetThumbInlineStyle();

    if (!drag.moved || cancelled) return;
    const targetChecked = drag.lastOffset >= drag.travel * 0.5;
    // Base UI toggles on the trailing click event; suppress click only if the drag settled back
    // to the starting side so dragging halfway and pulling back does not flip the switch.
    if (targetChecked === drag.wasChecked) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const handleClick = (event: SwitchClickEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 cursor-pointer touch-pan-y items-center rounded-full p-[2px] outline-none transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 pointer-coarse:after:-translate-1/2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input not-data-disabled:data-unchecked:any-hover:bg-foreground/24 not-data-disabled:data-checked:any-hover:bg-primary/90 not-data-disabled:data-[mixed]:any-hover:bg-foreground/24 data-disabled:cursor-not-allowed data-disabled:opacity-64 data-[mixed]:bg-input",
        size === "sm"
          ? "[--thumb-size:--spacing(4)] sm:[--thumb-size:--spacing(3.5)]"
          : "[--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]",
        className,
      )}
      data-size={size}
      data-slot="switch"
      data-mixed={mixed ? "" : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        finishDrag(event, false);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        finishDrag(event, true);
      }}
      // Base UI overwrites aria-checked even with undefined; pass it only for mixed state.
      {...(mixed ? { "aria-checked": "mixed" as const } : {})}
      {...props}
    >
      <SwitchPrimitive.Thumb
        ref={thumbRef}
        className={cn(
          "pointer-events-none block size-[calc(var(--thumb-size)-2px)] shrink-0 origin-left motion-safe:in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-115 motion-safe:in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.15)] rounded-(--thumb-size) bg-background shadow-sm/5 ring-1 ring-inset ring-foreground/8 dark:data-unchecked:bg-foreground/75 dark:data-unchecked:ring-foreground/15 [transition:translate_220ms_var(--spring-snappy),border-radius_120ms_ease-out,scale_90ms_var(--spring-snappy),transform-origin_150ms_ease-out,background-color_150ms_ease-out,box-shadow_150ms_ease-out] motion-reduce:transition-none data-checked:origin-right data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
          mixed &&
            "translate-x-[calc((var(--thumb-size)-4px)/2)] opacity-70 data-checked:translate-x-[calc((var(--thumb-size)-4px)/2)]",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

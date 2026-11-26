import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { createContext, use, useRef, type CSSProperties, type RefObject } from "react";
import { useSheetDrag } from "~/lib/motion/useSheetDrag";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { ControlledOpenContext, renderRetainedPopup } from "~/components/ui/dialog";

const SheetActionsContext = createContext<RefObject<SheetPrimitive.Root.Actions | null> | null>(
  null,
);

function Sheet<Payload>(props: SheetPrimitive.Root.Props<Payload>) {
  const localActionsRef = useRef<SheetPrimitive.Root.Actions | null>(null);
  const actionsRef = props.actionsRef ?? localActionsRef;
  return (
    <ControlledOpenContext value={props.open}>
      <SheetActionsContext value={actionsRef}>
        <SheetPrimitive.Root {...props} actionsRef={actionsRef} />
      </SheetActionsContext>
    </ControlledOpenContext>
  );
}

const SheetPortal = SheetPrimitive.Portal;

function SheetBackdrop({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "dialog-backdrop fixed inset-0 z-(--z-sheet) transition-opacity duration-220 ease-out data-ending-style:duration-150 data-ending-style:ease-(--ease-exit) data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
        className,
      )}
      data-slot="sheet-backdrop"
      {...props}
    />
  );
}

function SheetViewport({
  className,
  side,
  variant = "default",
  ...props
}: SheetPrimitive.Viewport.Props & {
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
}) {
  return (
    <SheetPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-(--z-sheet) grid overscroll-contain [-webkit-app-region:no-drag]",
        side === "bottom" && "grid grid-rows-[1fr_auto] pt-12 pb-(--software-keyboard-inset,0px)",
        side === "top" && "grid grid-rows-[auto_1fr] pb-12",
        side === "left" && "flex justify-start",
        side === "right" && "flex justify-end",
        variant === "inset" && "sm:p-4",
        className,
      )}
      data-slot="sheet-viewport"
      {...props}
    />
  );
}

function SheetPopup({
  className,
  children,
  showCloseButton = true,
  keepMounted = false,
  dragToDismiss = true,
  transitionDurationMs,
  side = "right",
  variant = "default",
  style,
  ref,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onScrollCapture,
  ...props
}: SheetPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  keepMounted?: boolean;
  dragToDismiss?: boolean;
  transitionDurationMs?: number;
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
}) {
  const gt = useGT();
  const actionsRef = use(SheetActionsContext);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dragHandlers = useSheetDrag({
    enabled: dragToDismiss,
    side,
    popupRef,
    backdropRef,
    onDismiss: () => actionsRef?.current?.close(),
  });
  const transitionStyle =
    transitionDurationMs === undefined
      ? undefined
      : ({ transitionDuration: `${transitionDurationMs}ms` } satisfies CSSProperties);
  const instant = transitionDurationMs === 0;

  const assignPopupRef = (node: HTMLDivElement | null) => {
    popupRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref && "current" in ref) ref.current = node;
  };

  return (
    <SheetPortal keepMounted={keepMounted}>
      <SheetBackdrop
        ref={backdropRef}
        className={
          instant
            ? "transition-none! data-ending-style:opacity-100! data-starting-style:opacity-100!"
            : undefined
        }
        style={transitionStyle}
      />
      <SheetViewport side={side} variant={variant}>
        <SheetPrimitive.Popup
          ref={assignPopupRef}
          className={cn(
            "dialog-glass relative flex max-h-full min-h-0 w-full min-w-0 flex-col text-popover-foreground outline-none transition-[opacity,translate] duration-250 ease-(--ease-drawer) data-ending-style:duration-160 data-ending-style:ease-(--ease-exit) data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
            dragToDismiss && (side === "left" || side === "right") && "touch-pan-y",
            side === "bottom" &&
              "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
            side === "top" &&
              "data-ending-style:-translate-y-8 data-starting-style:-translate-y-8 border-b",
            side === "left" &&
              "data-ending-style:-translate-x-8 data-starting-style:-translate-x-8 w-[calc(100%-(--spacing(12)))] max-w-md border-e",
            side === "right" &&
              "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-md border-s data-ending-style:translate-x-8 data-starting-style:translate-x-8",
            variant === "inset" &&
              "sm:rounded-2xl sm:border sm:**:data-[slot=sheet-footer]:rounded-b-[calc(var(--radius-2xl)-1px)]",
            instant &&
              "transition-none! data-ending-style:translate-x-0! data-starting-style:translate-x-0! data-ending-style:translate-y-0! data-starting-style:translate-y-0! data-ending-style:opacity-100! data-starting-style:opacity-100!",
            className,
          )}
          data-slot="sheet-popup"
          onPointerCancel={(event) => {
            onPointerCancel?.(event);
            dragHandlers.onPointerCancel(event);
          }}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            dragHandlers.onPointerDown(event);
          }}
          onPointerMove={(event) => {
            onPointerMove?.(event);
            dragHandlers.onPointerMove(event);
          }}
          onPointerUp={(event) => {
            onPointerUp?.(event);
            dragHandlers.onPointerUp(event);
          }}
          onScrollCapture={(event) => {
            onScrollCapture?.(event);
            dragHandlers.onScrollCapture(event);
          }}
          render={keepMounted ? undefined : renderRetainedPopup}
          style={{ ...transitionStyle, ...style }}
          {...props}
        >
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              aria-label={gt("Close", { $context: "button, closes the panel" })}
              className="absolute end-2 top-2"
              render={<Button size="icon" variant="ghost" />}
            >
              <XIcon />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetViewport>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pb-3 max-sm:pb-4",
        className,
      )}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      className={cn(
        "text-balance font-semibold text-xl leading-snug tracking-[-0.015em]",
        className,
      )}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      className={cn("text-pretty text-muted-foreground text-sm leading-relaxed", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export {
  Sheet,
  SheetPortal,
  SheetBackdrop,
  SheetBackdrop as SheetOverlay,
  SheetPopup,
  SheetPopup as SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};

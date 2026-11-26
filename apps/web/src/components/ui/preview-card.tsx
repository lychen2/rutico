import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "~/lib/utils";
import { HOVER_CARD_INTENT_CLOSE_DELAY_MS, PREVIEW_INTENT_DELAY_MS } from "./tooltip";

const PreviewCard = PreviewCardPrimitive.Root;

function PreviewCardTrigger({
  delay = PREVIEW_INTENT_DELAY_MS,
  closeDelay = HOVER_CARD_INTENT_CLOSE_DELAY_MS,
  ...props
}: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger
      closeDelay={closeDelay}
      data-slot="preview-card-trigger"
      delay={delay}
      {...props}
    />
  );
}

function PreviewCardPopup({
  className,
  align = "start",
  side = "top",
  sideOffset = 6,
  ...props
}: PreviewCardPrimitive.Popup.Props & {
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  sideOffset?: PreviewCardPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        className="z-[140] max-w-(--available-width) transition-[top,left,right,bottom,transform] duration-200 ease-(--spring-snappy) data-instant:transition-none motion-reduce:transition-none"
        data-slot="preview-card-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          // Electron drag hit-testing ignores z-index; popups over a drag region would swallow hover.
          className={cn(
            "dropdown-glass surface-elevated-rim origin-(--transform-origin) rounded-lg text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none transition-[scale,opacity,translate] duration-150 ease-(--spring-snappy) data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=top]:data-starting-style:translate-y-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 data-ending-style:duration-100 data-ending-style:ease-(--ease-exit) data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:duration-0 motion-reduce:transition-none [-webkit-app-region:no-drag] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
            className,
          )}
          data-slot="preview-card-popup"
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { PreviewCard, PreviewCardPopup, PreviewCardTrigger };

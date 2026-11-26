import type { ComponentProps, ReactNode } from "react";
import {
  HOVER_CARD_INTENT_CLOSE_DELAY_MS,
  HOVER_CARD_INTENT_DELAY_MS,
  TooltipPopup,
} from "./ui/tooltip";
import { cn } from "~/lib/utils";

export function ThreadHoverCardPopup({ className, ...props }: ComponentProps<typeof TooltipPopup>) {
  return (
    <TooltipPopup
      {...props}
      data-hover-card-close-grace={HOVER_CARD_INTENT_CLOSE_DELAY_MS}
      data-hover-card-delay={HOVER_CARD_INTENT_DELAY_MS}
      variant="glass"
      className={cn("max-w-80 text-left whitespace-normal", className)}
    />
  );
}

export function ThreadHoverCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2">
      <div className="min-w-0 truncate text-xs leading-tight font-medium text-foreground">
        {title}
      </div>
      <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">{children}</div>
      {footer}
    </div>
  );
}

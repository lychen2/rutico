import { X } from "lucide-react";
import type { ReactNode } from "react";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";

interface PanelTabCloseButtonProps {
  children: ReactNode;
  label: string;
  onClick: () => void;
  tooltip?: string;
}

export function PanelTabCloseButton({
  children,
  label,
  onClick,
  tooltip,
}: PanelTabCloseButtonProps) {
  const button = (
    <button
      type="button"
      className="cursor-pointer group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm outline-none transition-[background-color,color,scale] duration-150 ease-(--ease-spring-snappy) any-hover:bg-muted active:scale-90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:size-7 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:min-h-11 motion-reduce:transition-none motion-reduce:active:scale-100"
      aria-label={label}
      onClick={onClick}
    >
      <span className="relative flex size-3 items-center justify-center transition-[opacity,scale] duration-150 ease-out group-hover/tab:scale-75 group-hover/tab:opacity-0 group-focus-visible/close:scale-75 group-focus-visible/close:opacity-0 pointer-coarse:scale-75 pointer-coarse:opacity-0 motion-reduce:transition-none">
        {children}
      </span>
      <X className="pointer-events-none absolute size-3 scale-75 opacity-0 transition-[opacity,scale] duration-150 ease-(--ease-spring-snappy) group-hover/tab:scale-100 group-hover/tab:opacity-100 group-focus-visible/close:scale-100 group-focus-visible/close:opacity-100 pointer-coarse:scale-100 pointer-coarse:opacity-100 motion-reduce:transition-none" />
    </button>
  );

  if (!tooltip) return button;

  return <SharedTooltipTrigger render={button} label={tooltip} />;
}

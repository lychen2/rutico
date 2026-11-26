import { T, useGT, Var } from "gt-react";

import { MenuGroupLabel } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function PullRequestStackHeader({
  number,
  layerCount,
  notice,
  stale = false,
}: {
  number: number;
  layerCount?: number;
  notice?: string | null | undefined;
  stale?: boolean;
}) {
  const gt = useGT();
  return (
    <MenuGroupLabel>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span>
            <T>
              Stack #<Var>{number}</Var>
            </T>
          </span>
          {layerCount !== undefined && layerCount > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-px font-mono text-3xs font-medium text-muted-foreground tabular-nums">
              {layerCount}
            </span>
          ) : null}
        </span>
        {notice ? (
          <Tooltip>
            <TooltipTrigger render={<span role="status" className="text-xs font-normal" />}>
              {stale ? gt("May be stale") : gt("Refreshing…")}
            </TooltipTrigger>
            <TooltipPopup>{notice}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </MenuGroupLabel>
  );
}

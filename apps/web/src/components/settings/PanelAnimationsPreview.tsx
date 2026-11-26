import { RotateCcwIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { type CSSProperties, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

export function PanelAnimationsPreview({ durationMs }: { durationMs: number }) {
  const gt = useGT();
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [slowMotion, setSlowMotion] = useState(false);
  const effectiveDurationMs = slowMotion ? durationMs * 2 : durationMs;
  const transitionClass =
    "transition-[width,height,border-width,opacity,transform] duration-(--preview-duration) ease-out motion-reduce:transition-none";

  return (
    <div
      data-slot="panel-motion-stage"
      className="flex h-28 w-full flex-col gap-1.5 rounded-lg border border-border/80 bg-muted/20 p-2"
      style={{ "--preview-duration": `${effectiveDurationMs}ms` } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" aria-hidden>
            <span className="size-1.5 rounded-full bg-muted-foreground/35" />
            <span className="size-1.5 rounded-full bg-muted-foreground/25" />
            <span className="size-1.5 rounded-full bg-muted-foreground/20" />
          </span>
          <span className="font-mono tabular-nums">
            {effectiveDurationMs} ms
            {slowMotion ? ` · ${gt("0.5× slow motion")}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant={slowMotion ? "secondary" : "ghost"}
            aria-pressed={slowMotion}
            aria-label={gt("Toggle 0.5x slow motion preview")}
            onClick={() => setSlowMotion((current) => !current)}
          >
            <span className="font-mono text-2xs tabular-nums">0.5×</span>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label={gt("Replay panel animation preview")}
            onClick={() => setPanelsOpen((open) => !open)}
          >
            <RotateCcwIcon className="size-3" />
            <T>Replay</T>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        <div
          aria-hidden
          onClick={() => setPanelsOpen((open) => !open)}
          className="flex min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md border border-border/80 bg-background p-1 shadow-xs/5"
        >
          <span
            className={cn(
              "flex h-full shrink-0 flex-col gap-1 overflow-hidden rounded-sm bg-sidebar",
              transitionClass,
              panelsOpen ? "w-14 p-1.5 opacity-100" : "w-0 p-0 opacity-0",
            )}
          >
            <span className="h-1.5 w-8 rounded-full bg-primary/45" />
            <span className="h-1 w-10 rounded-full bg-muted-foreground/25" />
            <span className="h-1 w-7 rounded-full bg-muted-foreground/20" />
            <span className="mt-auto h-1 w-9 rounded-full bg-muted-foreground/15" />
          </span>

          <span className="flex min-w-0 flex-1 flex-col px-1.5">
            <span className="flex min-h-0 flex-1 flex-col justify-center gap-1 py-1">
              <span className="h-1.5 w-3/4 rounded-full bg-muted-foreground/25" />
              <span className="h-1.5 w-full rounded-full bg-muted-foreground/20" />
              <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/15" />
            </span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 overflow-hidden rounded-b-xs bg-foreground/[0.05] px-1.5",
                transitionClass,
                panelsOpen
                  ? "h-4 border-t border-border/70 opacity-100"
                  : "h-0 border-t-0 opacity-0",
              )}
            >
              <span className="h-1 w-2 rounded-full bg-primary/50" />
              <span className="h-1 w-1/2 rounded-full bg-muted-foreground/25" />
            </span>
          </span>

          <span
            className={cn(
              "flex h-full shrink-0 flex-col gap-1 overflow-hidden rounded-sm bg-muted",
              transitionClass,
              panelsOpen ? "w-16 p-1.5 opacity-100" : "w-0 p-0 opacity-0",
            )}
          >
            <span className="h-1 w-10 rounded-full bg-diff-addition/55" />
            <span className="h-1 w-8 rounded-full bg-diff-deletion/55" />
            <span className="h-1 w-11 rounded-full bg-muted-foreground/25" />
            <span className="h-1 w-7 rounded-full bg-diff-addition/40" />
          </span>
        </div>

        <div
          aria-hidden
          className="hidden w-20 shrink-0 flex-col justify-between rounded-md border border-border/60 bg-background/80 p-1.5 sm:flex"
        >
          <svg viewBox="0 0 64 36" className="h-full w-full overflow-visible">
            <line
              x1="4"
              y1="32"
              x2="60"
              y2="32"
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <line
              x1="4"
              y1="4"
              x2="4"
              y2="32"
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <path
              d="M 4 32 C 16 4, 34 4, 60 4"
              fill="none"
              stroke="currentColor"
              className="text-primary/70"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle
              cx="4"
              cy="32"
              r="3"
              fill="currentColor"
              className={cn(
                "text-primary",
                "transition-transform duration-(--preview-duration) ease-out motion-reduce:transition-none",
              )}
              style={{
                transform: panelsOpen ? "translate3d(56px, -28px, 0)" : "translate3d(0px, 0px, 0)",
              }}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";

import { cn } from "~/lib/utils";

export function RuticoHeroBackdrop({
  variant = "hero",
}: {
  readonly variant?: "hero" | "workspace";
}) {
  const isWorkspace = variant === "workspace";
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none z-0 select-none overflow-hidden",
        isWorkspace ? "fixed inset-0" : "absolute inset-0",
      )}
    >
      <img
        ref={(node) => {
          if (node?.complete && node.naturalWidth > 0) {
            setLoaded(true);
          }
        }}
        src="/rutico-hero-desktop.webp"
        alt=""
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover object-right-bottom transition-opacity duration-300 ease-out motion-reduce:transition-none",
          !loaded
            ? "opacity-0"
            : isWorkspace
              ? "opacity-65 contrast-more:opacity-20 dark:opacity-36 dark:saturate-95 dark:contrast-more:opacity-12"
              : "opacity-80 contrast-more:opacity-20 dark:opacity-30 dark:saturate-90 dark:contrast-more:opacity-12",
        )}
      />
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r",
          isWorkspace
            ? "from-background/90 via-background/74 to-background/25 dark:from-background/94 dark:via-background/84 dark:to-background/45"
            : "from-background/94 via-background/72 to-background/15 dark:from-background/96 dark:via-background/84 dark:to-background/40",
        )}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-transparent to-background/35" />
      <div
        className={cn(
          "absolute inset-0 bg-radial to-transparent",
          isWorkspace
            ? "from-background/45 via-background/15"
            : "from-background/50 via-background/20",
        )}
      />
      {/* Attenuate wallpaper intensity under OS high contrast or boosted Appearance contrast. */}
      <div className="absolute inset-0 bg-background/[calc(var(--appearance-contrast-boost,0%)*0.65)] contrast-more:bg-background/70" />
    </div>
  );
}

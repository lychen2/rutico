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
        "pointer-events-none z-0 select-none overflow-hidden contain-strict transform-gpu",
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
          "absolute inset-0",
          isWorkspace ? "rutico-backdrop-scrim-workspace" : "rutico-backdrop-scrim-hero",
        )}
      />
    </div>
  );
}

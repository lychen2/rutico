import { cn } from "~/lib/utils";

export function RuticoHeroBackdrop({
  variant = "hero",
}: {
  readonly variant?: "hero" | "workspace";
}) {
  const isWorkspace = variant === "workspace";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none z-0 select-none overflow-hidden",
        isWorkspace ? "fixed inset-0" : "absolute inset-0",
      )}
    >
      <img
        src="/rutico-hero-desktop.webp"
        alt=""
        decoding="async"
        className={cn(
          "h-full w-full object-cover object-right-bottom transition-opacity",
          isWorkspace
            ? "opacity-65 dark:opacity-36 dark:saturate-95"
            : "opacity-80 dark:opacity-30 dark:saturate-90",
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
    </div>
  );
}

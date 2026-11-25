export function RuticoHeroBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
    >
      <img
        src="/rutico-hero-desktop.webp"
        alt=""
        decoding="async"
        className="h-full w-full object-cover object-right opacity-80 transition-opacity dark:opacity-30 dark:saturate-90"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-background/94 via-background/72 to-background/15 dark:from-background/96 dark:via-background/84 dark:to-background/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-background/35" />
    </div>
  );
}

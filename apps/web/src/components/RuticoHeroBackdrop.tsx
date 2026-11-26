import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

export function RuticoHeroBackdrop({
  variant = "hero",
}: {
  readonly variant?: "hero" | "workspace";
}) {
  const isWorkspace = variant === "workspace";
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- decodes hero artwork off the main thread before revealing to eliminate partial-decode flashes
  useEffect(() => {
    const node = imgRef.current;
    if (!node) return;
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) setLoaded(true);
    };

    if (node.complete && node.naturalWidth > 0) {
      if (typeof node.decode === "function") {
        void node.decode().then(reveal, reveal);
      } else {
        reveal();
      }
      return () => {
        cancelled = true;
      };
    }

    const onLoad = () => {
      if (typeof node.decode === "function") {
        void node.decode().then(reveal, reveal);
      } else {
        reveal();
      }
    };
    node.addEventListener("load", onLoad, { once: true });
    return () => {
      cancelled = true;
      node.removeEventListener("load", onLoad);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none z-0 select-none overflow-hidden contain-strict transform-gpu",
        isWorkspace ? "fixed inset-0" : "absolute inset-0",
      )}
    >
      <img
        ref={imgRef}
        src="/rutico-hero-desktop.webp"
        alt=""
        decoding="async"
        className={cn(
          "h-full w-full object-cover object-right-bottom transition-[opacity,transform] duration-500 ease-(--spring-gentle) motion-reduce:scale-100 motion-reduce:transition-none",
          !loaded
            ? "scale-[1.03] opacity-0"
            : isWorkspace
              ? "scale-100 opacity-65 contrast-more:opacity-20 dark:opacity-36 dark:saturate-95 dark:contrast-more:opacity-12"
              : "scale-100 opacity-80 contrast-more:opacity-20 dark:opacity-30 dark:saturate-90 dark:contrast-more:opacity-12",
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

import { useRef, type ReactNode } from "react";

import { useSpecularPointer } from "~/lib/motion/useSpecularPointer";
import { cn } from "~/lib/utils";
import { T3Wordmark } from "../T3Wordmark";

const STANDALONE_MAX_WIDTH_CLASS = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
} as const;

export function SpecularHeroCard({
  children,
  className,
  maxWidth = "lg",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly maxWidth?: keyof typeof STANDALONE_MAX_WIDTH_CLASS;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useSpecularPointer(cardRef);

  return (
    <div
      ref={cardRef}
      data-slot="specular-hero-card"
      className={cn(
        "surface-glass surface-specular-prism w-full rounded-2xl border border-border/55 px-8 py-10 dark:border-white/8",
        STANDALONE_MAX_WIDTH_CLASS[maxWidth],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StandalonePage({
  children,
  maxWidth = "xl",
  className,
}: {
  readonly children: ReactNode;
  readonly maxWidth?: keyof typeof STANDALONE_MAX_WIDTH_CLASS;
  readonly className?: string;
}) {
  const cardRef = useRef<HTMLElement>(null);
  useSpecularPointer(cardRef);

  return (
    // The page owns scrolling because root cannot scroll; safe centering keeps oversized cards top-aligned.
    <div className="flex h-full items-center-safe justify-center overflow-y-auto scrollbar-gutter-both bg-background px-4 py-10 text-foreground sm:px-6">
      <section
        ref={cardRef}
        data-slot="standalone-page-card"
        className={cn(
          "dialog-glass surface-specular-prism w-full rounded-2xl border p-6",
          STANDALONE_MAX_WIDTH_CLASS[maxWidth],
          className,
        )}
      >
        {children}
      </section>
    </div>
  );
}

export function StandalonePageHeader({
  context,
  title,
  description,
  media,
  tone = "default",
}: {
  readonly context?: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly media?: ReactNode;
  readonly tone?: "default" | "error";
}) {
  return (
    <div data-slot="standalone-page-header" data-tone={tone}>
      <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
        <span className="flex items-baseline gap-1.5" role="img" aria-label="Rutico">
          <T3Wordmark animated className="h-3 w-auto shrink-0 text-foreground" aria-hidden />
          {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
          <span className="text-lg font-medium tracking-tight">Rutico</span>
        </span>
        {context ? <span className="text-sm">{context}</span> : null}
      </div>
      {media ? <div className="mt-6 flex justify-start">{media}</div> : null}
      <h1 className={cn("text-xl leading-tight font-semibold", media ? "mt-2" : "mt-6")}>
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

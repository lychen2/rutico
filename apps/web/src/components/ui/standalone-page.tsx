import { useRef, type ReactNode } from "react";

import { useSpecularPointer } from "~/lib/motion/useSpecularPointer";
import { T3Wordmark } from "../T3Wordmark";

export function StandalonePage({ children }: { readonly children: ReactNode }) {
  const cardRef = useRef<HTMLElement>(null);
  useSpecularPointer(cardRef);

  return (
    // The page owns scrolling because root cannot scroll; safe centering keeps oversized cards top-aligned.
    <div className="flex h-full items-center-safe justify-center overflow-y-auto scrollbar-gutter-both bg-background px-4 py-10 text-foreground sm:px-6">
      <section
        ref={cardRef}
        className="dialog-glass surface-specular-prism w-full max-w-xl rounded-2xl border p-6"
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
}: {
  readonly context?: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
        <span className="flex items-baseline gap-1.5" role="img" aria-label="Rutico">
          <T3Wordmark className="h-3 w-auto shrink-0 text-foreground" aria-hidden />
          {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
          <span className="text-lg font-medium tracking-tight">Rutico</span>
        </span>
        {context ? <span className="text-sm">{context}</span> : null}
      </div>
      <h1 className="mt-6 text-xl leading-tight font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </>
  );
}

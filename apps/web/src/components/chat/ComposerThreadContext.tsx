import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { useGT, useLocale } from "gt-react";
import { ComposerBanner } from "./ComposerBanner";

export function ComposerThreadContext({ usage }: { readonly usage: ContextWindowSnapshot | null }) {
  const gt = useGT();
  const locale = useLocale();
  const percent = usage?.usedPercentage == null ? null : Math.round(usage.usedPercentage);
  const contextLabel = gt("Context", { $context: "context window row label" });
  const tokenCount = usage?.usedTokens.toLocaleString(locale);
  const tokenLabel =
    tokenCount === undefined
      ? gt("Not reported")
      : gt("{usedTokens} tokens used", { usedTokens: tokenCount });

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root data-chat-composer-collapsed-controls="true">
        <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 px-2 py-1 @sm:min-h-9">
          {percent === null ? (
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full border border-muted-foreground/45"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-3 shrink-0 place-items-center rounded-full text-primary forced-colors:border"
              style={{ background: `conic-gradient(currentColor ${percent}%, var(--border) 0)` }}
            >
              <span className="size-2 rounded-full bg-(--chat-composer-attached-surface)" />
            </span>
          )}
          <span className="font-medium">{contextLabel}</span>
          <span className="text-muted-foreground tabular-nums">{tokenLabel}</span>
          {percent !== null ? (
            <span className="font-medium tabular-nums">{gt("{used}% used", { used: percent })}</span>
          ) : null}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}

import type { ReactNode } from "react";

import { T, useGT } from "gt-react";
import { CircleAlertIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { DIFF_SURFACE_THEME_UNSAFE_CSS } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";

export const FILE_SURFACE_SUBHEADER_CLASS =
  "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent";

export const FILE_LINK_REVEAL_ATTRIBUTE = "data-file-link-reveal";

export const FILE_LINK_REVEAL_UNSAFE_CSS = `
  ${DIFF_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }

  /* Tint through --diffs-line-bg, not background-color. The editor paints row
     tints on a layer below its text selection; a background on the row itself
     covers the selection and makes selected text on this line invisible. */
  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-line] {
    --diffs-line-bg: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 82%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      )
    ) !important;
  }

  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-column-number] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 60%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      )
    ) !important;
    color: var(--diffs-selection-number-fg) !important;
  }
`;

export function FileSurfaceAction(props: {
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  const pressed = props.pressed;
  return (
    <SharedTooltipTrigger
      render={
        pressed === undefined ? (
          <Button
            type="button"
            className="shrink-0"
            disabled={props.disabled ?? false}
            onClick={props.onPress}
            aria-label={props.label}
            variant="ghost"
            size="icon-sm"
          >
            {props.children}
          </Button>
        ) : (
          <Toggle
            className="shrink-0"
            pressed={pressed}
            disabled={props.disabled ?? false}
            onPressedChange={props.onPress}
            aria-label={props.label}
            variant="ghost"
            size="sm"
          >
            {props.children}
          </Toggle>
        )
      }
      label={props.label}
    />
  );
}

export function FileSurfaceNotice(props: { readonly children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-1.5 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0">{props.children}</span>
    </div>
  );
}

export function FileSurfaceLoading(props: { readonly className?: string }) {
  const gt = useGT();
  return (
    <div
      role="status"
      aria-label={gt("Loading file")}
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center text-muted-foreground",
        props.className,
      )}
    >
      <Spinner size="lg" />
    </div>
  );
}

export function FileSurfaceFailure(props: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <Empty size="compact" role="alert" className="min-h-0">
      <EmptyMedia variant="icon">
        <CircleAlertIcon className="size-4.5 text-destructive" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyDescription>
          <span className="text-destructive">{props.message}</span>
        </EmptyDescription>
      </EmptyHeader>
      {props.onRetry ? (
        <EmptyContent>
          <Button size="xs" variant="outline" onClick={props.onRetry}>
            <RotateCwIcon />
            <T>Try again</T>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

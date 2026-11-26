import { T, useGT } from "gt-react";
import { ChevronDownIcon, ImageIcon, PaperclipIcon } from "lucide-react";
import type { Ref } from "react";

import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { WorkspaceFileDragSummary } from "./workspaceFileDrop";

export function WorkspaceFileDropOverlay(props?: {
  readonly summary?: WorkspaceFileDragSummary | null;
  readonly overlayRef?: Ref<HTMLDivElement>;
}) {
  const gt = useGT();
  const summary = props?.summary ?? null;
  const allImages = summary !== null && summary.total > 0 && summary.imageCount === summary.total;
  const label =
    summary !== null && summary.total > 0
      ? allImages
        ? gt("Drop to attach {count, plural, one {# image} other {# images}}", {
            count: summary.imageCount,
          })
        : gt("Drop to attach {count, plural, one {# file} other {# files}}", {
            count: summary.total,
          })
      : null;

  return (
    <div
      ref={props?.overlayRef}
      className="t3-dropzone-overlay pointer-events-none absolute inset-2 z-40 flex items-center justify-center overflow-hidden rounded-2xl border border-dashed border-primary/55 bg-primary/[0.045]"
      data-chat-workspace-drop-overlay="true"
    >
      <span aria-hidden="true" data-dropzone-halo="true" />
      <span aria-hidden="true" data-dropzone-corner="tl" />
      <span aria-hidden="true" data-dropzone-corner="tr" />
      <span aria-hidden="true" data-dropzone-corner="bl" />
      <span aria-hidden="true" data-dropzone-corner="br" />
      <div
        role="status"
        data-dropzone-pill="true"
        className="t3-dropzone-pill relative z-10 flex items-center gap-2 rounded-full border border-primary/35 bg-popover px-4 py-2.5 text-sm font-medium text-foreground shadow-xl shadow-black/15"
      >
        {allImages ? (
          <ImageIcon className="size-4 text-primary" aria-hidden="true" />
        ) : (
          <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
        )}
        <span>{label ?? <T>Drop files to attach</T>}</span>
      </div>
    </div>
  );
}

export function ScrollToEndButton(props: {
  readonly bottom: number;
  readonly summary: string | null;
  readonly isWorking?: boolean;
  readonly liveStatus?: string | null;
  readonly onScrollToEnd: () => void;
}) {
  const gt = useGT();
  const capsuleText =
    props.summary ?? (props.isWorking ? (props.liveStatus ?? gt("Thinking…")) : null);
  const expanded = capsuleText !== null;
  const label = (
    <>
      <T>Scroll to end</T>
      {capsuleText === null ? null : ` · ${capsuleText}`}
    </>
  );
  const button = (
    <span className="t3-scroll-end-enter inline-flex">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              data-scroll-to-end="true"
              data-scroll-to-end-capsule="true"
              data-scroll-to-end-expanded={expanded ? "true" : "false"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={props.onScrollToEnd}
              className="pointer-events-auto"
              size={expanded ? "sm-pill" : "icon-sm-pill"}
              variant="glass"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
          <span
            aria-hidden="true"
            data-scroll-to-end-label-grid="true"
            data-expanded={expanded ? "true" : "false"}
            className="inline-grid items-center"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
              {expanded ? (
                <span
                  ref={props.isWorking ? observeVisibleAnimation : undefined}
                  aria-hidden="true"
                  data-scroll-to-end-indicator="true"
                  data-scroll-to-end-live={props.isWorking ? "true" : "false"}
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                />
              ) : null}
              <span className="max-w-32 truncate whitespace-nowrap text-xs font-medium leading-none">
                {capsuleText}
              </span>
            </span>
          </span>
          <span className="sr-only">{label}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </span>
  );
  return (
    <div
      className="chat-scroll-to-bottom chat-composer-lane pointer-events-none absolute z-30 flex justify-center py-1.5"
      style={{ bottom: props.bottom }}
    >
      <div className="flex w-full max-w-(--chat-content-max-width) justify-end">{button}</div>
    </div>
  );
}

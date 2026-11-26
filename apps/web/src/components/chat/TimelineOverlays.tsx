import { T, useGT } from "gt-react";
import { ChevronDownIcon, PaperclipIcon } from "lucide-react";

import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function WorkspaceFileDropOverlay() {
  return (
    <div
      className="t3-dropzone-overlay pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035] backdrop-blur-xs"
      data-chat-workspace-drop-overlay="true"
    >
      <div
        role="status"
        className="t3-dropzone-pill dropdown-glass flex items-center gap-2 rounded-full border border-primary/30 px-4 py-2.5 text-sm font-medium text-foreground shadow-xl shadow-black/15"
      >
        <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
        <T>Drop files to attach</T>
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

import { T } from "gt-react";
import { ChevronDownIcon, PaperclipIcon } from "lucide-react";

import { Button } from "../ui/button";

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
  readonly onScrollToEnd: () => void;
}) {
  const button = (
    <span className="t3-scroll-end-enter inline-flex">
      <Button
        data-scroll-to-end="true"
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onScrollToEnd}
        className="pointer-events-auto"
        size="icon-sm-pill"
        variant="glass"
      >
        <ChevronDownIcon aria-hidden className="size-4" />
        <span className="sr-only">
          <T>Scroll to end</T>
          {props.summary === null ? null : ` · ${props.summary}`}
        </span>
      </Button>
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

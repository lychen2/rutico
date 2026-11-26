import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  MousePointerClick,
  PictureInPicture2,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useState,
} from "react";
import { T, useGT } from "gt-react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";
import { cn } from "~/lib/utils";

interface Props {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  inputDisabled?: boolean | undefined;
  /** Owned by the caller so its shortcut handler can focus the address bar directly. */
  urlInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStopLoading: () => void;
  onSubmit: (url: string) => void;
  onOpenInBrowser?: (() => void) | undefined;
  onCapture?: ((record: boolean) => void) | undefined;
  captureDisabled?: boolean | undefined;
  recording?: boolean | undefined;
  onPictureInPicture?: (() => void) | undefined;
  pictureInPicture?: boolean | undefined;
  pictureInPictureDisabled?: boolean | undefined;
  onPickElement?: (() => void) | undefined;
  pickActive?: boolean | undefined;
  pickDisabled?: boolean | undefined;
  pickDisabledReason?: string | undefined;
  trailingActions?: ReactNode;
  leadingActions?: ReactNode;
}

const NOOP = () => {};

export function PreviewChromeRow({
  url,
  loading,
  canGoBack,
  canGoForward,
  refreshDisabled,
  inputDisabled,
  urlInputRef: inputRef,
  onBack,
  onForward,
  onRefresh,
  onStopLoading,
  onSubmit,
  onOpenInBrowser,
  onCapture,
  captureDisabled,
  recording,
  onPictureInPicture,
  pictureInPicture,
  pictureInPictureDisabled,
  onPickElement,
  pickActive,
  pickDisabled,
  pickDisabledReason,
  trailingActions,
  leadingActions,
}: Props) {
  const gt = useGT();
  const [draft, setDraft] = useState(url);
  const [inputFocused, setInputFocused] = useState(false);

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    if (next.length === 0) return;
    onSubmit(next);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <form
        onSubmit={submit}
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <div className="flex items-center gap-0.5" role="group" aria-label={gt("Navigation")}>
          <SharedTooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={canGoBack ? onBack : NOOP}
                disabled={!canGoBack}
                aria-label={gt("Back", { $context: "browser navigation" })}
                type="button"
              />
            }
            label={
              <>
                <T context="browser navigation">Back</T>
              </>
            }
          >
            <ArrowLeft />
          </SharedTooltipTrigger>
          <SharedTooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={canGoForward ? onForward : NOOP}
                disabled={!canGoForward}
                aria-label={gt("Forward", { $context: "browser navigation" })}
                type="button"
              />
            }
            label={
              <>
                <T context="browser navigation">Forward</T>
              </>
            }
          >
            <ArrowRight />
          </SharedTooltipTrigger>
          <SharedTooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={refreshDisabled ? NOOP : loading ? onStopLoading : onRefresh}
                disabled={refreshDisabled}
                aria-label={
                  loading ? gt("Stop", { $context: "stop loading the page" }) : gt("Refresh")
                }
                type="button"
              />
            }
            label={loading ? gt("Stop", { $context: "stop loading the page" }) : gt("Refresh")}
          >
            <RefreshIcon refreshing={loading} />
          </SharedTooltipTrigger>
        </div>

        {leadingActions}

        <div className="group/address flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-border/50 bg-muted/35 transition-[border-color,background-color] duration-150 ease-out hover:border-border/80 has-[input:focus-visible]:border-transparent has-[input:focus-visible]:bg-background motion-reduce:transition-none">
          <InputGroup variant="ghost" className="h-full flex-1">
            <Tooltip disabled={inputFocused || url.trim().length === 0}>
              <TooltipTrigger
                render={
                  <InputGroupInput
                    ref={inputRef}
                    value={inputFocused ? draft : url}
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={() => {
                      setDraft(url);
                      setInputFocused(true);
                      queueMicrotask(() => inputRef.current?.select());
                    }}
                    onBlur={() => {
                      setInputFocused(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.keyCode === 229) {
                        // A trusted Enter would still submit the form implicitly.
                        if (event.key === "Enter") event.preventDefault();
                        return;
                      }
                      if (event.key === "Enter") submit(event);
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft(url);
                        inputRef.current?.blur();
                      }
                    }}
                    placeholder={gt("Search or enter URL")}
                    aria-label={gt("Search or enter URL")}
                    data-workspace-focus-default
                    spellCheck={false}
                    disabled={inputDisabled}
                    data-preview-url-input
                    size="sm"
                  />
                }
              />
              <TooltipPopup side="bottom">{url}</TooltipPopup>
            </Tooltip>
            {onOpenInBrowser && !inputFocused ? (
              <InputGroupAddon align="inline-end">
                <span className="pointer-events-none flex opacity-0 transition-opacity duration-150 ease-out focus-within:pointer-events-auto focus-within:opacity-100 group-hover/address:pointer-events-auto group-hover/address:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
                  <SharedTooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={onOpenInBrowser}
                        aria-label={gt("Open in system browser")}
                        type="button"
                      />
                    }
                    label={<T>Open in system browser</T>}
                  >
                    <ExternalLink />
                  </SharedTooltipTrigger>
                </span>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>

        {onPickElement ? (
          <SharedTooltipTrigger
            render={
              <Button
                variant={pickActive ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={onPickElement}
                disabled={pickDisabled}
                aria-label={pickActive ? gt("Cancel annotation") : gt("Annotate preview")}
                aria-pressed={pickActive ? "true" : "false"}
                type="button"
              />
            }
            label={
              pickDisabled && pickDisabledReason
                ? pickDisabledReason
                : pickActive
                  ? gt("Cancel annotation (Esc)")
                  : gt("Annotate elements, regions, and drawings")
            }
          >
            <MousePointerClick className={cn(pickActive && "text-primary")} />
          </SharedTooltipTrigger>
        ) : null}
        {onCapture ? (
          <SharedTooltipTrigger
            render={
              <Button
                variant={recording ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={(event) => onCapture(event.shiftKey)}
                aria-label={recording ? gt("Stop recording") : gt("Capture screenshot")}
                type="button"
                className="relative"
                disabled={captureDisabled}
              />
            }
            label={recording ? gt("Stop recording") : gt("Screenshot · Shift-click to record")}
          >
            <Camera className={cn(recording && "text-destructive")} />
            {recording ? (
              <span className="absolute right-0.5 top-0.5 size-1.5 motion-safe:animate-status-pulse rounded-full bg-destructive" />
            ) : null}
          </SharedTooltipTrigger>
        ) : null}
        {onPictureInPicture ? (
          <SharedTooltipTrigger
            render={
              <Button
                variant={pictureInPicture ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={onPictureInPicture}
                aria-label={
                  pictureInPicture ? gt("Close floating preview") : gt("Float preview over chat")
                }
                aria-pressed={pictureInPicture ? "true" : "false"}
                type="button"
                disabled={pictureInPictureDisabled}
              />
            }
            label={pictureInPicture ? gt("Close floating preview") : gt("Float preview over chat")}
          >
            <PictureInPicture2 className={cn(pictureInPicture && "text-primary")} />
          </SharedTooltipTrigger>
        ) : null}
        {trailingActions}
      </form>
      <div
        aria-hidden
        data-loading={loading}
        className="preview-loading-progress pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 w-full origin-left rounded-r-full bg-primary shadow-sm shadow-ring/60"
      />
    </div>
  );
}

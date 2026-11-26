import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { reviewCommentRangeText } from "~/lib/composerContextRecords";
import { MessageCircle, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "~/components/pullRequest/PullRequestMarkdownTextarea";
import {
  SpeechTextField,
  TextFieldSpeechControls,
  type TextFieldSpeech,
} from "~/speech/useTextFieldSpeech";
import { cn, isMacPlatform } from "~/lib/utils";
import { textDirection } from "~/textDirection";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

function formatCompactRangePill(rangeLabel: string): string {
  const trimmed = rangeLabel.trim();
  if (!trimmed) return "";
  if (/^L\d/i.test(trimmed)) return trimmed;
  return `L${trimmed.replace("-", "–")}`;
}

interface DiffCommentSecondaryAction {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly allowEmpty?: boolean;
  readonly onAction: (text: string) => void;
}

interface DiffCommentAnnotationProps {
  /** With an environment, the draft can be dictated; its project supplies vocabulary. */
  environmentId?: EnvironmentId | undefined;
  projectId?: ProjectId | null | undefined;
  ownerKey?: string;
  kind: "draft" | "comment";
  rangeLabel: string;
  text: string;
  onTextChange?: (text: string) => void;
  onCancel: () => void;
  onComment: (text: string) => void;
  onDelete?: () => void;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  secondaryAction?: DiffCommentSecondaryAction;
  focusOnMount?: boolean;
  /** Play a one-shot 260ms top-to-bottom accent settle beam right after committing a draft. */
  justCommitted?: boolean;
  onCommitPulseEnd?: () => void;
  /** Set only for pull request comments, where `@` completes the repository's users. */
  completionScope?: PullRequestCompletionScope | null;
}

export function DiffCommentAnnotation({
  environmentId,
  projectId,
  ownerKey,
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder,
  submitLabel,
  pending = false,
  secondaryAction,
  focusOnMount = true,
  justCommitted = false,
  onCommitPulseEnd,
  completionScope = null,
}: DiffCommentAnnotationProps) {
  const gt = useGT();
  const messages = useMessages();
  const [localDraftText, setLocalDraftText] = useState("");
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const compactRangePill = formatCompactRangePill(rangeLabel);
  const submitModLabel =
    typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the draft textarea on the next animation frame after mount
  useLayoutEffect(() => {
    if (kind !== "draft" || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, kind]);

  if (kind === "comment") {
    return (
      <div
        data-diff-comment-annotation
        data-diff-comment-settled={justCommitted ? "true" : undefined}
        onAnimationEnd={justCommitted ? onCommitPulseEnd : undefined}
        className={cn(
          "group/comment relative flex min-w-0 items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground selection:bg-primary selection:text-primary-foreground",
          justCommitted && "diff-comment-card-settled",
        )}
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircle className="size-3.5 h-5 shrink-0 text-primary/70" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          {compactRangePill ? (
            <span className="inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-primary/85">
              {compactRangePill}
            </span>
          ) : null}
          <p
            className="min-w-0 whitespace-pre-wrap text-sm leading-5"
            dir={textDirection(displayedText)}
          >
            {displayedText}
          </p>
        </div>
        {onDelete ? (
          <span className="-my-1 -mr-1 flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Delete comment")}
              onClick={onDelete}
            >
              <Trash2 className="size-3" />
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  const submit = (
    speech: TextFieldSpeech | undefined,
    action: (text: string) => void,
    allowEmpty = false,
  ) => {
    const finish = (value: string) => {
      if (!pending && (allowEmpty || value.trim())) action(value.trim());
    };
    if (speech) speech.submitAfterDictation(finish);
    else finish(displayedText);
  };

  // Pierre hides native carets and selection; textarea comments need their own visible feedback.
  const renderDraft = (speech?: TextFieldSpeech) => (
    <div
      data-diff-comment-annotation
      data-diff-comment-draft="true"
      className="diff-comment-draft-bloom mx-2 my-1 rounded-lg border border-border/75 bg-card p-2.5 font-sans text-foreground shadow-sm caret-foreground selection:bg-primary selection:text-primary-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {compactRangePill ? (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-sm border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">
            {compactRangePill}
          </span>
        </div>
      ) : null}
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={completionScope}
        readOnly={speech?.freezesEditor}
        autoFocus={focusOnMount}
        size="sm"
        value={displayedText}
        dir={textDirection(displayedText)}
        placeholder={placeholder ?? gt("Add a comment…")}
        aria-label={gt("Comment on lines {rangeLabel}", {
          rangeLabel: reviewCommentRangeText(rangeLabel, messages),
        })}
        onValueChange={onTextChange ?? setLocalDraftText}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          // Unclaimed, an IME Escape would close the right panel sheet or leave the pull requests page.
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            event.stopPropagation();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            if (speech && speech.state.phase !== "idle") speech.cancel();
            else onCancel();
          }
          if (isCommentSubmitShortcut(event, trimmedText, pending, speech?.blocksSubmission)) {
            event.preventDefault();
            submit(speech, onComment);
          }
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-auto inline-flex items-center gap-1.5 text-3xs text-muted-foreground/75">
          <KbdGroup>
            <Kbd>{submitModLabel}</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          <span>
            <T>to send</T>
          </span>
        </span>
        {speech ? <TextFieldSpeechControls speech={speech} disabled={pending} /> : null}
        <Button variant="ghost-muted" size="xs" onClick={onCancel}>
          <T>Cancel</T>
        </Button>
        {secondaryAction ? (
          <Button
            size="xs"
            variant="outline"
            disabled={
              speech?.preparing ||
              pending ||
              (!speech?.blocksSubmission && !secondaryAction.allowEmpty && !trimmedText)
            }
            onClick={() => submit(speech, secondaryAction.onAction, secondaryAction.allowEmpty)}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button
          size="xs"
          disabled={speech?.preparing || pending || (!speech?.blocksSubmission && !trimmedText)}
          onClick={() => submit(speech, onComment)}
        >
          {submitLabel ?? gt("Comment", { $context: "verb, submit button" })}
        </Button>
      </div>
    </div>
  );

  return environmentId ? (
    <SpeechTextField
      environmentId={environmentId}
      projectId={projectId}
      ownerKey={ownerKey ?? rangeLabel}
      text={displayedText}
      textareaRef={textareaRef}
      onTextChange={onTextChange ?? setLocalDraftText}
      disabled={pending}
    >
      {renderDraft}
    </SpeechTextField>
  ) : (
    renderDraft()
  );
}

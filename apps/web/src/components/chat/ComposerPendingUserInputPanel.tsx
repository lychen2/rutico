import { type RuntimeRequestId, type ScopedThreadRef } from "@t3tools/contracts";
import { markdownProseDirection, textDirection } from "~/textDirection";
import { useGT } from "gt-react";
import { memo, use, useEffect, useEffectEvent, useRef, useState } from "react";
import { BackgroundThreadContext } from "./backgroundThread";
import { useStableCallback } from "~/hooks/useStableCallback";
import { type PendingUserInput } from "../../session-logic";
import type { PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { derivePendingUserInputProgress } from "../../pendingUserInput";
import { CheckboxMark } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Kbd } from "../ui/kbd";
import { cn } from "~/lib/utils";
import { isInSideChatPane } from "~/lib/sideChatPane";
import { AnimatedHeight } from "../AnimatedHeight";
import { ComposerBanner } from "./ComposerBanner";
import ChatMarkdown from "../ChatMarkdown";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled?: boolean;
  respondingRequestIds: RuntimeRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  cwd,
  threadRef,
  disabled = false,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      cwd={cwd}
      threadRef={threadRef}
      disabled={disabled}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  cwd,
  threadRef,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: {
  prompt: PendingUserInput;
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}) {
  const gt = useGT();
  // Message-mode requests remain answerable after their provider turn ends.
  const canRespond = prompt.responseCapability !== "not_resumable";
  const responseDisabled = disabled || isResponding || !canRespond;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const kbdPressTimerRef = useRef<number | null>(null);
  const advance = useStableCallback(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  const [pressedOption, setPressedOption] = useState<{
    readonly questionId: string;
    readonly optionIndex: number;
    readonly viaKeyboard: boolean;
  } | null>(null);
  const [stepTransition, setStepTransition] = useState<{
    readonly index: number;
    readonly direction: "initial" | "forward" | "backward";
  }>({ index: questionIndex, direction: "initial" });
  if (stepTransition.index !== questionIndex) {
    setStepTransition({
      index: questionIndex,
      direction: questionIndex > stepTransition.index ? "forward" : "backward",
    });
  }
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  // Keep question identity stable for its shortcut listener.
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  // Read before later hooks to preserve the question's compiler cache.
  const draftSelectedOptions = activeQuestion?.options.map(
    (option) =>
      !customAnswerActive && progress.selectedOptionValues.includes(option.value ?? option.label),
  );
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;

  if (
    optimisticSingleSelect &&
    activeQuestion &&
    !activeQuestion.multiSelect &&
    (optimisticSingleSelect.questionId !== activeQuestion.id ||
      (!customAnswerActive &&
        progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)))
  ) {
    setOptimisticSingleSelect(null);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the auto-advance and physical Kbd press timers when the question changes, input is disabled, or the panel unmounts
  useEffect(() => {
    const clearTimers = () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      if (kbdPressTimerRef.current !== null) {
        window.clearTimeout(kbdPressTimerRef.current);
        kbdPressTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearTimers();
    return clearTimers;
  }, [activeQuestion?.id, disabled]);

  const pulseOptionFeedback = (questionId: string, optionIndex: number, viaKeyboard: boolean) => {
    setPressedOption({ questionId, optionIndex, viaKeyboard });
    if (kbdPressTimerRef.current !== null) {
      window.clearTimeout(kbdPressTimerRef.current);
    }
    kbdPressTimerRef.current = window.setTimeout(() => {
      kbdPressTimerRef.current = null;
      setPressedOption((current) =>
        current?.questionId === questionId && current.optionIndex === optionIndex ? null : current,
      );
    }, 140);
  };

  const handleOptionSelection = (
    questionId: string,
    optionValue: string,
    optionIndex: number,
    viaKeyboard = false,
  ) => {
    if (disabled || isResponding) return;
    pulseOptionFeedback(questionId, optionIndex, viaKeyboard);
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionValue);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionValue });
    onToggleOption(questionId, optionValue);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advance();
    }, 200);
  };

  const selectOptionFromShortcut = useEffectEvent(handleOptionSelection);
  const backgroundThread = use(BackgroundThreadContext);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a document keydown listener for digit shortcuts while a question is answerable
  useEffect(() => {
    if (!activeQuestion || responseDisabled || isCollapsed || backgroundThread) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (isInSideChatPane(target)) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest(
          'select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [aria-modal="true"], [role="menu"], [role="combobox"], [data-slot$="popup"]',
        )
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      selectOptionFromShortcut(activeQuestion.id, option.value ?? option.label, optionIndex, true);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, backgroundThread, isCollapsed, responseDisabled]);

  if (!activeQuestion) {
    return null;
  }

  const promptDirection = markdownProseDirection(
    prompt.questions
      .flatMap((question) => [
        question.header,
        question.question,
        ...question.options.flatMap((option) => [option.label, option.description ?? ""]),
      ])
      .join(" "),
  );
  const questionTextAlign = promptDirection === "rtl" ? "text-right" : "text-left";

  return (
    <Collapsible
      dir={promptDirection}
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
      }}
    >
      <CollapsibleTrigger
        render={<ComposerBanner.Row render={<button type="button" />} />}
        title={
          isCollapsed
            ? gt("Show the question and its options")
            : gt("Hide the question and its options")
        }
        data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
        className="px-4 py-1.5"
      >
        <ComposerBanner.Content>
          <span
            className={cn("min-w-0 truncate text-muted-foreground", isCollapsed && "max-w-1/2")}
            dir={textDirection(activeQuestion.header)}
          >
            {activeQuestion.header}
          </span>
          {isCollapsed ? (
            <>
              <ComposerBanner.Separator />
              <span
                className={cn("min-w-0 flex-1 truncate text-secondary-label", questionTextAlign)}
                dir={markdownProseDirection(activeQuestion.question)}
              >
                {activeQuestion.question}
              </span>
            </>
          ) : null}
        </ComposerBanner.Content>
        <ComposerBanner.Actions className="gap-0">
          {prompt.questions.length > 1 ? (
            <ComposerBanner.Count>
              {questionIndex + 1}/{prompt.questions.length}
            </ComposerBanner.Count>
          ) : null}
          <ComposerBanner.ToggleIcon expanded={!isCollapsed} />
          {prompt.dismissible ? (
            <ComposerBanner.Dismiss
              render={<span role="button" tabIndex={0} />}
              aria-label={gt("Dismiss question without answering")}
              title={gt("Dismiss question without answering")}
              disabled={isResponding}
              data-pending-user-input-dismiss
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
            />
          ) : null}
        </ComposerBanner.Actions>
      </CollapsibleTrigger>
      {prompt.questions.length > 1 ? (
        <div
          aria-hidden="true"
          data-question-progress-bar="true"
          className="flex items-center gap-1 px-4 pb-1"
        >
          {prompt.questions.map((question, stepIdx) => (
            <span
              key={question.id}
              data-question-progress-segment={
                stepIdx < questionIndex ? "done" : stepIdx === questionIndex ? "active" : "pending"
              }
              className={cn(
                "h-0.5 flex-1 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
                stepIdx < questionIndex
                  ? "bg-primary/65"
                  : stepIdx === questionIndex
                    ? "bg-primary"
                    : "bg-border/65",
              )}
            />
          ))}
        </div>
      ) : null}
      <CollapsiblePanel>
        <ComposerBanner.Scroll>
          <AnimatedHeight contentKey={activeQuestion.id}>
            <ComposerBanner.Body
              key={activeQuestion.id}
              data-question-step-direction={stepTransition.direction}
              className="ps-6 pe-4 pb-1 wrap-anywhere sm:ps-5.5"
            >
              <ChatMarkdown
                text={activeQuestion.question}
                cwd={cwd}
                threadRef={threadRef}
                lineBreaks
                className={cn("pt-0.5 text-foreground/85", questionTextAlign)}
              />
              {/* Rows span the header row's width so the radios align with the question text and the shortcut column sits under the dismiss button. */}
              <div className="-ms-2 mt-1.5 sm:-ms-1.5">
                {activeQuestion.options.map((option, index) => {
                  const optionValue = option.value ?? option.label;
                  const isOptimisticallySelected =
                    optimisticSingleSelect?.questionId === activeQuestion.id &&
                    optimisticSingleSelect.optionValue === optionValue;
                  const isSelected =
                    isOptimisticallySelected || draftSelectedOptions?.[index] === true;
                  const isOptionPulsing =
                    pressedOption?.questionId === activeQuestion.id &&
                    pressedOption.optionIndex === index;
                  const isKbdPressed = isOptionPulsing && pressedOption.viaKeyboard;
                  const className = cn(
                    questionTextAlign,
                    "group relative flex w-full items-start gap-2.5 overflow-hidden rounded-md bg-transparent py-1.5 ps-2 sm:ps-1.5 outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.995] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25",
                    isSelected
                      ? "bg-primary/[0.06] text-foreground"
                      : "text-foreground/70 hover:bg-muted/35 hover:text-foreground/90",
                    (disabled || isResponding) && "opacity-50 cursor-not-allowed",
                    !disabled && !isResponding && "cursor-pointer",
                  );
                  // The h-5 slots match the label's line box, so the indicator and shortcut stay on its first line.
                  const content = (
                    <>
                      <span className="pointer-events-none flex h-5 shrink-0 items-center">
                        {activeQuestion.multiSelect ? (
                          <CheckboxMark checked={isSelected} variant="contrast" />
                        ) : (
                          <OptionRadio checked={isSelected} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span className="text-sm font-medium" dir={textDirection(option.label)}>
                          {option.label}
                        </span>
                        {option.description && option.description !== option.label ? (
                          <span
                            className="text-secondary-label text-2xs"
                            dir={textDirection(option.description)}
                          >
                            {option.description}
                          </span>
                        ) : null}
                      </div>
                      {index < 9 ? (
                        <span
                          data-question-kbd-slot="true"
                          data-kbd-pressed={isKbdPressed ? "true" : undefined}
                          className="flex h-5 w-7 shrink-0 items-center justify-center sm:w-6"
                        >
                          <Kbd>{index + 1}</Kbd>
                        </span>
                      ) : null}
                    </>
                  );
                  // The preview sits outside the button: it can hold links, and a click on a single-select option advances.
                  return (
                    <div key={`${activeQuestion.id}:${optionValue}`}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        data-question-option-row="true"
                        data-option-ripple={isOptionPulsing ? "true" : undefined}
                        disabled={disabled || isResponding}
                        onClick={() => {
                          handleOptionSelection(activeQuestion.id, optionValue, index, false);
                        }}
                        className={className}
                      >
                        {content}
                      </button>
                      {option.preview ? (
                        <ChatMarkdown
                          text={option.preview}
                          cwd={cwd}
                          threadRef={threadRef}
                          lineBreaks
                          className="ps-9 pe-2 pb-1.5 text-xs text-foreground/70 sm:ps-8"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </ComposerBanner.Body>
          </AnimatedHeight>
        </ComposerBanner.Scroll>
      </CollapsiblePanel>
    </Collapsible>
  );
});

// Drawn with ui/radio-group's look instead of using its Radio: Radio only checks inside a
// RadioGroup, whose arrow keys select options and would trip the single-select auto-advance.
function OptionRadio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-foreground/55 bg-background not-dark:bg-clip-padding sm:size-4 dark:bg-input/32",
        checked ? "shadow-none" : "shadow-xs/5",
      )}
    >
      {checked ? (
        <span className="t3-icon-pop -inset-px absolute flex items-center justify-center rounded-full bg-primary before:size-2 before:rounded-full before:bg-primary-foreground sm:before:size-1.5" />
      ) : null}
    </span>
  );
}

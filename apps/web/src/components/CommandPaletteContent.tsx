import { T } from "gt-react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import { Command, CommandFooter, CommandInput, CommandPanel } from "./ui/command";
import { Kbd, KbdGroup } from "./ui/kbd";

/**
 * A view replacing another inside an open dialog mounts with focus on the body,
 * left there by the removed input. Claim it so typing cannot reach the composer
 * behind the modal. On first open the dialog's own initial focus handles it.
 */
function claimFocusInOpenDialog(input: HTMLInputElement) {
  const active = input.ownerDocument.activeElement;
  if (
    active === null ||
    active === input.ownerDocument.body ||
    input.closest('[role="dialog"]')?.contains(active)
  ) {
    input.focus();
  }
}

export interface PendingInputSelection {
  readonly value: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly direction: "forward" | "backward" | "none" | null;
}

function restorePendingSelection(
  input: HTMLInputElement,
  pendingSelectionRef: RefObject<PendingInputSelection | null> | undefined,
) {
  const selection = pendingSelectionRef?.current;
  if (!pendingSelectionRef || !selection) return;
  pendingSelectionRef.current = null;
  if (input.value !== selection.value) return;
  input.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
}

export type CommandViewTransitionDirection = "none" | "push" | "pop";

type CommandPaletteContentProps = Omit<ComponentProps<typeof Command>, "children"> & {
  readonly breadcrumbLabel?: ReactNode;
  readonly children: ReactNode;
  readonly consumePreviousPanelHeight?: (nextHeight: number) => number | null;
  readonly escapeLabel?: ReactNode;
  readonly footerActionLabel?: ReactNode;
  readonly footerTrailing?: ReactNode;
  readonly heightBucket?: number;
  readonly inputAccessory?: ReactNode;
  readonly inputProps: ComponentProps<typeof CommandInput>;
  readonly onBack?: () => void;
  readonly pendingSelectionRef?: RefObject<PendingInputSelection | null>;
  readonly panelSize?: "list" | "tall-list" | "fill";
  readonly showBackHint?: boolean;
  readonly testId?: string;
  readonly viewTransition?: CommandViewTransitionDirection;
  readonly viewTransitionKey?: string | number;
};

export function CommandPaletteContent({
  breadcrumbLabel,
  children,
  consumePreviousPanelHeight,
  escapeLabel,
  footerActionLabel,
  footerTrailing,
  heightBucket,
  inputAccessory,
  inputProps,
  onBack,
  pendingSelectionRef,
  panelSize = "list",
  showBackHint,
  testId,
  viewTransition = "none",
  viewTransitionKey,
  ...commandProps
}: CommandPaletteContentProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const localPreviousHeightRef = useRef<number | null>(null);
  const lastMorphKeyRef = useRef<string | null>(null);
  const heightAnimationRef = useRef<Animation | null>(null);
  const morphKey = `${viewTransitionKey ?? ""}:${heightBucket ?? ""}`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- discrete WAAPI container height morph across view/result buckets without ResizeObserver loops
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || panelSize === "fill" || lastMorphKeyRef.current === morphKey) return;
    lastMorphKeyRef.current = morphKey;
    const nextHeight = Math.ceil(panel.offsetHeight);
    const prevHeight = consumePreviousPanelHeight
      ? consumePreviousPanelHeight(nextHeight)
      : (() => {
          const previous = localPreviousHeightRef.current;
          localPreviousHeightRef.current = nextHeight;
          return previous;
        })();

    // 0ms open latency: skip container height morph on initial mount.
    if (prevHeight === null || nextHeight <= 0 || Math.abs(nextHeight - prevHeight) < 6) {
      return;
    }
    if (prefersReducedMotion() || typeof panel.animate !== "function") {
      return;
    }

    heightAnimationRef.current?.cancel();
    const timing = getSpringWaapiTiming("snappy");
    const animation = panel.animate(
      [
        { height: `${prevHeight}px`, overflow: "clip" },
        { height: `${nextHeight}px`, overflow: "clip" },
      ],
      {
        duration: Math.min(260, timing.duration),
        easing: timing.easing,
      },
    );
    heightAnimationRef.current = animation;
    return () => {
      animation.cancel();
      if (heightAnimationRef.current === animation) {
        heightAnimationRef.current = null;
      }
    };
  }, [consumePreviousPanelHeight, morphKey, panelSize]);

  return (
    <div className="contents" data-testid={testId}>
      <Command {...commandProps}>
        <div className="flex min-h-0 flex-1 flex-col">
          {showBackHint && breadcrumbLabel ? (
            <div
              data-slot="command-breadcrumb-bar"
              className="flex items-center gap-1.5 border-b border-foreground/[0.06] px-3.5 py-1.5"
            >
              <button
                type="button"
                tabIndex={-1}
                data-slot="command-breadcrumb-pill"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={onBack}
                className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-120 hover:bg-foreground/[0.1] hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{breadcrumbLabel}</span>
              </button>
            </div>
          ) : null}
          <div className="relative">
            <CommandInput
              autoFocus={false}
              {...inputProps}
              ref={(input) => {
                if (!input) return;
                restorePendingSelection(input, pendingSelectionRef);
                claimFocusInOpenDialog(input);
              }}
            />
            {inputAccessory}
          </div>
          <CommandPanel
            ref={panelRef}
            className={
              panelSize === "fill"
                ? "flex min-h-0 flex-1 flex-col"
                : panelSize === "tall-list"
                  ? "max-h-[min(34rem,76vh)]"
                  : "flex max-h-[min(28rem,70vh)] min-h-0 flex-col"
            }
          >
            <div
              data-command-view-transition={viewTransition}
              className="flex min-h-0 flex-1 flex-col"
            >
              {children}
            </div>
          </CommandPanel>
        </div>
        <CommandFooter className="max-sm:flex-col max-sm:items-start">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <KbdGroup>
              <Kbd reactiveKey="ArrowUp">
                <ArrowUpIcon />
              </Kbd>
              <Kbd reactiveKey="ArrowDown">
                <ArrowDownIcon />
              </Kbd>
              <span>
                <T>Navigate</T>
              </span>
            </KbdGroup>
            {footerActionLabel !== undefined ? (
              <KbdGroup>
                <Kbd reactiveKey="Enter">↵</Kbd>
                <span>{footerActionLabel}</span>
              </KbdGroup>
            ) : null}
            {showBackHint ? (
              <KbdGroup>
                <Kbd reactiveKey="Backspace">⌫</Kbd>
                <span>
                  <T>Back</T>
                </span>
              </KbdGroup>
            ) : null}
            <KbdGroup>
              <Kbd reactiveKey="Escape">Esc</Kbd>
              <span>{escapeLabel ?? <T>Close</T>}</span>
            </KbdGroup>
          </div>
          {footerTrailing}
        </CommandFooter>
      </Command>
    </div>
  );
}

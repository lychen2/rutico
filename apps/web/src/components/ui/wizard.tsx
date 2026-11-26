import { useGT } from "gt-react";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { getSpringWaapiTiming, prefersReducedMotion } from "../../lib/motion/springs";
import { useSharedIndicator } from "../../lib/motion/useSharedIndicator";
import { cn } from "../../lib/utils";
import { AnimatedHeight } from "../AnimatedHeight";
import { DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog";
import { ScrollArea } from "./scroll-area";

type WizardStepListener = (step: number, direction: 1 | -1) => void;

function createWizardStepBus() {
  let currentStep: number | null = null;
  const listeners = new Set<WizardStepListener>();
  return {
    publish(nextStep: number) {
      if (currentStep === null) {
        currentStep = nextStep;
        return;
      }
      if (currentStep === nextStep) return;
      const direction: 1 | -1 = nextStep > currentStep ? 1 : -1;
      currentStep = nextStep;
      for (const listener of listeners) listener(nextStep, direction);
    },
    subscribe(listener: WizardStepListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type WizardStepBus = ReturnType<typeof createWizardStepBus>;
const WizardStepBusContext = createContext<WizardStepBus | null>(null);

export function WizardPopup({
  children,
  size = "default",
  ...props
}: Omit<ComponentProps<typeof DialogPopup>, "className" | "style"> & {
  readonly size?: "default" | "wide";
}) {
  const [stepBus] = useState(createWizardStepBus);
  return (
    <WizardStepBusContext value={stepBus}>
      <DialogPopup {...props} className={size === "wide" ? "max-w-3xl" : "max-w-xl"}>
        <ScrollArea className="*:data-[slot=scroll-area-scrollbar]:data-[orientation=vertical]:my-4">
          <div className="flex min-h-0 flex-col">{children}</div>
        </ScrollArea>
      </DialogPopup>
    </WizardStepBusContext>
  );
}

export function WizardHeader({
  title,
  description,
  identity,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly identity?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <DialogHeader>
      <DialogTitle className={identity ? "sr-only" : undefined}>{title}</DialogTitle>
      {identity}
      {description ? <DialogDescription>{description}</DialogDescription> : null}
      {children}
    </DialogHeader>
  );
}

export function WizardFooter({
  children,
  leading,
}: {
  readonly children: ReactNode;
  readonly leading?: ReactNode;
}) {
  return (
    <DialogFooter variant="bare" className={leading ? "sm:justify-between" : undefined}>
      {leading}
      {leading ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row">{children}</div>
      ) : (
        children
      )}
    </DialogFooter>
  );
}

export function WizardSteps({
  steps,
  currentStep,
  summaries,
  showSummaries = false,
  onStepChange,
  isStepDisabled,
}: {
  readonly steps: readonly string[];
  readonly currentStep: number;
  readonly summaries?: readonly (string | null)[];
  readonly showSummaries?: boolean;
  readonly isStepDisabled?: (step: number) => boolean;
  readonly onStepChange?: (step: number) => void;
}) {
  const gt = useGT();
  const stepBus = use(WizardStepBusContext);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const Step = onStepChange ? "button" : "div";

  useSharedIndicator({
    containerRef,
    indicatorRef,
    activeSelector: '[aria-current="step"]',
    activeKey: currentStep,
    preset: "fluid",
    maxSquash: 0.12,
    axis: "x",
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- notifies WizardPanel of step direction changes without re-rendering WizardPopup
  useLayoutEffect(() => {
    stepBus?.publish(currentStep);
  }, [currentStep, stepBus]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl bg-background p-1 ring-1 ring-black/5 dark:bg-white/4 dark:ring-white/5"
      data-slot="wizard-steps"
    >
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-0 rounded-lg bg-card opacity-0 shadow-xs ring-1 ring-inset ring-black/5 dark:shadow-none dark:ring-white/8"
        data-slot="wizard-step-indicator"
      />
      <ol
        className="relative z-1 grid auto-cols-fr grid-flow-col gap-1"
        role="list"
        aria-label={gt("Setup progress")}
      >
        {steps.map((step, index) => (
          <li key={step} className="min-w-0">
            <Step
              {...(onStepChange
                ? { type: "button" as const, disabled: isStepDisabled?.(index) }
                : {})}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none max-sm:justify-center max-sm:px-2",
                onStepChange &&
                  "cursor-pointer hover:bg-card/60 disabled:cursor-default disabled:hover:bg-transparent",
                index === currentStep &&
                  "text-foreground hover:bg-transparent in-[[data-slot=wizard-steps]:not(:has([data-slot=wizard-step-indicator][data-indicator-ready=true]))]:bg-card",
              )}
              aria-current={index === currentStep ? "step" : undefined}
              aria-label={
                index < currentStep && summaries?.[index]
                  ? gt("{step}, step {number}, {summary}", {
                      step,
                      number: index + 1,
                      summary: summaries[index],
                    })
                  : gt("{step}, step {number}", { step, number: index + 1 })
              }
              onClick={onStepChange ? () => onStepChange(index) : undefined}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-sm font-medium ring-1 transition-colors duration-180 ease-out motion-reduce:transition-none",
                  index < currentStep
                    ? "bg-success/15 text-success ring-success/35"
                    : index === currentStep
                      ? "bg-primary/10 text-primary ring-primary/30"
                      : "bg-card text-muted-foreground ring-black/10 dark:bg-white/5 dark:ring-white/10",
                )}
                aria-hidden
              >
                {index < currentStep ? (
                  <svg
                    className="size-3.5 shrink-0 text-current"
                    fill="none"
                    height="24"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.75"
                    viewBox="0 0 24 24"
                    width="24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      className="motion-safe:animate-check-draw"
                      d="M5.252 12.7 10.2 18.63 18.748 5.37"
                      pathLength={12}
                      strokeDasharray={12}
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-sm font-medium max-sm:hidden",
                  index === currentStep ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step}
                {showSummaries && index < currentStep && summaries?.[index]
                  ? `: ${summaries[index]}`
                  : null}
              </span>
            </Step>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WizardPanel({
  children,
  holdHeight = false,
  stepKey,
  className,
}: {
  readonly children: ReactNode;
  readonly holdHeight?: boolean;
  readonly stepKey?: string | number;
  readonly className?: string;
}) {
  const stepBus = use(WizardStepBusContext);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to WizardSteps direction changes to run directional WAAPI slide-in
  useEffect(() => {
    if (!stepBus) return;
    let activeAnimation: Animation | null = null;
    const unsubscribe = stepBus.subscribe((_step, direction) => {
      const node = contentRef.current;
      if (!node || typeof node.animate !== "function" || prefersReducedMotion()) return;
      activeAnimation?.cancel();
      const timing = getSpringWaapiTiming("spatial");
      const offsetPx = direction * 16;
      activeAnimation = node.animate(
        [
          { opacity: 0, transform: `translate3d(${offsetPx}px, 0, 0)` },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ],
        { duration: Math.min(240, timing.duration), easing: timing.easing },
      );
    });
    return () => {
      unsubscribe();
      activeAnimation?.cancel();
    };
  }, [stepBus]);

  return (
    <div
      data-slot="dialog-panel"
      className={cn(
        "min-w-0 space-y-4 bg-background/80 px-6 py-5 ring-1 ring-black/5 dark:bg-white/2 dark:ring-white/5",
        className,
      )}
    >
      <AnimatedHeight
        {...(stepKey !== undefined ? { contentKey: stepKey } : {})}
        holdHeight={holdHeight}
      >
        <div ref={contentRef} className="min-w-0 space-y-4" data-slot="wizard-panel-content">
          {children}
        </div>
      </AnimatedHeight>
    </div>
  );
}

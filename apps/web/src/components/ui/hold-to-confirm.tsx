import { useGT } from "gt-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { prefersReducedMotion } from "~/lib/motion/springs";
import { cn } from "~/lib/utils";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

const DEFAULT_HOLD_DURATION_MS = 1400;
const REDUCED_MOTION_ARM_TIMEOUT_MS = 4000;

export interface HoldToConfirmButtonProps {
  readonly onConfirm: () => void;
  readonly children: ReactNode;
  readonly holdLabel?: ReactNode;
  readonly armedLabel?: ReactNode;
  readonly durationMs?: number;
  readonly disabled?: boolean;
  readonly size?: ButtonSize;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly "aria-label"?: string;
}

/** Asymmetric hold-to-confirm button: honest linear clip-path charge, rapid 180ms cancel snap. */
export function HoldToConfirmButton({
  onConfirm,
  children,
  holdLabel,
  armedLabel,
  durationMs = DEFAULT_HOLD_DURATION_MS,
  disabled = false,
  size = "default",
  variant = "destructive-outline",
  className,
  style,
  "aria-label": ariaLabel,
}: HoldToConfirmButtonProps) {
  const gt = useGT();
  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const committedViaHoldRef = useRef(false);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const clearArmTimer = () => {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  };

  const cancelHold = () => {
    clearHoldTimer();
    activePointerIdRef.current = null;
    activeKeyRef.current = null;
    setHolding(false);
  };

  const beginHold = () => {
    if (disabled) return;
    clearHoldTimer();
    committedViaHoldRef.current = false;
    setHolding(true);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      activePointerIdRef.current = null;
      activeKeyRef.current = null;
      committedViaHoldRef.current = true;
      setHolding(false);
      setArmed(false);
      clearArmTimer();
      onConfirm();
    }, durationMs);
  };

  const handleTwoStepConfirm = () => {
    if (disabled) return;
    if (armed) {
      clearArmTimer();
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    clearArmTimer();
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null;
      setArmed(false);
    }, REDUCED_MOTION_ARM_TIMEOUT_MS);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears hold and disarm timers on unmount or disable
  useEffect(() => {
    const clearPendingTimers = () => {
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (armTimerRef.current !== null) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
      activePointerIdRef.current = null;
      activeKeyRef.current = null;
    };
    if (disabled) clearPendingTimers();
    return clearPendingTimers;
  }, [disabled]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    if (prefersReducedMotion()) return;
    activePointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may not provide a capturable pointerId.
    }
    beginHold();
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    cancelHold();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Escape" && (holding || armed)) {
      event.preventDefault();
      cancelHold();
      clearArmTimer();
      setArmed(false);
      return;
    }
    if (event.key !== " " && event.key !== "Enter") return;
    if (prefersReducedMotion()) return;
    event.preventDefault();
    if (event.repeat || activeKeyRef.current !== null) return;
    activeKeyRef.current = event.key;
    beginHold();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (activeKeyRef.current === event.key) {
      cancelHold();
    }
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (committedViaHoldRef.current) {
      committedViaHoldRef.current = false;
      event.preventDefault();
      return;
    }
    // Assistive tech virtual clicks (detail === 0 without active pointer/key hold) and
    // prefers-reduced-motion use an explicit two-click confirmation instead of sustained hold.
    if (prefersReducedMotion() || event.detail === 0) {
      handleTwoStepConfirm();
    }
  };

  const activePrompt = armed ? (armedLabel ?? gt("Click again to confirm")) : children;
  const fillContent = holdLabel ?? activePrompt;

  return (
    <Button
      aria-label={ariaLabel}
      aria-pressed={holding || armed}
      className={cn("overflow-hidden select-none", className)}
      data-armed={armed ? "true" : undefined}
      data-holding={holding ? "true" : undefined}
      data-slot="hold-to-confirm"
      disabled={disabled}
      onBlur={() => {
        cancelHold();
        clearArmTimer();
        setArmed(false);
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onLostPointerCapture={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      size={size}
      style={
        {
          "--hold-duration": `${durationMs}ms`,
          ...style,
        } as CSSProperties
      }
      variant={armed ? "destructive" : variant}
    >
      <span className="relative z-1 inline-flex items-center justify-center gap-2">
        {activePrompt}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-2 inline-flex items-center justify-center gap-2 bg-destructive text-white"
        data-holding={holding ? "true" : undefined}
        data-slot="hold-to-confirm-fill"
      >
        {fillContent}
      </span>
    </Button>
  );
}

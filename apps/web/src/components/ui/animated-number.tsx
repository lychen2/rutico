import { useLayoutEffect, useRef } from "react";

import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import { cn } from "~/lib/utils";

export interface AnimatedNumberProps {
  readonly value: number;
  /** Optional formatter; defaults to integer/decimal string representation. */
  readonly format?: (value: number) => string;
  readonly className?: string;
  /** Announce changes politely to assistive tech via a dedicated live region. */
  readonly announce?: boolean;
}

export interface AnimatedNumberSlot {
  readonly key: string;
  readonly char: string;
  readonly isDigit: boolean;
}

/**
 * Split a formatted numeric string into right-aligned stable character slots so
 * adding a tens/hundreds digit only shifts new leading digits without re-rolling existing ones.
 */
export function splitNumberSlots(formatted: string): AnimatedNumberSlot[] {
  const chars = Array.from(formatted);
  const length = chars.length;
  return chars.map((char, index) => {
    const isDigit = char >= "0" && char <= "9";
    const fromRight = length - 1 - index;
    return {
      key: isDigit ? `d-${fromRight}` : `s-${fromRight}-${char}`,
      char,
      isDigit,
    };
  });
}

function RollingDigit({
  char,
  numericValue,
}: {
  readonly char: string;
  readonly numericValue: number;
}) {
  const digitRef = useRef<HTMLSpanElement | null>(null);
  const previousRef = useRef({ char, numericValue });
  const animationRef = useRef<Animation | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates individual digit roll via WAAPI when its glyph changes
  useLayoutEffect(() => {
    const prev = previousRef.current;
    previousRef.current = { char, numericValue };
    if (prev.char === char) return;

    const node = digitRef.current;
    if (!node || typeof node.animate !== "function" || prefersReducedMotion()) return;

    animationRef.current?.cancel();
    const timing = getSpringWaapiTiming("snappy");
    const direction = numericValue >= prev.numericValue ? 1 : -1;
    const enterY = direction >= 0 ? "0.72em" : "-0.72em";
    const animation = node.animate(
      [
        { opacity: 0.2, transform: `translate3d(0, ${enterY}, 0)` },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      {
        duration: Math.min(260, timing.duration),
        easing: timing.easing,
      },
    );
    animationRef.current = animation;
    return () => {
      animation.cancel();
      if (animationRef.current === animation) {
        animationRef.current = null;
      }
    };
  }, [char, numericValue]);

  return (
    <span data-slot="animated-number-reel" className="inline-flex overflow-hidden align-top">
      <span ref={digitRef} className="inline-block will-change-transform">
        {char}
      </span>
    </span>
  );
}

/**
 * Mechanical digit-rolling number primitive (Max Barvian *NumberFlow* inspired).
 * Only rolls changed digit slots with `tabular-nums`, soft vertical edge masking,
 * expanded WAAPI `linear()` springs, and full `prefers-reduced-motion` support.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  announce = false,
}: AnimatedNumberProps) {
  const formatted = format ? format(value) : String(value);
  const slots = splitNumberSlots(formatted);

  return (
    <span
      data-slot="animated-number"
      aria-live={announce ? "polite" : undefined}
      aria-atomic={announce ? true : undefined}
      className={cn("inline-flex items-baseline tabular-nums leading-none", className)}
    >
      {slots.map((slot) =>
        slot.isDigit ? (
          <RollingDigit key={slot.key} char={slot.char} numericValue={value} />
        ) : (
          <span key={slot.key} className="inline-block">
            {slot.char}
          </span>
        ),
      )}
    </span>
  );
}

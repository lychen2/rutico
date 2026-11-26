import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { MinusIcon, PlusIcon } from "lucide-react";
import * as React from "react";

import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import { cn } from "~/lib/utils";

function nudgeBoundary(element: HTMLElement | null, direction: -1 | 1): void {
  if (!element || typeof element.animate !== "function" || prefersReducedMotion()) return;
  const timing = getSpringWaapiTiming("snappy");
  const shift = direction * 3;
  element.animate(
    [
      { transform: "translate3d(0, 0, 0)" },
      { transform: `translate3d(${shift}px, 0, 0)` },
      { transform: `translate3d(${-shift * 0.45}px, 0, 0)` },
      { transform: "translate3d(0, 0, 0)" },
    ],
    {
      duration: Math.min(220, timing.duration),
      easing: timing.easing,
    },
  );
}

const NumberFieldBoundaryContext = React.createContext<{
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly value: number | null | undefined;
  readonly groupRef: React.RefObject<HTMLDivElement | null>;
}>({
  min: undefined,
  max: undefined,
  value: undefined,
  groupRef: { current: null },
});

export function NumberField({
  id,
  className,
  size = "default",
  min,
  max,
  value,
  ...props
}: NumberFieldPrimitive.Root.Props & {
  size?: "sm" | "default" | "lg";
}): React.ReactElement {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const groupRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <NumberFieldBoundaryContext value={{ min, max, value, groupRef }}>
      <NumberFieldPrimitive.Root
        className={cn("flex w-full flex-col items-start gap-2", className)}
        data-size={size}
        data-slot="number-field"
        id={fieldId}
        min={min}
        max={max}
        value={value}
        {...props}
      />
    </NumberFieldBoundaryContext>
  );
}

export function NumberFieldGroup({
  className,
  ...props
}: NumberFieldPrimitive.Group.Props): React.ReactElement {
  const { groupRef } = React.use(NumberFieldBoundaryContext);
  return (
    <NumberFieldPrimitive.Group
      ref={groupRef}
      className={cn(
        "relative flex w-full justify-between rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base text-foreground shadow-xs/5 ring-ring/24 transition-[border-color,background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-inset has-aria-invalid:border-destructive/36 has-autofill:bg-foreground/4 focus-within:has-aria-invalid:border-destructive/64 focus-within:has-aria-invalid:ring-destructive/48 data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [[data-disabled],:focus-within,[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="number-field-group"
      {...props}
    />
  );
}

export function NumberFieldDecrement({
  className,
  onPointerDown,
  ...props
}: NumberFieldPrimitive.Decrement.Props): React.ReactElement {
  const { min, value, groupRef } = React.use(NumberFieldBoundaryContext);
  return (
    <NumberFieldPrimitive.Decrement
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center rounded-s-[calc(var(--radius-lg)-1px)] in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] px-[calc(--spacing(3)-1px)] transition-[background-color,color,opacity,scale] duration-150 ease-out motion-safe:not-disabled:not-data-disabled:active:scale-90 motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 not-disabled:not-data-disabled:any-hover:bg-accent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className,
      )}
      data-slot="number-field-decrement"
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (min !== undefined && typeof value === "number" && value <= min) {
          nudgeBoundary(groupRef.current, -1);
        }
      }}
      {...props}
    >
      <MinusIcon />
    </NumberFieldPrimitive.Decrement>
  );
}

export function NumberFieldIncrement({
  className,
  onPointerDown,
  ...props
}: NumberFieldPrimitive.Increment.Props): React.ReactElement {
  const { max, value, groupRef } = React.use(NumberFieldBoundaryContext);
  return (
    <NumberFieldPrimitive.Increment
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center rounded-e-[calc(var(--radius-lg)-1px)] in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] px-[calc(--spacing(3)-1px)] transition-[background-color,color,opacity,scale] duration-150 ease-out motion-safe:not-disabled:not-data-disabled:active:scale-90 motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 not-disabled:not-data-disabled:any-hover:bg-accent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className,
      )}
      data-slot="number-field-increment"
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (max !== undefined && typeof value === "number" && value >= max) {
          nudgeBoundary(groupRef.current, 1);
        }
      }}
      {...props}
    >
      <PlusIcon />
    </NumberFieldPrimitive.Increment>
  );
}

export function NumberFieldInput({
  className,
  onKeyDown,
  ...props
}: NumberFieldPrimitive.Input.Props): React.ReactElement {
  const { min, max, value, groupRef } = React.use(NumberFieldBoundaryContext);
  return (
    <NumberFieldPrimitive.Input
      className={cn(
        "h-8.5 in-data-[size=lg]:h-9.5 in-data-[size=sm]:h-7.5 w-full min-w-0 grow bg-transparent in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] px-[calc(--spacing(3)-1px)] text-center tabular-nums in-data-[size=lg]:leading-9.5 in-data-[size=sm]:leading-7.5 leading-8.5 outline-none [transition:background-color_5000000s_ease-in-out_0s] sm:h-7.5 sm:in-data-[size=lg]:h-8.5 sm:in-data-[size=sm]:h-6.5 sm:in-data-[size=lg]:leading-8.5 sm:in-data-[size=sm]:leading-8.5 sm:leading-7.5",
        className,
      )}
      data-slot="number-field-input"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.key === "ArrowDown" &&
          min !== undefined &&
          typeof value === "number" &&
          value <= min
        ) {
          nudgeBoundary(groupRef.current, -1);
        } else if (
          event.key === "ArrowUp" &&
          max !== undefined &&
          typeof value === "number" &&
          value >= max
        ) {
          nudgeBoundary(groupRef.current, 1);
        }
      }}
      {...props}
    />
  );
}

export { NumberFieldPrimitive };

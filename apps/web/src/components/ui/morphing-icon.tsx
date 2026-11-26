import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Benji Taylor 3-Line Universal SVG Morphing Icon + Rotation Groups.
 * Every glyph is represented by 3 transformed unit segments inside a 24x24 viewBox,
 * enabling GPU-composited geometric morphing with zero JS frame loops.
 */

export type MorphingIconVariant =
  | "menu"
  | "close"
  | "plus"
  | "minus"
  | "check"
  | "play"
  | "pause"
  | "send"
  | "steer"
  | "queue"
  | "stop"
  | "maximize"
  | "restore"
  | "chevron-down"
  | "chevron-right";

interface SegmentSpec {
  /** Center X in 24x24 viewBox coordinates. */
  readonly cx: number;
  /** Center Y in 24x24 viewBox coordinates. */
  readonly cy: number;
  /** Rotation in degrees. */
  readonly rotate: number;
  /** Scale relative to base 16-unit segment length. */
  readonly scale: number;
  /** Segment opacity (0 hides unused stroke smoothly). */
  readonly opacity: number;
}

interface MorphingIconShape {
  readonly groupRotate: number;
  readonly lines: readonly [SegmentSpec, SegmentSpec, SegmentSpec];
}

export const MORPHING_ICON_SHAPES: Readonly<Record<MorphingIconVariant, MorphingIconShape>> = {
  menu: {
    groupRotate: 0,
    lines: [
      { cx: 12, cy: 6.5, rotate: 0, scale: 0.9, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.9, opacity: 1 },
      { cx: 12, cy: 17.5, rotate: 0, scale: 0.9, opacity: 1 },
    ],
  },
  close: {
    groupRotate: 90,
    lines: [
      { cx: 12, cy: 12, rotate: 45, scale: 0.92, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
      { cx: 12, cy: 12, rotate: -45, scale: 0.92, opacity: 1 },
    ],
  },
  plus: {
    groupRotate: 0,
    lines: [
      { cx: 12, cy: 12, rotate: 0, scale: 0.88, opacity: 1 },
      { cx: 12, cy: 12, rotate: 90, scale: 0.88, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
    ],
  },
  minus: {
    groupRotate: 0,
    lines: [
      { cx: 12, cy: 12, rotate: 0, scale: 0.88, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
    ],
  },
  check: {
    groupRotate: 0,
    lines: [
      { cx: 7.4, cy: 14.1, rotate: 45, scale: 0.42, opacity: 1 },
      { cx: 14.3, cy: 11.4, rotate: -48, scale: 0.82, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
    ],
  },
  play: {
    groupRotate: 0,
    lines: [
      { cx: 8, cy: 12, rotate: 90, scale: 0.78, opacity: 1 },
      { cx: 13.4, cy: 8.9, rotate: 30, scale: 0.78, opacity: 1 },
      { cx: 13.4, cy: 15.1, rotate: -30, scale: 0.78, opacity: 1 },
    ],
  },
  pause: {
    groupRotate: 0,
    lines: [
      { cx: 8.5, cy: 12, rotate: 90, scale: 0.78, opacity: 1 },
      { cx: 15.5, cy: 12, rotate: 90, scale: 0.78, opacity: 1 },
      { cx: 12, cy: 12, rotate: 90, scale: 0.01, opacity: 0 },
    ],
  },
  send: {
    groupRotate: 0,
    lines: [
      { cx: 12, cy: 12.2, rotate: 90, scale: 0.76, opacity: 1 },
      { cx: 8.8, cy: 8.8, rotate: -45, scale: 0.56, opacity: 1 },
      { cx: 15.2, cy: 8.8, rotate: 45, scale: 0.56, opacity: 1 },
    ],
  },
  steer: {
    groupRotate: 45,
    lines: [
      { cx: 12, cy: 12.4, rotate: 90, scale: 0.74, opacity: 1 },
      { cx: 8.8, cy: 9, rotate: -45, scale: 0.52, opacity: 1 },
      { cx: 15.2, cy: 9, rotate: 45, scale: 0.52, opacity: 1 },
    ],
  },
  queue: {
    groupRotate: 0,
    lines: [
      { cx: 11.2, cy: 7.5, rotate: 0, scale: 0.76, opacity: 1 },
      { cx: 10.4, cy: 12, rotate: 0, scale: 0.62, opacity: 1 },
      { cx: 9.6, cy: 16.5, rotate: 0, scale: 0.48, opacity: 1 },
    ],
  },
  stop: {
    groupRotate: 90,
    lines: [
      { cx: 12, cy: 8.2, rotate: 0, scale: 0.54, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.54, opacity: 1 },
      { cx: 12, cy: 15.8, rotate: 0, scale: 0.54, opacity: 1 },
    ],
  },
  maximize: {
    groupRotate: 0,
    lines: [
      { cx: 12, cy: 12, rotate: -45, scale: 0.86, opacity: 1 },
      { cx: 15.5, cy: 6.5, rotate: 0, scale: 0.38, opacity: 1 },
      { cx: 8.5, cy: 17.5, rotate: 0, scale: 0.38, opacity: 1 },
    ],
  },
  restore: {
    groupRotate: 0,
    lines: [
      { cx: 12, cy: 12, rotate: -45, scale: 0.6, opacity: 1 },
      { cx: 12, cy: 12, rotate: 45, scale: 0.6, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
    ],
  },
  "chevron-down": {
    groupRotate: 0,
    lines: [
      { cx: 8.8, cy: 12.2, rotate: 42, scale: 0.56, opacity: 1 },
      { cx: 15.2, cy: 12.2, rotate: -42, scale: 0.56, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
    ],
  },
  "chevron-right": {
    groupRotate: -90,
    lines: [
      { cx: 8.8, cy: 12.2, rotate: 42, scale: 0.56, opacity: 1 },
      { cx: 15.2, cy: 12.2, rotate: -42, scale: 0.56, opacity: 1 },
      { cx: 12, cy: 12, rotate: 0, scale: 0.01, opacity: 0 },
    ],
  },
};

export interface MorphingIconProps {
  readonly variant: MorphingIconVariant;
  readonly className?: string;
  readonly strokeWidth?: number;
  readonly "aria-label"?: string;
}

export function MorphingIcon({
  variant,
  className,
  strokeWidth = 1.85,
  "aria-label": ariaLabel,
}: MorphingIconProps) {
  const shape = MORPHING_ICON_SHAPES[variant];
  const [lineA, lineB, lineC] = shape.lines;
  const segments = [
    { id: "a", spec: lineA },
    { id: "b", spec: lineB },
    { id: "c", spec: lineC },
  ] as const;

  return (
    <svg
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      data-slot="morphing-icon"
      data-variant={variant}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0 overflow-visible", className)}
    >
      <g
        data-slot="morphing-icon-group"
        style={{
          transformOrigin: "12px 12px",
          transform: `rotate(${shape.groupRotate}deg)`,
        }}
      >
        {segments.map(({ id, spec }) => (
          <line
            key={id}
            data-slot="morphing-icon-line"
            x1={-8}
            y1={0}
            x2={8}
            y2={0}
            vectorEffect="non-scaling-stroke"
            style={{
              opacity: spec.opacity,
              transform: `translate(${spec.cx}px, ${spec.cy}px) rotate(${spec.rotate}deg) scaleX(${spec.scale})`,
            }}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Contextual semantic icon swapper (Jakub Krehel `scale(0.25) + blur(4px)` in a
 * single CSS grid cell `[grid-area:1/1]`), falling back cleanly under reduced motion.
 */
export function ContextualIconSwap({
  activeKey,
  items,
  className,
}: {
  readonly activeKey: string;
  readonly items: ReadonlyArray<{ readonly key: string; readonly icon: ReactNode }>;
  readonly className?: string;
}) {
  return (
    <span
      data-slot="contextual-icon-swap"
      className={cn("inline-grid place-items-center", className)}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <span
            key={item.key}
            aria-hidden={!active}
            data-slot="contextual-icon-swap-item"
            data-active={active ? "true" : "false"}
            className="col-start-1 row-start-1 inline-flex items-center justify-center"
          >
            {item.icon}
          </span>
        );
      })}
    </span>
  );
}

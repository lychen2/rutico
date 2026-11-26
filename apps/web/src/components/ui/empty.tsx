import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * Kubai087 Tip 022 4-tier empty state scale (`page` / `card` / `row` / `menu`)
 * alongside existing `compact` / `default` / `hero` presets.
 */
const emptySizeClassName = {
  compact:
    "min-h-64 gap-4 p-6 md:p-10 [&_[data-slot=empty-media]]:mb-0 [&_[data-slot=empty-title]]:text-[1.0625rem] [&_[data-slot=empty-title]]:leading-6 [&_[data-slot=empty-description]]:text-[0.8125rem] [&_[data-slot=empty-description]]:leading-[1.125rem]",
  default: "gap-6 p-6 md:p-12",
  hero: "gap-6 p-6 pb-[10vh] md:p-12 md:pb-[12vh] [&_[data-slot=empty-title]]:text-2xl sm:[&_[data-slot=empty-title]]:text-3xl",
  page: "gap-6 p-6 pb-[12vh] md:p-12 md:pb-[14vh] [&_[data-slot=empty-title]]:text-xl",
  card: "min-h-48 gap-4 p-6 [&_[data-slot=empty-media]]:mb-2 [&_[data-slot=empty-title]]:text-base",
  row: "flex-row gap-3 px-4 py-3 text-left [&_[data-slot=empty-media]]:mb-0 [&_[data-slot=empty-title]]:text-sm [&_[data-slot=empty-description]]:text-xs",
  menu: "gap-2 px-3 py-4 [&_[data-slot=empty-media]]:mb-1 [&_[data-slot=empty-title]]:text-xs [&_[data-slot=empty-description]]:text-xs",
} as const;

function Empty({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: keyof typeof emptySizeClassName }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center text-balance text-center",
        emptySizeClassName[size],
        className,
      )}
      data-size={size}
      data-slot="empty"
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex max-w-sm flex-col items-center text-center", className)}
      data-slot="empty-header"
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "relative flex size-9 shrink-0 items-center justify-center rounded-md border bg-card not-dark:bg-clip-padding text-foreground shadow-sm/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      className={cn("group/empty-media relative mb-6", className)}
      data-slot="empty-media"
      data-variant={variant}
      {...props}
    >
      {variant === "icon" && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              emptyMediaVariants({ className, variant }),
              "-translate-x-0.5 -rotate-10 pointer-events-none absolute bottom-px origin-bottom-left scale-84 opacity-70 shadow-none transition-transform duration-240 ease-(--ease-spring-snappy) pointer-fine:group-hover/empty-media:-translate-x-1.5 pointer-fine:group-hover/empty-media:-rotate-16 pointer-fine:group-hover/empty-media:scale-88 motion-reduce:transition-none",
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              emptyMediaVariants({ className, variant }),
              "pointer-events-none absolute bottom-px origin-bottom-right translate-x-0.5 rotate-10 scale-84 opacity-70 shadow-none transition-transform duration-240 ease-(--ease-spring-snappy) pointer-fine:group-hover/empty-media:translate-x-1.5 pointer-fine:group-hover/empty-media:rotate-16 pointer-fine:group-hover/empty-media:scale-88 motion-reduce:transition-none",
            )}
          />
        </>
      )}
      <div
        className={cn(
          emptyMediaVariants({ className, variant }),
          variant === "icon" &&
            "transition-transform duration-240 ease-(--ease-spring-snappy) pointer-fine:group-hover/empty-media:-translate-y-0.5 motion-reduce:transition-none",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Low-saturation neutral miniature interface wireframe emblem (Kubai087 Tip 022)
 * with subtle 3D spring card fan on fine-pointer hover.
 */
function EmptyWireframe({
  variant = "workspace",
  className,
}: {
  readonly variant?: "workspace" | "list" | "cards";
  readonly className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-slot="empty-wireframe"
      className={cn(
        "group/wireframe relative mx-auto mb-4 flex h-14 w-28 items-center justify-center text-muted-foreground/55",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-4 top-2 h-10 -rotate-6 rounded-lg border border-border/70 bg-card/70 transition-transform duration-260 ease-(--spring-snappy) pointer-fine:group-hover/wireframe:-translate-x-2 pointer-fine:group-hover/wireframe:-rotate-11 motion-reduce:transition-none" />
      <div className="pointer-events-none absolute inset-x-4 top-2 h-10 rotate-6 rounded-lg border border-border/70 bg-card/70 transition-transform duration-260 ease-(--spring-snappy) pointer-fine:group-hover/wireframe:translate-x-2 pointer-fine:group-hover/wireframe:rotate-11 motion-reduce:transition-none" />
      <div className="relative flex h-11 w-20 items-center justify-center rounded-lg border border-border bg-card shadow-xs transition-transform duration-260 ease-(--spring-snappy) pointer-fine:group-hover/wireframe:-translate-y-0.5 motion-reduce:transition-none">
        <svg viewBox="0 0 64 36" fill="none" className="h-7 w-14">
          {variant === "list" ? (
            <>
              <rect x="6" y="7" width="10" height="4" rx="2" fill="currentColor" opacity="0.45" />
              <rect x="20" y="7" width="38" height="4" rx="2" fill="currentColor" opacity="0.25" />
              <rect x="6" y="16" width="10" height="4" rx="2" fill="currentColor" opacity="0.45" />
              <rect x="20" y="16" width="30" height="4" rx="2" fill="currentColor" opacity="0.25" />
              <rect x="6" y="25" width="10" height="4" rx="2" fill="currentColor" opacity="0.45" />
              <rect x="20" y="25" width="34" height="4" rx="2" fill="currentColor" opacity="0.25" />
            </>
          ) : variant === "cards" ? (
            <>
              <rect
                x="5"
                y="6"
                width="24"
                height="24"
                rx="4"
                stroke="currentColor"
                strokeWidth="1.4"
                opacity="0.55"
              />
              <rect
                x="35"
                y="6"
                width="24"
                height="24"
                rx="4"
                stroke="currentColor"
                strokeWidth="1.4"
                opacity="0.35"
              />
              <rect
                x="10"
                y="12"
                width="14"
                height="3"
                rx="1.5"
                fill="currentColor"
                opacity="0.5"
              />
              <rect
                x="10"
                y="18"
                width="10"
                height="3"
                rx="1.5"
                fill="currentColor"
                opacity="0.3"
              />
            </>
          ) : (
            <>
              <rect
                x="4"
                y="4"
                width="56"
                height="28"
                rx="4"
                stroke="currentColor"
                strokeWidth="1.25"
                opacity="0.45"
              />
              <line
                x1="20"
                y1="4"
                x2="20"
                y2="32"
                stroke="currentColor"
                strokeWidth="1.25"
                opacity="0.35"
              />
              <rect
                x="8"
                y="10"
                width="8"
                height="2.5"
                rx="1.25"
                fill="currentColor"
                opacity="0.5"
              />
              <rect
                x="8"
                y="16"
                width="8"
                height="2.5"
                rx="1.25"
                fill="currentColor"
                opacity="0.35"
              />
              <rect
                x="26"
                y="11"
                width="24"
                height="3"
                rx="1.5"
                fill="currentColor"
                opacity="0.5"
              />
              <rect
                x="26"
                y="18"
                width="18"
                height="2.5"
                rx="1.25"
                fill="currentColor"
                opacity="0.3"
              />
              <rect
                x="26"
                y="24"
                width="28"
                height="2.5"
                rx="1.25"
                fill="currentColor"
                opacity="0.2"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-balance font-semibold text-xl leading-snug tracking-[-0.015em]",
        className,
      )}
      data-slot="empty-title"
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      className={cn(
        "text-pretty text-muted-foreground text-sm leading-relaxed [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1 [[data-slot=empty-description]+&]:mt-1",
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-pretty text-sm",
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  );
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
  EmptyWireframe,
};

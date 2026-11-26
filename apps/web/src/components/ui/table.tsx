import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

function getTableOverflowEdges({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): { start: boolean; end: boolean } {
  const maxScroll = scrollWidth - clientWidth;
  if (maxScroll <= 1) {
    return { start: false, end: false };
  }
  const scrollStart = Math.abs(scrollLeft);
  return {
    start: scrollStart > 1,
    end: maxScroll - scrollStart > 1,
  };
}

function syncTableOverflow(container: HTMLDivElement) {
  const { start, end } = getTableOverflowEdges(container);
  if (start) container.dataset.overflowXStart = "";
  else delete container.dataset.overflowXStart;
  if (end) container.dataset.overflowXEnd = "";
  else delete container.dataset.overflowXEnd;
}

function attachTableOverflow(container: HTMLDivElement | null) {
  if (!container) return;
  const sync = () => syncTableOverflow(container);
  sync();
  const observed = container.firstElementChild
    ? [container, container.firstElementChild]
    : container;
  const stopResize = observeResize(observed, sync);
  container.addEventListener("scroll", sync, { passive: true });
  return () => {
    stopResize();
    container.removeEventListener("scroll", sync);
  };
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      ref={attachTableOverflow}
      data-slot="table-container"
      className="relative w-full overflow-x-auto data-[overflow-x-start]:mask-l-from-[calc(100%-1.5rem)] data-[overflow-x-end]:mask-r-from-[calc(100%-1.5rem)] has-focus-visible:mask-none"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

const tableHeadVariants = cva(
  "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "",
        numeric: "text-right tabular-nums",
      },
    },
  },
);

function TableHead({
  className,
  variant,
  ...props
}: React.ComponentProps<"th"> & VariantProps<typeof tableHeadVariants>) {
  return (
    <th
      data-slot="table-head"
      data-variant={variant}
      className={cn(tableHeadVariants({ variant }), className)}
      {...props}
    />
  );
}

const tableCellVariants = cva("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", {
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      default: "",
      numeric: "text-right tabular-nums",
    },
  },
});

function TableCell({
  className,
  variant,
  ...props
}: React.ComponentProps<"td"> & VariantProps<typeof tableCellVariants>) {
  return (
    <td
      data-slot="table-cell"
      data-variant={variant}
      className={cn(tableCellVariants({ variant }), className)}
      {...props}
    />
  );
}

export { getTableOverflowEdges, Table, TableHeader, TableBody, TableHead, TableRow, TableCell };

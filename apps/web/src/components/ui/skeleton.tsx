import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

const skeletonVariants = cva("surface-skeleton-sweep bg-muted-foreground/15", {
  variants: {
    shape: {
      block: "rounded-sm",
      card: "rounded-lg",
      pill: "rounded-full",
    },
  },
  defaultVariants: { shape: "block" },
});

function Skeleton({
  className,
  shape,
  ref,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  const attachRef = (node: HTMLDivElement | null) => {
    const cleanup = observeVisibleAnimation(node);
    if (typeof ref === "function") {
      const refCleanup = ref(node);
      return () => {
        if (typeof refCleanup === "function") refCleanup();
        cleanup?.();
      };
    }
    if (ref) {
      ref.current = node;
    }
    return () => {
      if (ref) ref.current = null;
      cleanup?.();
    };
  };

  return (
    <div
      ref={attachRef}
      className={cn(skeletonVariants({ shape }), className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };

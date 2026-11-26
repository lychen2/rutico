import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

export function AnimatedWidth({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const contentRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the content element's unscaled offsetWidth before paint to animate width
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const nextWidth = Math.ceil(element.offsetWidth || element.scrollWidth);
      if (nextWidth > 0) setWidth(nextWidth);
    };
    measure();
    return observeResize(element, measure);
  }, []);

  return (
    <span
      data-slot="animated-width"
      className={cn(
        "inline-block overflow-clip transition-[width] duration-(--duration-fluid) ease-(--spring-fluid) motion-reduce:transition-none [overflow-clip-margin:2px]",
        className,
      )}
      style={width === null ? undefined : { width }}
    >
      <span ref={contentRef} className="block w-max whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}

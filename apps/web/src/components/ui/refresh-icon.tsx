import { RefreshCwIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { useEffect, useRef } from "react";

import { prefersReducedMotion } from "~/lib/motion/springs";
import { useDelayedFlag } from "~/lib/motion/useDelayedFlag";
import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

const FULL_TURN_FALLBACK_MS = 1100;

// No default size: inside a Button the parent's svg rule sizes the glyph.
const refreshIconVariants = cva("", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
  },
});

export function RefreshIcon({
  refreshing = false,
  delayed = false,
  className,
  size,
  ...props
}: React.ComponentPropsWithoutRef<typeof RefreshCwIcon> &
  VariantProps<typeof refreshIconVariants> & { refreshing?: boolean; delayed?: boolean }) {
  const delayedRefreshing = useDelayedFlag(delayed && refreshing);
  const activeRefreshing = delayed ? delayedRefreshing : refreshing;
  const iconRef = useRef<SVGSVGElement | null>(null);
  const stopVisibleObserverRef = useRef<(() => void) | undefined>(undefined);
  const wasRefreshingRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- manages DOM animation lifecycle so refresh spinners always finish a full 360deg turn
  useEffect(() => {
    const element = iconRef.current;
    if (!element) return;

    const stopSpin = () => {
      element.removeAttribute("data-spinning");
      stopVisibleObserverRef.current?.();
      stopVisibleObserverRef.current = undefined;
    };

    if (activeRefreshing) {
      wasRefreshingRef.current = true;
      element.setAttribute("data-spinning", "true");
      stopVisibleObserverRef.current?.();
      stopVisibleObserverRef.current = observeVisibleAnimation(element);
      return;
    }

    if (!wasRefreshingRef.current || prefersReducedMotion()) {
      wasRefreshingRef.current = false;
      stopSpin();
      return;
    }

    wasRefreshingRef.current = false;
    // Complete the in-flight rotation cleanly instead of snapping mid-angle.
    const onIteration = () => {
      window.clearTimeout(fallbackTimer);
      stopSpin();
    };
    const fallbackTimer = window.setTimeout(onIteration, FULL_TURN_FALLBACK_MS);
    element.addEventListener("animationiteration", onIteration, { once: true });

    return () => {
      window.clearTimeout(fallbackTimer);
      element.removeEventListener("animationiteration", onIteration);
    };
  }, [activeRefreshing]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cleans up IntersectionObserver registration on unmount
  useEffect(() => {
    return () => {
      stopVisibleObserverRef.current?.();
      stopVisibleObserverRef.current = undefined;
    };
  }, []);

  return (
    <RefreshCwIcon
      aria-hidden
      data-slot="refresh-icon"
      ref={iconRef}
      className={cn(refreshIconVariants({ size }), className)}
      {...props}
    />
  );
}

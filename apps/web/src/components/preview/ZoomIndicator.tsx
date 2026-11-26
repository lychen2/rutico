import { useEffect, useRef, useState } from "react";

import { AnimatedNumber } from "~/components/ui/animated-number";
import { cn } from "~/lib/utils";

const HIDE_AFTER_MS = 1500;
const ZOOM_EPSILON = 0.001;

function formatZoomPercent(value: number): string {
  return `${Math.round(value)}%`;
}

interface Props {
  zoomFactor: number;
}

export function ZoomIndicator({ zoomFactor }: Props) {
  const [visible, setVisible] = useState(false);
  const lastFactorRef = useRef(zoomFactor);
  const timerRef = useRef<number | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- shows the indicator on a zoom change and hides it with a timer
  useEffect(() => {
    if (Math.abs(lastFactorRef.current - zoomFactor) < ZOOM_EPSILON) return;
    lastFactorRef.current = zoomFactor;
    setVisible(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, HIDE_AFTER_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [zoomFactor]);

  const percentValue = Math.round(zoomFactor * 100);

  return (
    <div
      aria-hidden={!visible}
      data-slot="preview-zoom-indicator"
      className={cn(
        "surface-optical-chrome surface-elevated-rim pointer-events-none absolute top-3 right-3 z-20 select-none rounded-full px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-foreground transition-[opacity,transform] duration-200 ease-(--spring-snappy) motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
      )}
    >
      <AnimatedNumber value={percentValue} format={formatZoomPercent} />
    </div>
  );
}

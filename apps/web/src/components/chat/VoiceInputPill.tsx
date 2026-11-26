import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

const WAVEFORM_BAR_COUNT = 24;
const WAVEFORM_BAR_IDS = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => String(index));
const WAVEFORM_REST_SCALE = 0.2;
const WAVEFORM_CENTER = (WAVEFORM_BAR_COUNT - 1) / 2;
const WAVEFORM_SIGMA = 7.4;
const GAUSSIAN_PROFILE = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
  const distance = (index - WAVEFORM_CENTER) / WAVEFORM_SIGMA;
  return Math.max(0.32, Math.exp(-(distance * distance)));
});

export type VoiceWaveformMode = "recording" | "transcribing" | "preparing";

export const VoiceWaveform = memo(function VoiceWaveform(props: {
  readonly level: number;
  readonly mode?: VoiceWaveformMode;
}) {
  const mode: VoiceWaveformMode = props.mode ?? "recording";
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const containerRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const targetLevelRef = useRef(props.level);
  const modeRef = useRef<VoiceWaveformMode>(mode);
  const historyRef = useRef(Array<number>(WAVEFORM_BAR_COUNT).fill(0));
  const envelopeRef = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes latest mic level and waveform mode into refs read by the 60fps rAF acoustic engine
  useLayoutEffect(() => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(props.level) ? props.level : 0));
    targetLevelRef.current = clamped;
    modeRef.current = mode;
    if (prefersReducedMotion) {
      barsRef.current.forEach((bar, index) => {
        if (!bar) return;
        const weight = GAUSSIAN_PROFILE[index] ?? 0.5;
        const staticScale =
          mode === "transcribing"
            ? 0.28 + 0.24 * weight
            : Math.max(WAVEFORM_REST_SCALE, 0.28 + clamped * 0.45 * weight);
        bar.style.opacity = String(0.38 + staticScale * 0.42);
        bar.style.transform = `scaleY(${staticScale.toFixed(3)})`;
      });
    }
  }, [mode, prefersReducedMotion, props.level]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs a 60fps direct-DOM Gaussian acoustic rAF loop gated by visibility, intersection, and reduced-motion
  useEffect(() => {
    const container = containerRef.current;
    if (!container || prefersReducedMotion) return;

    const stopObserveVisible = observeVisibleAnimation(container);
    let rafId = 0;
    let isIntersecting = true;
    let lastTs = performance.now();
    let sampleAccumulator = 0;
    let wavePhase = 0;

    const paintFrame = (now: number) => {
      rafId = 0;
      if (!isIntersecting || document.visibilityState !== "visible") return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      wavePhase += dt * 5.2;

      const currentMode = modeRef.current;
      const history = historyRef.current;

      if (currentMode === "recording") {
        // First-order low-pass damped acoustic envelope for natural vocal attack/release.
        const target = targetLevelRef.current;
        const alpha = 1 - Math.exp(-dt * (target > envelopeRef.current ? 24 : 11));
        envelopeRef.current += (target - envelopeRef.current) * alpha;
        sampleAccumulator += dt;
        if (sampleAccumulator >= 0.032) {
          sampleAccumulator %= 0.032;
          history.copyWithin(0, 1);
          history[history.length - 1] = envelopeRef.current;
        }
        barsRef.current.forEach((bar, index) => {
          if (!bar) return;
          const weight = GAUSSIAN_PROFILE[index] ?? 0.5;
          const sample = history[index] ?? 0;
          const ripple = 0.045 * Math.sin(wavePhase * 1.15 + index * 0.48) * (0.25 + sample);
          const amplitude = Math.max(
            WAVEFORM_REST_SCALE,
            Math.min(1, WAVEFORM_REST_SCALE + (sample * 0.88 + ripple) * weight),
          );
          bar.style.opacity = (0.3 + amplitude * 0.62).toFixed(3);
          bar.style.transform = `scaleY(${amplitude.toFixed(3)})`;
        });
      } else {
        // Seamless sinusoidal travelling wave for transcribing/preparing on the same 24 bars.
        const speedScale = currentMode === "transcribing" ? 1 : 0.65;
        const peak = currentMode === "transcribing" ? 0.46 : 0.22;
        const base = currentMode === "transcribing" ? 0.24 : 0.2;
        barsRef.current.forEach((bar, index) => {
          if (!bar) return;
          const weight = GAUSSIAN_PROFILE[index] ?? 0.5;
          const wave = 0.5 + 0.5 * Math.sin(wavePhase * speedScale - index * 0.44);
          const amplitude = Math.max(WAVEFORM_REST_SCALE, base + peak * weight * wave);
          bar.style.opacity = (0.34 + amplitude * 0.52).toFixed(3);
          bar.style.transform = `scaleY(${amplitude.toFixed(3)})`;
        });
      }

      rafId = window.requestAnimationFrame(paintFrame);
    };

    const syncLoop = () => {
      if (isIntersecting && document.visibilityState === "visible") {
        if (!rafId) {
          lastTs = performance.now();
          rafId = window.requestAnimationFrame(paintFrame);
        }
      } else if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        isIntersecting = entry.isIntersecting;
        syncLoop();
      });
      io.observe(container);
    }

    document.addEventListener("visibilitychange", syncLoop);
    syncLoop();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      io?.disconnect();
      document.removeEventListener("visibilitychange", syncLoop);
      stopObserveVisible?.();
    };
  }, [prefersReducedMotion]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      data-voice-waveform={mode}
      className="flex h-4 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
    >
      {WAVEFORM_BAR_IDS.map((id, index) => (
        <span
          key={id}
          ref={(bar) => {
            barsRef.current[index] = bar;
          }}
          className="h-full w-0.5 shrink-0 origin-center rounded-full bg-foreground opacity-35 will-change-transform"
          style={{
            transform: `scaleY(${prefersReducedMotion ? 0.36 : WAVEFORM_REST_SCALE})`,
          }}
        />
      ))}
    </div>
  );
});

/**
 * The capsule every dictation state renders in. Default matches the composer's send button
 * and insets its pill buttons; compact matches the `xs` buttons in text-field action rows.
 */
export function VoiceInputPill({
  children,
  tone = "default",
  size = "default",
}: {
  children: ReactNode;
  tone?: "default" | "error";
  size?: "default" | "compact" | undefined;
}) {
  return (
    <div
      data-slot="voice-input-pill"
      className={cn(
        "flex min-w-0 items-center gap-1.5 ring-1 ring-inset",
        size === "compact"
          ? // Phones give the capsule its own row so the field's buttons stay together below it.
            "h-7 rounded-md max-sm:order-first max-sm:basis-full sm:h-6"
          : "h-9 max-w-fit grow-[1.5] basis-0 rounded-full p-0.5 sm:h-8",
        tone === "error"
          ? "bg-destructive/6 text-destructive ring-destructive/24"
          : "bg-muted/48 ring-border",
      )}
    >
      {children}
    </div>
  );
}

// V17-B Fusion Core Overclock (聚变核心超频) renderer from T3 Stardust Kit, MIT; see LICENSE.
import { useGT, useLocale } from "gt-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import {
  REACTOR_STORY_ZH,
  type ReactorStoryBeat,
  drawReactorScene,
  reactorStoryAtRatio,
  sampleReactorAccent,
  sampleReactorFlash,
} from "./fusionReactorScene";

// V18 Starship Launch Stack geometry: 50px canvas (+ 3px bevel = 56px track), 50x44 glass lens.
const TRACK_H = 50;
const PAD = 28;
const LENS_W = 50;
const LENS_H = 44;
const LENS_SHADOW_PAD = 18;
const LENS_SPRITE_SCALE = 2;
const SNAP = 0.032;
// Idle open-popover repaint cadence (~24fps keeps fluid motion silky while staying light on GPU).
const IDLE_FRAME_MS = 1000 / 24;
// Auto-sleep the canvas loop once settled so an open popover drops idle GPU/CPU cost to zero quickly.
const IDLE_SLEEP_MS = 900;

interface LensSprites {
  readonly shadowIdle: HTMLCanvasElement;
  readonly shadowDrag: HTMLCanvasElement;
  readonly gloss: HTMLCanvasElement;
}

let cachedLensSprites: LensSprites | null = null;

function createLensShadowSprite(blur: number): HTMLCanvasElement {
  const cssW = LENS_W + LENS_SHADOW_PAD * 2;
  const cssH = LENS_H + LENS_SHADOW_PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = cssW * LENS_SPRITE_SCALE;
  canvas.height = cssH * LENS_SPRITE_SCALE;
  const gctx = canvas.getContext("2d");
  if (!gctx) return canvas;
  gctx.scale(LENS_SPRITE_SCALE, LENS_SPRITE_SCALE);
  gctx.shadowColor = "rgba(0,0,0,0.42)";
  gctx.shadowBlur = blur;
  gctx.shadowOffsetY = 2.5;
  gctx.fillStyle = "rgba(0,0,0,0.18)";
  gctx.beginPath();
  gctx.roundRect(LENS_SHADOW_PAD, LENS_SHADOW_PAD, LENS_W, LENS_H, LENS_H / 2);
  gctx.fill();
  return canvas;
}

function createLensGlossSprite(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = LENS_W * LENS_SPRITE_SCALE;
  canvas.height = LENS_H * LENS_SPRITE_SCALE;
  const gctx = canvas.getContext("2d");
  if (!gctx) return canvas;
  gctx.scale(LENS_SPRITE_SCALE, LENS_SPRITE_SCALE);
  const kr = LENS_H / 2;
  gctx.beginPath();
  gctx.roundRect(0, 0, LENS_W, LENS_H, kr);
  gctx.clip();
  const gg = gctx.createLinearGradient(0, 0, 0, LENS_H);
  gg.addColorStop(0, "rgba(255,255,255,0.34)");
  gg.addColorStop(0.2, "rgba(255,255,255,0.02)");
  gg.addColorStop(0.84, "rgba(255,255,255,0.01)");
  gg.addColorStop(1, "rgba(255,255,255,0.22)");
  gctx.fillStyle = gg;
  gctx.fillRect(0, 0, LENS_W, LENS_H);
  gctx.fillStyle = "rgba(255,255,255,0.68)";
  gctx.beginPath();
  gctx.ellipse(
    LENS_W / 2 - 2,
    LENS_H / 2 - LENS_H * 0.36,
    LENS_W * 0.28,
    LENS_H * 0.06,
    0,
    0,
    Math.PI * 2,
  );
  gctx.fill();
  return canvas;
}

function getLensSprites(): LensSprites {
  if (!cachedLensSprites) {
    cachedLensSprites = {
      shadowIdle: createLensShadowSprite(9),
      shadowDrag: createLensShadowSprite(14),
      gloss: createLensGlossSprite(),
    };
  }
  return cachedLensSprites;
}

function applyShiftJuice(
  st: {
    flash: number;
    shake: number;
    recoil: number;
    chroma: number;
    shock: number;
  },
  nextIdx: number,
  prevIdx: number,
): void {
  const up = nextIdx > prevIdx;
  if (up) {
    st.flash = 0.32;
    st.shake = 0.85;
    st.recoil = -4.5;
    st.chroma = 1;
    st.shock = 1;
  } else {
    st.flash = 0.1;
    st.shake = 0.22;
    st.recoil = 2.2;
    st.chroma = 0.3;
    st.shock = 0;
  }
}

/**
 * V18 "Starship Launch Stack" reasoning effort slider: one continuous cinematic Starship flight
 * from cold launchpad standby to deep-space warp with 180ms tactile upshift feedback. Level radios
 * are passed in as `children` and render under the track for keyboard and screen readers.
 */
export function CosmicEffortSlider(props: {
  readonly label: string;
  readonly options: ReadonlyArray<{ id: string; label: string }>;
  readonly value: string | null;
  readonly disabled?: boolean;
  readonly onChange: (id: string) => void;
  readonly children?: ReactNode;
}) {
  const gt = useGT();
  const locale = useLocale();
  const isZh = locale.toLowerCase().startsWith("zh");
  const { options, value, disabled = false, onChange } = props;
  const wellRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const foundIndex = options.findIndex((o) => o.id === value);
  const selectedIndex = Math.max(0, foundIndex);
  const count = Math.max(1, options.length);
  const targetRatio = count <= 1 ? 0 : selectedIndex / (count - 1);

  const pointerId = useRef<number | null>(null);
  const committedOnUpRef = useRef(false);
  const dragGeometryRef = useRef<{
    left: number;
    width: number;
    clientWidth: number;
  } | null>(null);
  const layoutWidthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [dragStory, setDragStory] = useState<ReactorStoryBeat | null>(null);

  const stateRef = useRef({
    val: targetRatio,
    target: targetRatio,
    dragging: false,
    lastIdx: selectedIndex,
    t: 2.4,
    flash: 0,
    shake: 0,
    recoil: 0,
    chroma: 0,
    shock: 0,
    lastIdlePaintMs: 0,
    lastActivityMs: 0,
    hasPainted: false,
  });

  const wakeLoopRef = useRef<(() => void) | null>(null);

  // Sync external selection changes into the spring target & upshift juice.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives imperative Canvas 2D spring & shift juice when selection prop changes
  useEffect(() => {
    const st = stateRef.current;
    if (!st.dragging) {
      if (st.lastIdx !== selectedIndex) {
        applyShiftJuice(st, selectedIndex, st.lastIdx);
        st.lastIdx = selectedIndex;
      }
      st.target = targetRatio;
      wakeLoopRef.current?.();
    }
  }, [selectedIndex, targetRatio]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns imperative Canvas 2D render loop & resize/visibility listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!offCanvasRef.current) offCanvasRef.current = document.createElement("canvas");
    const off = offCanvasRef.current;
    const octx = off.getContext("2d");
    if (!octx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const well = wellRef.current;
    const lensSprites = getLensSprites();

    let raf = 0;
    let lastTs = performance.now();
    layoutWidthRef.current = wrap.clientWidth;

    const drawFrame = (now: number) => {
      const reducedMotion = motion.matches;
      if (document.hidden) {
        raf = 0;
        canvas.dataset.renderState = "sleeping";
        return;
      }

      // Use ResizeObserver-cached layout width so rAF frames never trigger sync layout reads.
      const layoutW = layoutWidthRef.current;
      if (layoutW < 2) {
        raf = 0;
        return;
      }

      const st = stateRef.current;
      const activeMotion =
        st.dragging ||
        st.flash > 0.01 ||
        st.shake > 0.02 ||
        Math.abs(st.recoil) > 0.08 ||
        st.chroma > 0.01 ||
        st.shock > 0.01 ||
        Math.abs(st.target - st.val) > 0.001;

      if (activeMotion) {
        st.lastActivityMs = now;
      } else if (!reducedMotion && st.hasPainted && now - st.lastActivityMs >= IDLE_SLEEP_MS) {
        // Settled & idle: stop scheduling frames until the user interacts again.
        raf = 0;
        canvas.dataset.renderState = "sleeping";
        return;
      }

      const cssW = Math.max(120, Math.min(720, Math.round(layoutW)));
      const cssH = TRACK_H;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(cssW * dpr);
      const ch = Math.round(cssH * dpr);
      const needsResize = canvas.width !== cw || canvas.height !== ch;

      if (
        !reducedMotion &&
        !activeMotion &&
        !needsResize &&
        st.hasPainted &&
        now - st.lastIdlePaintMs < IDLE_FRAME_MS
      ) {
        raf = window.requestAnimationFrame(drawFrame);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      st.lastIdlePaintMs = now;

      if (needsResize) {
        canvas.width = cw;
        canvas.height = ch;
        off.width = cw;
        off.height = ch;
      }

      if (reducedMotion) {
        st.val = st.target;
        st.flash = 0;
        st.shake = 0;
        st.recoil = 0;
        st.chroma = 0;
        st.shock = 0;
      } else {
        st.t += dt;
        const followRate = st.dragging ? 28 : 16;
        st.val += (st.target - st.val) * (1 - Math.exp(-followRate * dt));
        if (Math.abs(st.target - st.val) < 0.0005) st.val = st.target;
        st.flash = Math.max(0, st.flash - dt * 4.6);
        st.shake = Math.max(0, st.shake - dt * 6.4);
        st.recoil *= Math.pow(0.0008, dt);
        if (Math.abs(st.recoil) < 0.05) st.recoil = 0;
        st.chroma = Math.max(0, st.chroma - dt * 7.2);
        st.shock = Math.max(0, st.shock - dt * 4.5);
      }

      if (well) {
        if (!reducedMotion && st.shake > 0.02) {
          const dx = (Math.sin(now * 0.095) * 1.7 * st.shake).toFixed(2);
          const dy = (Math.cos(now * 0.13) * 1.2 * st.shake).toFixed(2);
          well.style.transform = `translate3d(${dx}px,${dy}px,0)`;
        } else if (well.style.transform) {
          well.style.transform = "";
        }
      }

      const kx = PAD + st.val * (cssW - PAD * 2) + st.recoil;
      const ky = cssH / 2;

      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, cssW, cssH);
      drawReactorScene(octx, cssW, cssH, st.val, kx, st.t, st.shock);

      // Detent dots along the lower rim, one per level.
      for (let i = 0; i < count; i++) {
        const dx = count <= 1 ? cssW / 2 : PAD + (i / (count - 1)) * (cssW - PAD * 2);
        octx.fillStyle = i <= st.lastIdx ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.24)";
        octx.beginPath();
        octx.arc(dx, cssH - 4.2, i === st.lastIdx ? 1.8 : 1, 0, Math.PI * 2);
        octx.fill();
      }

      // Single-frame upshift exposure flash.
      if (!reducedMotion && st.flash > 0.01) {
        octx.save();
        octx.fillStyle = sampleReactorFlash(st.val);
        octx.globalAlpha = st.flash;
        octx.fillRect(0, 0, cssW, cssH);
        octx.restore();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(off, 0, 0);

      // Crystal-clear Liquid Glass capsule lens using pre-baked shadow and gloss sprites.
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const kw = LENS_W + st.chroma * 3;
      const kh = LENS_H - st.chroma * 1.4;
      const kr = kh / 2;
      const lensX = kx - kw / 2;
      const lensY = ky - kh / 2;

      const shadowSprite = st.dragging ? lensSprites.shadowDrag : lensSprites.shadowIdle;
      const padX = (LENS_SHADOW_PAD * kw) / LENS_W;
      const padY = (LENS_SHADOW_PAD * kh) / LENS_H;
      ctx.drawImage(shadowSprite, lensX - padX, lensY - padY, kw + padX * 2, kh + padY * 2);

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(lensX, lensY, kw, kh, kr);
      ctx.clip();
      const mag = st.dragging ? 1.32 : 1.22;
      const sw = (kw / mag) * dpr;
      const sh = (kh / mag) * dpr;
      const sx = Math.max(0, Math.min(cw - sw, kx * dpr - sw / 2));
      const sy = Math.max(0, Math.min(ch - sh, ky * dpr - sh / 2));
      ctx.drawImage(off, sx, sy, sw, sh, lensX, lensY, kw, kh);

      // Only run chromatic dispersion screen passes during the brief shift-juice burst.
      if (st.chroma > 0.05) {
        const disp = 1.2 + st.chroma * 2.6;
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.18 + st.chroma * 0.25;
        ctx.drawImage(off, Math.max(0, sx - disp * dpr), sy, sw, sh, lensX - disp, lensY, kw, kh);
        ctx.drawImage(
          off,
          Math.min(cw - sw, sx + disp * dpr),
          sy,
          sw,
          sh,
          lensX + disp,
          lensY,
          kw,
          kh,
        );
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }

      ctx.drawImage(lensSprites.gloss, lensX, lensY, kw, kh);
      ctx.restore();

      const rg = ctx.createLinearGradient(kx, lensY, kx, lensY + kh);
      rg.addColorStop(0, "rgba(255,255,255,0.92)");
      rg.addColorStop(0.5, "rgba(255,255,255,0.28)");
      rg.addColorStop(1, sampleReactorAccent(st.val));
      ctx.strokeStyle = rg;
      ctx.lineWidth = st.dragging || st.chroma > 0.2 ? 1.8 : 1.3;
      ctx.beginPath();
      ctx.roundRect(lensX + 0.65, lensY + 0.65, kw - 1.3, kh - 1.3, kr);
      ctx.stroke();
      ctx.restore();

      st.hasPainted = true;
      canvas.dataset.renderState = reducedMotion ? "sleeping" : "active";
      raf = reducedMotion ? 0 : window.requestAnimationFrame(drawFrame);
    };

    const wake = () => {
      if (layoutWidthRef.current < 2) {
        layoutWidthRef.current = wrap.clientWidth;
      }
      const now = performance.now();
      stateRef.current.lastActivityMs = now;
      if (!raf) {
        lastTs = now;
        raf = window.requestAnimationFrame(drawFrame);
      }
    };

    const onResize = () => {
      layoutWidthRef.current = wrap.clientWidth;
      wake();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) wake();
    };

    wakeLoopRef.current = wake;
    wake();
    const stopObserve = observeResize(wrap, onResize);
    motion.addEventListener("change", wake);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      wakeLoopRef.current = null;
      if (raf) window.cancelAnimationFrame(raf);
      if (well) well.style.transform = "";
      stopObserve();
      motion.removeEventListener("change", wake);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [count]);

  const updateDragPreview = (clientX: number, track: HTMLDivElement): number | null => {
    const geom = dragGeometryRef.current;
    const left = geom ? geom.left : track.getBoundingClientRect().left;
    const width = geom ? geom.width : track.getBoundingClientRect().width;
    const clientWidth = geom ? geom.clientWidth : track.clientWidth;
    if (width <= 0 || count <= 1) return null;
    const pointerX = ((clientX - left) / width) * clientWidth;
    const raw = Math.max(0, Math.min(1, (pointerX - PAD) / Math.max(1, clientWidth - PAD * 2)));
    const idx = Math.round(raw * (count - 1));
    const detent = idx / (count - 1);
    const ratio = Math.abs(raw - detent) < SNAP ? detent : raw;
    const state = stateRef.current;
    state.target = ratio;
    const nextStory = reactorStoryAtRatio(ratio);
    setDragStory((prev) => (prev === nextStory ? prev : nextStory));
    if (idx !== state.lastIdx) {
      applyShiftJuice(state, idx, state.lastIdx);
      state.lastIdx = idx;
      setPreviewIdx(idx);
    }
    return idx;
  };

  const finishDrag = (commit: boolean, finalIdx?: number | null) => {
    pointerId.current = null;
    dragGeometryRef.current = null;
    const state = stateRef.current;
    state.dragging = false;
    const targetIdx = commit ? (finalIdx ?? state.lastIdx) : selectedIndex;
    state.lastIdx = targetIdx;
    state.target = count <= 1 ? 0 : targetIdx / (count - 1);
    setDragging(false);
    setPreviewIdx(null);
    setDragStory(null);
    wakeLoopRef.current?.();
    if (commit && targetIdx !== selectedIndex) {
      const option = options[targetIdx];
      if (option) onChange(option.id);
    }
  };

  const displayIdx = previewIdx ?? selectedIndex;
  const displayRatio = count <= 1 ? 0 : displayIdx / (count - 1);
  const activeOpt =
    previewIdx !== null ? options[previewIdx] : foundIndex >= 0 ? options[foundIndex] : undefined;
  const activeColor = sampleReactorAccent(displayRatio);
  const levelLabel = activeOpt?.label ?? props.label;
  const storyKey = dragStory ?? reactorStoryAtRatio(displayRatio);

  return (
    <div
      data-cosmic-effort-slider
      data-cosmic-scene="reactor"
      className={cn(disabled && "opacity-60")}
      onPointerEnter={() => wakeLoopRef.current?.()}
      onFocus={() => wakeLoopRef.current?.()}
    >
      <div data-cosmic-embed-head>
        <b>
          <span
            aria-hidden="true"
            data-cosmic-state-dot
            style={{ background: activeColor, boxShadow: `0 0 8px ${activeColor}` }}
          />
          <span className="truncate" data-cosmic-level-heading>
            {activeOpt
              ? gt("{control} · {level}", { control: props.label, level: levelLabel })
              : props.label}
          </span>
        </b>
      </div>
      <div data-cosmic-sub-row>
        <span key={storyKey} className="truncate" data-cosmic-story={storyKey}>
          {isZh ? REACTOR_STORY_ZH[storyKey] : storyKey}
        </span>
        <span className="shrink-0 tabular-nums" data-cosmic-stage>
          {gt("{count, plural, one {# level} other {# levels}}", { count })}
        </span>
      </div>

      {count > 1 ? (
        <div ref={wellRef} data-cosmic-stage-well>
          <div
            ref={wrapRef}
            aria-hidden="true"
            data-cosmic-track
            data-locked={disabled || undefined}
            className={cn(
              disabled ? "cursor-not-allowed" : dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            onPointerDown={(event) => {
              if (disabled || !event.isPrimary || event.button !== 0) return;
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Synthetic pointer events in tests may not be capturable.
              }
              const rect = event.currentTarget.getBoundingClientRect();
              dragGeometryRef.current = {
                left: rect.left,
                width: rect.width,
                clientWidth: event.currentTarget.clientWidth,
              };
              pointerId.current = event.pointerId;
              committedOnUpRef.current = false;
              stateRef.current.dragging = true;
              stateRef.current.lastIdx = selectedIndex;
              setDragging(true);
              setPreviewIdx(selectedIndex);
              updateDragPreview(event.clientX, event.currentTarget);
              wakeLoopRef.current?.();
            }}
            onPointerMove={(event) => {
              if (!disabled && pointerId.current === event.pointerId) {
                updateDragPreview(event.clientX, event.currentTarget);
              }
            }}
            onPointerUp={(event) => {
              if (!disabled && pointerId.current === event.pointerId) {
                const finalIdx = updateDragPreview(event.clientX, event.currentTarget);
                committedOnUpRef.current = true;
                finishDrag(true, finalIdx);
              }
            }}
            onPointerCancel={(event) => {
              if (pointerId.current !== event.pointerId) return;
              finishDrag(false);
            }}
            onLostPointerCapture={(event) => {
              if (pointerId.current !== event.pointerId) return;
              finishDrag(committedOnUpRef.current);
            }}
          >
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 block size-full rounded-full"
            />
          </div>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

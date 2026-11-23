// V17-B "Fusion Core Overclock" (聚变核心超频) Canvas 2D renderer from T3 Stardust Kit, MIT; see LICENSE.
// Uses pre-baked offscreen radial glow sprites so per-frame gradient allocations stay near zero.

const REACTOR_STORY_BEATS = [
  "Dormant coils · cold standby",
  "Cyan arcs · field resonance",
  "White-hot · plasma surge",
  "Magenta corona · containment overdrive",
  "Pulsar core · full overclock",
] as const;

export type ReactorStoryBeat = (typeof REACTOR_STORY_BEATS)[number];

export const REACTOR_STORY_ZH: Readonly<Record<ReactorStoryBeat, string>> = {
  "Dormant coils · cold standby": "休眠磁环 · 冷态待机",
  "Cyan arcs · field resonance": "电光青弧 · 磁场起振",
  "White-hot · plasma surge": "白热临界 · 烈焰喷射",
  "Magenta corona · containment overdrive": "品红日冕 · 约束过载",
  "Pulsar core · full overclock": "脉冲星核 · 满载爆发",
};

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const ACCENTS: readonly Rgb[] = [
  { r: 94, g: 111, b: 158 },
  { r: 0, g: 229, b: 255 },
  { r: 255, g: 153, b: 31 },
  { r: 255, g: 42, b: 230 },
  { r: 255, g: 243, b: 176 },
];

const FLASHES: readonly Rgb[] = [
  { r: 141, g: 164, b: 255 },
  { r: 128, g: 248, b: 255 },
  { r: 255, g: 224, b: 130 },
  { r: 255, g: 133, b: 245 },
  { r: 255, g: 255, b: 255 },
];

const BG_LEFT: readonly Rgb[] = [
  { r: 10, g: 13, b: 24 },
  { r: 4, g: 24, b: 36 },
  { r: 41, g: 17, b: 3 },
  { r: 38, g: 5, b: 46 },
  { r: 5, g: 8, b: 23 },
];

const BG_CENTER: readonly Rgb[] = [
  { r: 20, g: 25, b: 43 },
  { r: 6, g: 44, b: 66 },
  { r: 82, g: 34, b: 5 },
  { r: 79, g: 8, b: 87 },
  { r: 19, g: 17, b: 58 },
];

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

function sampleRgb(stops: readonly Rgb[], ratio: number): Rgb {
  const scaled = clamp01(ratio) * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - idx;
  const a = stops[idx]!;
  const b = stops[idx + 1]!;
  return {
    r: Math.round(a.r + (b.r - a.r) * f),
    g: Math.round(a.g + (b.g - a.g) * f),
    b: Math.round(a.b + (b.b - a.b) * f),
  };
}

function rgbCss(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

export function sampleReactorAccent(ratio: number): string {
  return rgbCss(sampleRgb(ACCENTS, ratio));
}

export function sampleReactorFlash(ratio: number): string {
  return rgbCss(sampleRgb(FLASHES, ratio));
}

export function reactorStoryAtRatio(ratio: number): ReactorStoryBeat {
  const index = Math.min(
    REACTOR_STORY_BEATS.length - 1,
    Math.max(0, Math.round(clamp01(ratio) * (REACTOR_STORY_BEATS.length - 1))),
  );
  return REACTOR_STORY_BEATS[index]!;
}

// Pre-baked radial bloom sprites (one per tier) to avoid per-frame RadialGradient allocations.
const BLOOM_SPRITE_SIZE = 128;
let bloomSprites: HTMLCanvasElement[] | null = null;

function getBloomSprites(): readonly HTMLCanvasElement[] {
  if (bloomSprites) return bloomSprites;
  bloomSprites = ACCENTS.map((accent, tier) => {
    const canvas = document.createElement("canvas");
    canvas.width = BLOOM_SPRITE_SIZE;
    canvas.height = BLOOM_SPRITE_SIZE;
    const gctx = canvas.getContext("2d");
    if (!gctx) return canvas;
    const half = BLOOM_SPRITE_SIZE / 2;
    const grad = gctx.createRadialGradient(half, half, 2, half, half, half);
    grad.addColorStop(0, tier >= 2 ? "#FFFFFF" : rgbCss(accent));
    grad.addColorStop(0.35, rgbCss(accent, 0.92));
    grad.addColorStop(0.68, rgbCss(accent, 0.22));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, BLOOM_SPRITE_SIZE, BLOOM_SPRITE_SIZE);
    return canvas;
  });
  return bloomSprites;
}

export function drawReactorScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ratio: number,
  kx: number,
  t: number,
  shock: number,
): void {
  const r = clamp01(ratio);
  const tierFloat = r * 4;
  const tier = Math.min(4, Math.max(0, Math.round(tierFloat)));
  const cy = h / 2;
  const accent = sampleRgb(ACCENTS, r);
  const accentCss = rgbCss(accent);
  const c0 = rgbCss(sampleRgb(BG_LEFT, r));
  const c1 = rgbCss(sampleRgb(BG_CENTER, r));

  // Background containment chamber gradient
  const bg = ctx.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, c0);
  bg.addColorStop(0.5, c1);
  bg.addColorStop(1, c0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle magnetic flux grid lines on chamber floor
  ctx.save();
  ctx.strokeStyle = rgbCss(accent, 0.08 + r * 0.1);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy - 12);
  ctx.lineTo(w, cy - 12);
  ctx.moveTo(0, cy + 12);
  ctx.lineTo(w, cy + 12);
  ctx.stroke();
  ctx.restore();

  // Magnetic containment coils along the track
  const coils = 8;
  for (let i = 0; i < coils; i++) {
    const cx = 24 + (i / (coils - 1)) * (w - 48);
    const active = cx <= kx + 14;
    ctx.strokeStyle = active ? accentCss : "rgba(255,255,255,0.1)";
    ctx.globalAlpha = active ? 0.35 + tierFloat * 0.14 : 0.25;
    ctx.lineWidth = active ? 2 : 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 5, 21, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Core radial energy bloom via pre-baked sprite
  const sprites = getBloomSprites();
  const sprite = sprites[tier];
  const radius = 28 + tierFloat * 28;
  if (sprite) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(sprite, kx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  // Electric arcs / plasma conduits
  if (tierFloat >= 0.45) {
    const arcCount = Math.max(2, tier + 1);
    const arcAlpha = clamp01((tierFloat - 0.45) / 0.55);
    const span = tier === 4 ? w : kx + 16;
    ctx.save();
    ctx.globalAlpha = arcAlpha;
    for (let a = 0; a < arcCount; a++) {
      ctx.strokeStyle = a === 0 ? "#FFFFFF" : accentCss;
      ctx.lineWidth = a === 0 ? 1.8 : 1.1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      for (let x = 10; x <= span; x += 14) {
        const amp = (3 + tierFloat * 3.5) * Math.sin(x * 0.08 + t * (8 + tierFloat * 4) + a * 2.1);
        ctx.lineTo(x, cy + amp);
      }
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // Low: single tiny violet spark drifting through dormant coils
    const spx = 24 + ((t * 18) % Math.max(40, Math.min(80, w - 48)));
    ctx.fillStyle = "#9E7BFF";
    ctx.fillRect(spx, cy + Math.sin(t * 7) * 5, 2, 2);
  }

  // Overclock pulsar core: bipolar cyan/magenta relativistic jets + spinning white-gold rings
  if (tierFloat >= 3.25) {
    const pulsarAlpha = clamp01((tierFloat - 3.25) / 0.75);
    ctx.save();
    ctx.globalAlpha = pulsarAlpha;
    ctx.translate(kx, cy);
    ctx.rotate(-0.18);
    const jet = ctx.createLinearGradient(-w * 0.6, 0, w * 0.6, 0);
    jet.addColorStop(0, "transparent");
    jet.addColorStop(0.35, "#00F0FF");
    jet.addColorStop(0.5, "#FFFFFF");
    jet.addColorStop(0.65, "#FF47E8");
    jet.addColorStop(1, "transparent");
    ctx.fillStyle = jet;
    ctx.fillRect(-w * 0.6, -3.5, w * 1.2, 7);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = pulsarAlpha;
    ctx.translate(kx, cy);
    for (let ring = 0; ring < 2; ring++) {
      ctx.save();
      ctx.rotate(t * (ring ? -2.8 : 2.2));
      ctx.strokeStyle = ring ? "#00F0FF" : "#FFF4B8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 20 + ring * 8, 7 + ring * 3, 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Upshift shockwave ring
  if (shock > 0.01) {
    const p = 1 - shock;
    const ringRadius = 10 + p * 54;
    ctx.save();
    ctx.strokeStyle = accentCss;
    ctx.globalAlpha = shock * 0.85;
    ctx.lineWidth = 2.4 * shock + 0.6;
    ctx.beginPath();
    ctx.arc(kx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#FFFFFF";
    ctx.globalAlpha = shock * 0.6;
    ctx.lineWidth = 1.2 * shock + 0.4;
    ctx.beginPath();
    ctx.arc(kx, cy, ringRadius * 0.68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

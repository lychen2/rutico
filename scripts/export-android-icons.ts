#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - One-shot icon asset generator probes optional local wallpaper paths directly.

// Android masks a 72dp safe area inside 108dp; full-bleed backgrounds and a separate mark avoid double silhouettes/cropping.

import * as NodeFS from "node:fs";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

type IconVariant = "dev" | "nightly" | "prod";

const MOBILE_WALLPAPER_ENV_PATH = process.env.RUTICO_MOBILE_WALLPAPER_PATH?.trim() || null;
const MOBILE_HERO_WEBP_PATH = "apps/mobile/assets/rutico-hero-mobile.webp";
// Replicate the rightmost lavender edge before cropping so the 72dp safe zone stays centered while
// the 108dp adaptive canvas fills every launcher mask seamlessly with pastel background pixels.
const ADAPTIVE_PORTRAIT_RIGHT_EXTEND = 140;
const ADAPTIVE_PORTRAIT_CROP = { left: 353, top: 745, width: 680, height: 680 } as const;
const LEGACY_ICON_CROP = { left: 423, top: 863, width: 540, height: 540 } as const;

const ADAPTIVE_CANVAS = 432;
const LEGACY_CANVAS = 1024;
const SPLASH_CANVAS = 1152;
const SVG_DENSITY = 320;
const OUTPUT_DIRECTORY = "apps/mobile/assets";
const PRODUCTION_BACKGROUND_COLOR = "#DECFFC";

const STEM_PATH =
  "M35 34C35 29.5817 38.5817 26 43 26H66.5C80.5833 26 90 34.4 90 46.5C90 57.6 82.05 65.4 69.8 66.8H51V54.2H65.2C71.7 54.2 75.6 51.3 75.6 46.5C75.6 41.7 71.7 38.8 65.2 38.8H50.2V94C50.2 98.4183 46.6183 102 42.2 102H40.5C37.4624 102 35 99.5376 35 96.5V34Z";
const LEG_PATH =
  "M56.5 70.5H72.2C74.9 70.5 77.4 71.9 78.8 74.2L94.4 99.2C95.3 100.6 94.1 102.4 92.5 102L84.8 99.8L79.6 102.5C78.4 103.1 76.9 102.6 76.2 101.5L56.5 70.5Z";
const SPARK_PATH = "M97 23L99.5 29.5L106 32L99.5 34.5L97 41L94.5 34.5L88 32L94.5 29.5L97 23Z";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const canvasSvg = (size: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">${inner}</svg>`;

const rasterize = (layer: string, svg: string, width: number, height = width) =>
  Effect.tryPromise({
    try: () =>
      sharp(Buffer.from(svg), { density: SVG_DENSITY }).resize(width, height).png().toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const composite = (
  layer: string,
  base: Buffer,
  overlays: ReadonlyArray<{ input: Buffer; left?: number; top?: number }>,
) =>
  Effect.tryPromise({
    try: () =>
      sharp(base)
        .composite([...overlays])
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

function markTransform(size: number, fraction: number): string {
  // Bounds around the 128x128 Ribbon-R + spark composition (35..106 x 23..103 -> 71x80 centered ~70.5, 63).
  const scale = (size * fraction) / 80;
  const tx = size / 2 - 66 * scale;
  const ty = size / 2 - 63 * scale;
  return `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(4)})`;
}

function renderColorForeground(size: number, variant: IconVariant = "prod") {
  const [stemTop, stemMid, stemBot, legStart, legEnd, spark] =
    variant === "dev"
      ? ["#8A70DF", "#7053CE", "#5E43B8", "#F199B7", "#DF6D96", "#8A70DF"]
      : variant === "nightly"
        ? ["#F8D8FF", "#D89EFF", "#B46EFF", "#FFB3CE", "#FF75A0", "#FFE082"]
        : ["#F0EAFF", "#B7A3F5", "#8F75E6", "#FFD6E3", "#EE93B2", "#F8CF86"];
  const transform = markTransform(size, 0.44);
  const svg = canvasSvg(
    size,
    `<defs>
      <linearGradient id="fg-stem" x1="35" y1="26" x2="88" y2="102" gradientUnits="userSpaceOnUse">
        <stop stop-color="${stemTop}"/>
        <stop offset="0.52" stop-color="${stemMid}"/>
        <stop offset="1" stop-color="${stemBot}"/>
      </linearGradient>
      <linearGradient id="fg-leg" x1="56" y1="70" x2="96" y2="103" gradientUnits="userSpaceOnUse">
        <stop stop-color="${legStart}"/>
        <stop offset="1" stop-color="${legEnd}"/>
      </linearGradient>
    </defs>
    <g transform="${transform}">
      <path d="${STEM_PATH}" fill="url(#fg-stem)"/>
      <path d="${LEG_PATH}" fill="url(#fg-leg)"/>
      <path d="${SPARK_PATH}" fill="${spark}"/>
    </g>`,
  );
  return rasterize("foreground", svg, size);
}

function renderPortraitForeground(portraitMaster: Buffer) {
  return Effect.tryPromise({
    try: () =>
      sharp(portraitMaster)
        .resize(ADAPTIVE_CANVAS, ADAPTIVE_CANVAS, { fit: "cover", position: "center" })
        .removeAlpha()
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer: "portrait-foreground", cause }),
  });
}

const renderLegacyPortraitIcon = Effect.fn("androidIcons.renderLegacyPortraitIcon")(function* (
  legacyMaster: Buffer | null,
) {
  if (!legacyMaster) {
    const background = yield* renderBackground("prod", LEGACY_CANVAS);
    const foreground = yield* renderColorForeground(LEGACY_CANVAS, "prod");
    return yield* composite("android-legacy-icon", background, [{ input: foreground }]);
  }

  return yield* Effect.tryPromise({
    try: () =>
      sharp(legacyMaster)
        .resize(LEGACY_CANVAS, LEGACY_CANVAS, { fit: "cover", position: "center" })
        .removeAlpha()
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer: "legacy-portrait-icon", cause }),
  });
});

function renderMonochromeMark(layer: string, size: number, fraction: number) {
  const svg = canvasSvg(
    size,
    `<g transform="${markTransform(size, fraction)}">
      <path d="${STEM_PATH}" fill="#ffffff"/>
      <path d="${LEG_PATH}" fill="#ffffff"/>
      <path d="${SPARK_PATH}" fill="#ffffff"/>
    </g>`,
  );
  return rasterize(layer, svg, size);
}

function renderBackground(variant: IconVariant, size: number) {
  const [start, end, glowA, glowB] =
    variant === "dev"
      ? ["#F4EFFF", "#D8CEFF", "#8A70DF", "#F4A5C1"]
      : variant === "nightly"
        ? ["#F6EAFF", "#DAC8FC", "#C77DFF", "#F49AC1"]
        : ["#F9EEFF", PRODUCTION_BACKGROUND_COLOR, "#B7A3F5", "#EE93B2"];
  return rasterize(
    `${variant}-background`,
    canvasSvg(
      size,
      `<defs>
        <linearGradient id="bg-${variant}" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
          <stop stop-color="${start}"/>
          <stop offset="1" stop-color="${end}"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bg-${variant})"/>
      <circle cx="${Math.round(size * 0.74)}" cy="${Math.round(size * 0.26)}" r="${Math.round(size * 0.25)}" fill="${glowB}" fill-opacity="0.22"/>
      <circle cx="${Math.round(size * 0.3)}" cy="${Math.round(size * 0.74)}" r="${Math.round(size * 0.26)}" fill="${glowA}" fill-opacity="0.22"/>`,
    ),
    size,
  );
}

const renderSplashIcon = Effect.fn("androidIcons.renderSplashIcon")(function* (
  variant: IconVariant,
  portraitMaster: Buffer | null,
) {
  if (!portraitMaster) {
    const background = yield* renderBackground(variant, SPLASH_CANVAS);
    const foreground = yield* renderColorForeground(SPLASH_CANVAS, variant);
    return yield* composite(`${variant}-splash`, background, [{ input: foreground }]);
  }

  return yield* Effect.tryPromise({
    try: async () => {
      const medallionSize = 620;
      const offset = Math.round((SPLASH_CANVAS - medallionSize) / 2);
      const center = SPLASH_CANVAS / 2;
      const radius = medallionSize / 2;
      const [ringStart, ringEnd, auraColor] =
        variant === "dev"
          ? ["#9F94FA", "#EE93B2", "#8A70DF"]
          : variant === "nightly"
            ? ["#D89EFF", "#FF75A0", "#C77DFF"]
            : ["#B7A3F5", "#EE93B2", "#B7A3F5"];

      const portraitLayer = await sharp(portraitMaster)
        .resize(medallionSize, medallionSize, { fit: "cover", position: "center" })
        .ensureAlpha()
        .toBuffer();

      const circleMask = canvasSvg(
        SPLASH_CANVAS,
        `<circle cx="${center}" cy="${center}" r="${radius - 8}" fill="#ffffff"/>`,
      );
      const ringOverlay = canvasSvg(
        SPLASH_CANVAS,
        `<defs>
          <linearGradient id="splash-ring-${variant}" x1="${offset}" y1="${offset}" x2="${offset + medallionSize}" y2="${offset + medallionSize}" gradientUnits="userSpaceOnUse">
            <stop stop-color="${ringStart}"/>
            <stop offset="1" stop-color="${ringEnd}"/>
          </linearGradient>
        </defs>
        <circle cx="${center}" cy="${center}" r="${radius + 14}" stroke="${auraColor}" stroke-opacity="0.24" stroke-width="18"/>
        <circle cx="${center}" cy="${center}" r="${radius - 8}" stroke="url(#splash-ring-${variant})" stroke-width="12"/>`,
      );

      const canvas = await sharp({
        create: {
          width: SPLASH_CANVAS,
          height: SPLASH_CANVAS,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: portraitLayer, left: offset, top: offset }])
        .png()
        .toBuffer();

      const masked = await sharp(canvas)
        .composite([{ input: Buffer.from(circleMask), blend: "dest-in" }])
        .png()
        .toBuffer();

      return sharp(masked)
        .composite([{ input: Buffer.from(ringOverlay), left: 0, top: 0 }])
        .png()
        .toBuffer();
    },
    catch: (cause) => new AndroidIconRenderError({ layer: `${variant}-portrait-splash`, cause }),
  });
});

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");

  const portraitAssets = yield* Effect.tryPromise({
    try: async () => {
      const heroPath = path.join(repositoryRoot, MOBILE_HERO_WEBP_PATH);
      const sourcePath =
        MOBILE_WALLPAPER_ENV_PATH && NodeFS.existsSync(MOBILE_WALLPAPER_ENV_PATH)
          ? MOBILE_WALLPAPER_ENV_PATH
          : NodeFS.existsSync(heroPath)
            ? heroPath
            : null;
      if (!sourcePath) {
        return null;
      }
      const wroteHero = sourcePath !== heroPath;
      if (wroteHero) {
        const heroWebp = await sharp(sourcePath).webp({ quality: 86 }).toBuffer();
        NodeFS.mkdirSync(path.dirname(heroPath), { recursive: true });
        NodeFS.writeFileSync(heroPath, heroWebp);
      }
      const extendedSource = await sharp(sourcePath)
        .extend({
          top: 0,
          bottom: 0,
          left: 0,
          right: ADAPTIVE_PORTRAIT_RIGHT_EXTEND,
          extendWith: "copy",
        })
        .png()
        .toBuffer();
      const [adaptivePortrait, legacyPortrait] = await Promise.all([
        sharp(extendedSource).extract(ADAPTIVE_PORTRAIT_CROP).png().toBuffer(),
        sharp(extendedSource).extract(LEGACY_ICON_CROP).png().toBuffer(),
      ]);
      return { adaptivePortrait, legacyPortrait, wroteHero };
    },
    catch: (cause) => new AndroidIconRenderError({ layer: "mobile-wallpaper", cause }),
  });

  if (portraitAssets?.wroteHero) {
    yield* Console.log(`wrote ${MOBILE_HERO_WEBP_PATH}`);
  }

  const adaptiveMaster = portraitAssets?.adaptivePortrait ?? null;
  const legacyMaster = portraitAssets?.legacyPortrait ?? null;

  const foreground = adaptiveMaster
    ? yield* renderPortraitForeground(adaptiveMaster)
    : yield* renderColorForeground(ADAPTIVE_CANVAS, "prod");

  const outputs = [
    ["android-icon-foreground.png", foreground],
    ["android-legacy-icon.png", yield* renderLegacyPortraitIcon(legacyMaster)],
    ["android-icon-background-prod.png", yield* renderBackground("prod", ADAPTIVE_CANVAS)],
    ["android-icon-background-dev.png", yield* renderBackground("dev", ADAPTIVE_CANVAS)],
    ["android-icon-background-nightly.png", yield* renderBackground("nightly", ADAPTIVE_CANVAS)],
    [
      "android-icon-mark.png",
      yield* renderMonochromeMark("android-icon-mark", ADAPTIVE_CANVAS, 0.44),
    ],
    [
      "android-notification-icon.png",
      yield* renderMonochromeMark("android-notification-icon", 96, 0.72),
    ],
    ["android-splash-icon-dev.png", yield* renderSplashIcon("dev", legacyMaster)],
    ["android-splash-icon-nightly.png", yield* renderSplashIcon("nightly", legacyMaster)],
    ["android-splash-icon-prod.png", yield* renderSplashIcon("prod", legacyMaster)],
  ] as const;
  for (const [name, contents] of outputs) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}

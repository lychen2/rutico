#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - One-shot brand icon generator uses synchronous Node filesystem APIs.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES, type PngIconImage } from "./lib/icon-export.ts";

type Variant = "prod" | "dev" | "nightly";

const DESKTOP_WALLPAPER_ENV_PATH = process.env.RUTICO_DESKTOP_WALLPAPER_PATH?.trim() || null;
const DESKTOP_HERO_WEBP_PATH = "apps/web/public/rutico-hero-desktop.webp";
const PORTRAIT_CROP = { left: 990, top: 8, width: 540, height: 540 } as const;

const STEM_PATH =
  "M35 34C35 29.5817 38.5817 26 43 26H66.5C80.5833 26 90 34.4 90 46.5C90 57.6 82.05 65.4 69.8 66.8H51V54.2H65.2C71.7 54.2 75.6 51.3 75.6 46.5C75.6 41.7 71.7 38.8 65.2 38.8H50.2V94C50.2 98.4183 46.6183 102 42.2 102H40.5C37.4624 102 35 99.5376 35 96.5V34Z";
const LEG_PATH =
  "M56.5 70.5H72.2C74.9 70.5 77.4 71.9 78.8 74.2L94.4 99.2C95.3 100.6 94.1 102.4 92.5 102L84.8 99.8L79.6 102.5C78.4 103.1 76.9 102.6 76.2 101.5L56.5 70.5Z";
const SPARK_PATH = "M97 23L99.5 29.5L106 32L99.5 34.5L97 41L94.5 34.5L88 32L94.5 29.5L97 23Z";

const PALETTES: Record<
  Variant,
  {
    readonly bgStart: string;
    readonly bgEnd: string;
    readonly glowPrimary: string;
    readonly glowSecondary: string;
    readonly stemTop: string;
    readonly stemMid: string;
    readonly stemBot: string;
    readonly legStart: string;
    readonly legEnd: string;
    readonly spark: string;
    readonly borderStroke: string;
    readonly portraitTint?: string;
    readonly portraitTintOpacity?: number;
    readonly portraitInnerBorder: string;
  }
> = {
  prod: {
    bgStart: "#2D2740",
    bgEnd: "#14111E",
    glowPrimary: "#9D84F0",
    glowSecondary: "#EE93B2",
    stemTop: "#F0EAFF",
    stemMid: "#B7A3F5",
    stemBot: "#8F75E6",
    legStart: "#FFD6E3",
    legEnd: "#EE93B2",
    spark: "#F8CF86",
    borderStroke: "rgba(183, 163, 245, 0.45)",
    portraitInnerBorder: "rgba(183, 163, 245, 0.72)",
  },
  dev: {
    bgStart: "#FDFBFF",
    bgEnd: "#F2EBFF",
    glowPrimary: "#B7A3F5",
    glowSecondary: "#EE93B2",
    stemTop: "#8A70DF",
    stemMid: "#7053CE",
    stemBot: "#5E43B8",
    legStart: "#F199B7",
    legEnd: "#DF6D96",
    spark: "#8A70DF",
    borderStroke: "rgba(125, 114, 242, 0.65)",
    portraitTint: "#7D72F2",
    portraitTintOpacity: 0.08,
    portraitInnerBorder: "rgba(125, 114, 242, 0.88)",
  },
  nightly: {
    bgStart: "#36214D",
    bgEnd: "#170E24",
    glowPrimary: "#C77DFF",
    glowSecondary: "#FF75A0",
    stemTop: "#F8D8FF",
    stemMid: "#D89EFF",
    stemBot: "#B46EFF",
    legStart: "#FFB3CE",
    legEnd: "#FF75A0",
    spark: "#FFE082",
    borderStroke: "rgba(199, 125, 255, 0.75)",
    portraitTint: "#281442",
    portraitTintOpacity: 0.24,
    portraitInnerBorder: "rgba(216, 158, 255, 0.88)",
  },
};

function buildBrandSvg(
  variant: Variant,
  options: { readonly rounded: boolean; readonly markOnly?: boolean },
): string {
  const palette = PALETTES[variant];
  const id = `rutico-${variant}-${options.rounded ? "sq" : "fb"}`;
  if (options.markOnly) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="${id}-stem" x1="35" y1="26" x2="88" y2="102" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.stemTop}"/>
      <stop offset="0.52" stop-color="${palette.stemMid}"/>
      <stop offset="1" stop-color="${palette.stemBot}"/>
    </linearGradient>
    <linearGradient id="${id}-leg" x1="56" y1="70" x2="96" y2="103" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.legStart}"/>
      <stop offset="1" stop-color="${palette.legEnd}"/>
    </linearGradient>
  </defs>
  <path d="${STEM_PATH}" fill="url(#${id}-stem)"/>
  <path d="${LEG_PATH}" fill="url(#${id}-leg)"/>
  <path d="${SPARK_PATH}" fill="${palette.spark}"/>
</svg>\n`;
  }

  const clipDef = options.rounded
    ? `<clipPath id="${id}-clip"><rect x="8" y="8" width="112" height="112" rx="26"/></clipPath>`
    : `<clipPath id="${id}-clip"><rect x="0" y="0" width="128" height="128"/></clipPath>`;
  const bgRect = options.rounded
    ? `<rect x="8" y="8" width="112" height="112" rx="26" fill="url(#${id}-bg)"/>`
    : `<rect x="0" y="0" width="128" height="128" fill="url(#${id}-bg)"/>`;
  const borderRect = options.rounded
    ? `<rect x="8.75" y="8.75" width="110.5" height="110.5" rx="25.25" stroke="${palette.borderStroke}" stroke-width="1.5"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="${id}-bg" x1="12" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.bgStart}"/>
      <stop offset="1" stop-color="${palette.bgEnd}"/>
    </linearGradient>
    <linearGradient id="${id}-stem" x1="35" y1="26" x2="88" y2="102" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.stemTop}"/>
      <stop offset="0.52" stop-color="${palette.stemMid}"/>
      <stop offset="1" stop-color="${palette.stemBot}"/>
    </linearGradient>
    <linearGradient id="${id}-leg" x1="56" y1="70" x2="96" y2="103" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.legStart}"/>
      <stop offset="1" stop-color="${palette.legEnd}"/>
    </linearGradient>
    ${clipDef}
  </defs>
  <g clip-path="url(#${id}-clip)">
    ${bgRect}
    <circle cx="94" cy="34" r="30" fill="${palette.glowSecondary}" fill-opacity="0.18"/>
    <circle cx="42" cy="94" r="32" fill="${palette.glowPrimary}" fill-opacity="0.16"/>
    <path d="${STEM_PATH}" fill="url(#${id}-stem)"/>
    <path d="${LEG_PATH}" fill="url(#${id}-leg)"/>
    <path d="${SPARK_PATH}" fill="${palette.spark}"/>
  </g>
  ${borderRect}
</svg>\n`;
}

async function renderPng(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 320 }).resize(size, size).png().toBuffer();
}

async function renderPortraitIcon(
  portraitMaster: Buffer,
  variant: Variant,
  size: number,
  options: { readonly rounded: boolean },
): Promise<Buffer> {
  const palette = PALETTES[variant];
  const inset = options.rounded ? Math.round((size * 8) / 128) : 0;
  const innerSize = size - inset * 2;
  const rx = Math.round((size * 26) / 128);
  const outerStroke = Math.max(1.5, size * 0.014);
  const innerStroke = Math.max(1, size * 0.008);

  const portraitLayer = await sharp(portraitMaster)
    .resize(innerSize, innerSize, { fit: "cover", position: "center" })
    .ensureAlpha()
    .toBuffer();

  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect x="${inset}" y="${inset}" width="${innerSize}" height="${innerSize}" rx="${options.rounded ? rx : 0}" fill="#ffffff"/>
  </svg>`;
  const tintRect =
    palette.portraitTint && palette.portraitTintOpacity
      ? `<rect x="${inset}" y="${inset}" width="${innerSize}" height="${innerSize}" rx="${options.rounded ? rx : 0}" fill="${palette.portraitTint}" fill-opacity="${palette.portraitTintOpacity}"/>`
      : "";
  const borderOverlaySvg = options.rounded
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
        ${tintRect}
        <rect x="${inset + outerStroke / 2}" y="${inset + outerStroke / 2}" width="${innerSize - outerStroke}" height="${innerSize - outerStroke}" rx="${Math.max(2, rx - outerStroke / 2)}" stroke="rgba(255,255,255,0.58)" stroke-width="${outerStroke}"/>
        <rect x="${inset + outerStroke + innerStroke / 2}" y="${inset + outerStroke + innerStroke / 2}" width="${innerSize - outerStroke * 2 - innerStroke}" height="${innerSize - outerStroke * 2 - innerStroke}" rx="${Math.max(2, rx - outerStroke)}" stroke="${palette.portraitInnerBorder}" stroke-width="${innerStroke}"/>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
        ${tintRect}
        <rect x="${innerStroke}" y="${innerStroke}" width="${size - innerStroke * 2}" height="${size - innerStroke * 2}" stroke="${palette.portraitInnerBorder}" stroke-width="${innerStroke * 2}"/>
      </svg>`;

  const base = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: portraitLayer, left: inset, top: inset }])
    .png()
    .toBuffer();

  const masked = options.rounded
    ? await sharp(base)
        .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
        .png()
        .toBuffer()
    : base;

  return sharp(masked)
    .composite([{ input: Buffer.from(borderOverlaySvg), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function renderIcoFromPortraitOrSvg(
  portraitMaster: Buffer | null,
  variant: Variant,
  squircleSvg: string,
  sizes: ReadonlyArray<number>,
): Promise<Buffer> {
  const images: PngIconImage[] = [];
  for (const size of sizes) {
    if (portraitMaster && size >= 48) {
      images.push({
        size,
        contents: await renderPortraitIcon(portraitMaster, variant, size, { rounded: true }),
      });
    } else {
      images.push({ size, contents: await renderPng(squircleSvg, size) });
    }
  }
  return encodePngIco(images);
}

function writeAsset(root: string, relativePath: string, data: Buffer | string): void {
  const fullPath = NodePath.resolve(root, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(fullPath), { recursive: true });
  NodeFS.writeFileSync(fullPath, data);
  console.log(`wrote ${relativePath}`);
}

async function main(): Promise<void> {
  const root = NodePath.resolve(import.meta.dirname, "..");
  let portraitMaster: Buffer | null = null;
  const heroFullPath = NodePath.resolve(root, DESKTOP_HERO_WEBP_PATH);
  if (DESKTOP_WALLPAPER_ENV_PATH && NodeFS.existsSync(DESKTOP_WALLPAPER_ENV_PATH)) {
    const heroWebp = await sharp(DESKTOP_WALLPAPER_ENV_PATH).webp({ quality: 88 }).toBuffer();
    writeAsset(root, DESKTOP_HERO_WEBP_PATH, heroWebp);
    portraitMaster = await sharp(DESKTOP_WALLPAPER_ENV_PATH)
      .extract(PORTRAIT_CROP)
      .png()
      .toBuffer();
  } else if (NodeFS.existsSync(heroFullPath)) {
    portraitMaster = await sharp(heroFullPath).extract(PORTRAIT_CROP).png().toBuffer();
  }

  const variantTargets: ReadonlyArray<{
    readonly variant: Variant;
    readonly ios: string;
    readonly macos: string;
    readonly universal: string;
    readonly winIco: string;
    readonly webIco: string;
    readonly web16: string;
    readonly web32: string;
    readonly web180: string;
    readonly web192: string;
    readonly web512: string;
  }> = [
    {
      variant: "prod",
      ios: BRAND_ASSET_PATHS.productionIosIconPng,
      macos: BRAND_ASSET_PATHS.productionMacIconPng,
      universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
      winIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
      webIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
      web16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
      web32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
      web180: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      web192: BRAND_ASSET_PATHS.productionWebIcon192Png,
      web512: BRAND_ASSET_PATHS.productionWebIcon512Png,
    },
    {
      variant: "dev",
      ios: BRAND_ASSET_PATHS.developmentIosIconPng,
      macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
      universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
      winIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
      webIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
      web16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
      web32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
      web180: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
      web192: BRAND_ASSET_PATHS.developmentWebIcon192Png,
      web512: BRAND_ASSET_PATHS.developmentWebIcon512Png,
    },
    {
      variant: "nightly",
      ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
      macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
      universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      winIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
      webIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      web16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
      web32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
      web180: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
      web192: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
      web512: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
    },
  ];

  for (const target of variantTargets) {
    const fullBleedSvg = buildBrandSvg(target.variant, { rounded: false });
    const squircleSvg = buildBrandSvg(target.variant, { rounded: true });

    const [iosPng, macPng, univPng, winIco, webIco, png16, png32, png180, png192, png512] =
      await Promise.all([
        portraitMaster
          ? renderPortraitIcon(portraitMaster, target.variant, 1024, { rounded: false })
          : renderPng(fullBleedSvg, 1024),
        portraitMaster
          ? renderPortraitIcon(portraitMaster, target.variant, 1024, { rounded: true })
          : renderPng(squircleSvg, 1024),
        portraitMaster
          ? renderPortraitIcon(portraitMaster, target.variant, 1024, { rounded: true })
          : renderPng(squircleSvg, 1024),
        renderIcoFromPortraitOrSvg(portraitMaster, target.variant, squircleSvg, WINDOWS_ICON_SIZES),
        renderIcoFromPortraitOrSvg(portraitMaster, target.variant, squircleSvg, [16, 32, 48]),
        renderPng(squircleSvg, 16),
        renderPng(squircleSvg, 32),
        portraitMaster
          ? renderPortraitIcon(portraitMaster, target.variant, 180, { rounded: false })
          : renderPng(fullBleedSvg, 180),
        portraitMaster
          ? renderPortraitIcon(portraitMaster, target.variant, 192, { rounded: true })
          : renderPng(squircleSvg, 192),
        portraitMaster
          ? renderPortraitIcon(portraitMaster, target.variant, 512, { rounded: true })
          : renderPng(squircleSvg, 512),
      ]);

    writeAsset(root, target.ios, iosPng);
    writeAsset(root, target.macos, macPng);
    writeAsset(root, target.universal, univPng);
    writeAsset(root, target.winIco, winIco);
    writeAsset(root, target.webIco, webIco);
    writeAsset(root, target.web16, png16);
    writeAsset(root, target.web32, png32);
    writeAsset(root, target.web180, png180);
    writeAsset(root, target.web192, png192);
    writeAsset(root, target.web512, png512);

    if (target.variant === "prod") {
      writeAsset(
        root,
        "assets/prod/logo.svg",
        buildBrandSvg("prod", { rounded: false, markOnly: true }),
      );
      writeAsset(root, "apps/web/public/favicon.ico", webIco);
      writeAsset(root, "apps/web/public/favicon-16x16.png", png16);
      writeAsset(root, "apps/web/public/favicon-32x32.png", png32);
      writeAsset(root, "apps/web/public/apple-touch-icon.png", png180);
      writeAsset(root, "apps/web/public/icon-192x192.png", png192);
      writeAsset(root, "apps/web/public/icon-512x512.png", png512);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { memo } from "react";
import { QrCode } from "@t3tools/shared/qrCode";

export type QRCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H";
export type QRCodeVariant = "classic" | "branded";

export type QRCodeSvgProps = {
  value: string;
  size?: number;
  level?: QRCodeErrorCorrectionLevel;
  marginSize?: number;
  title?: string;
  className?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  variant?: QRCodeVariant;
  /** Render the subtle centered brand mark on `variant="branded"` when ECC >= Q. */
  showCenterMark?: boolean;
};

const ERROR_CORRECTION_LEVELS = {
  L: QrCode.Ecc.LOW,
  M: QrCode.Ecc.MEDIUM,
  Q: QrCode.Ecc.QUARTILE,
  H: QrCode.Ecc.HIGH,
} as const;

export interface QrMatrix {
  readonly size: number;
  readonly version: number;
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>;
}

export interface QrFinderEyeOrigin {
  readonly x: number;
  readonly y: number;
}

export interface QrCenterMarkAperture {
  /** Inclusive starting module index in `[0, size)`. */
  readonly start: number;
  /** Exclusive ending module index in `(start, size]`. */
  readonly end: number;
  /** Number of modules along one side of the square aperture. */
  readonly span: number;
}

export interface BrandedQrGeometry {
  readonly size: number;
  readonly finderEyes: ReadonlyArray<QrFinderEyeOrigin>;
  readonly dataModules: ReadonlyArray<readonly [x: number, y: number]>;
  readonly centerMark: QrCenterMarkAperture | null;
}

/** Encodes `value` directly via `@t3tools/shared/qrCode` with zero protocol mutation. */
export function encodeQrMatrix(value: string, level: QRCodeErrorCorrectionLevel = "L"): QrMatrix {
  const qrCode = QrCode.encodeText(value, ERROR_CORRECTION_LEVELS[level]);
  const modules: Array<Array<boolean>> = [];
  for (let y = 0; y < qrCode.size; y += 1) {
    const row: Array<boolean> = [];
    for (let x = 0; x < qrCode.size; x += 1) {
      row.push(qrCode.getModule(x, y));
    }
    modules.push(row);
  }
  return {
    size: qrCode.size,
    version: qrCode.version,
    modules,
  };
}

/** Returns true when `(x, y)` lies inside one of the three canonical 7x7 finder patterns. */
export function isQrFinderModule(x: number, y: number, size: number): boolean {
  const inTop = y >= 0 && y < 7;
  const inBottom = y >= size - 7 && y < size;
  const inLeft = x >= 0 && x < 7;
  const inRight = x >= size - 7 && x < size;
  return (inTop && inLeft) || (inTop && inRight) || (inBottom && inLeft);
}

function getQrVersionFromSize(size: number): number | null {
  if (size < 21 || (size - 17) % 4 !== 0) return null;
  const version = (size - 17) / 4;
  return version >= QrCode.MIN_VERSION && version <= QrCode.MAX_VERSION ? version : null;
}

/** ISO 18004 alignment pattern axis positions, matching `@t3tools/shared/qrCode`. */
export function getQrAlignmentPatternPositions(version: number): ReadonlyArray<number> {
  if (version <= 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result: Array<number> = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

/** Centers of every 5x5 alignment pattern in a QR symbol (excluding the 3 finder corners). */
export function getQrAlignmentPatternCenters(
  version: number,
): ReadonlyArray<readonly [x: number, y: number]> {
  const positions = getQrAlignmentPatternPositions(version);
  const count = positions.length;
  const centers: Array<readonly [number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < count; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) {
        continue;
      }
      centers.push([positions[i]!, positions[j]!]);
    }
  }
  return centers;
}

/**
 * Returns true when `(x, y)` belongs to any ISO 18004 QR function pattern: finder patterns +
 * 1-module separators, timing lines, format info + dark module, version info (V7+), or any
 * 5x5 alignment pattern (V2+).
 */
export function isQrFunctionModule(x: number, y: number, size: number): boolean {
  if (x < 0 || x >= size || y < 0 || y >= size) return false;
  // Finder patterns (7x7) plus 1-module separators (8x8 corners).
  if ((x <= 7 && y <= 7) || (x >= size - 8 && y <= 7) || (x <= 7 && y >= size - 8)) {
    return true;
  }
  // Timing patterns.
  if (x === 6 || y === 6) return true;
  // Format information and fixed dark module.
  if ((x === 8 && (y <= 8 || y >= size - 8)) || (y === 8 && (x <= 8 || x >= size - 8))) {
    return true;
  }
  const version = getQrVersionFromSize(size);
  if (version === null) return false;
  // Version information blocks (3x6 and 6x3, V7+).
  if (
    version >= 7 &&
    ((x >= size - 11 && x <= size - 9 && y <= 5) || (y >= size - 11 && y <= size - 9 && x <= 5))
  ) {
    return true;
  }
  // 5x5 alignment patterns (V2+).
  for (const [cx, cy] of getQrAlignmentPatternCenters(version)) {
    if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Computes a compact centered aperture for the branded emblem. Only enabled at Q/H ECC
 * and QR sizes >= 25 when the aperture stays well below Reed-Solomon recovery capacity
 * (< 6% of total modules) and never intersects any QR function pattern (finder, separator,
 * timing, format, version, or alignment pattern).
 */
export function getQrCenterMarkAperture(
  size: number,
  level: QRCodeErrorCorrectionLevel,
): QrCenterMarkAperture | null {
  if ((level !== "Q" && level !== "H") || size < 25 || getQrVersionFromSize(size) === null) {
    return null;
  }
  // Keep span odd (matching odd QR dimensions) and capped at <= 7 modules for fast CameraX lock.
  const span = size >= 41 ? 7 : 5;
  const start = Math.floor((size - span) / 2);
  const end = start + span;
  // Never encroach on timing patterns (index 6) or finder/format guard zones (index <= 8).
  if (start <= 8 || end >= size - 8) {
    return null;
  }
  // Suppress the centered emblem whenever its aperture would overlap any reserved function pattern
  // (e.g., the central 5x5 alignment pattern on QR versions with an odd alignment grid such as V7).
  for (let y = start; y < end; y += 1) {
    for (let x = start; x < end; x += 1) {
      if (isQrFunctionModule(x, y, size)) {
        return null;
      }
    }
  }
  return { start, end, span };
}

function isInsideCenterMark(x: number, y: number, aperture: QrCenterMarkAperture | null): boolean {
  if (aperture === null) return false;
  return x >= aperture.start && x < aperture.end && y >= aperture.start && y < aperture.end;
}

/**
 * Splits a `QrCode` into canonical 7x7 finder eyes and non-finder dark data modules
 * so `variant="branded"` renders rounded eyes + modules while remaining matrix-equivalent.
 */
export function buildBrandedQrGeometry(
  qrCode: Pick<ReturnType<typeof QrCode.encodeText>, "size" | "getModule">,
  level: QRCodeErrorCorrectionLevel,
  options?: { readonly includeCenterMark?: boolean },
): BrandedQrGeometry {
  const size = qrCode.size;
  const centerMark =
    options?.includeCenterMark === false ? null : getQrCenterMarkAperture(size, level);
  const finderEyes: ReadonlyArray<QrFinderEyeOrigin> = [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ];
  const dataModules: Array<readonly [number, number]> = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!qrCode.getModule(x, y)) continue;
      if (isQrFinderModule(x, y, size)) continue;
      if (isInsideCenterMark(x, y, centerMark)) continue;
      dataModules.push([x, y]);
    }
  }

  return { size, finderEyes, dataModules, centerMark };
}

function buildQrPathData(qrCode: ReturnType<typeof QrCode.encodeText>, marginSize: number): string {
  const commands: Array<string> = [];

  for (let y = 0; y < qrCode.size; y += 1) {
    let runStart = -1;

    for (let x = 0; x <= qrCode.size; x += 1) {
      const isDark = x < qrCode.size && qrCode.getModule(x, y);

      if (isDark) {
        if (runStart === -1) {
          runStart = x;
        }
        continue;
      }

      if (runStart === -1) {
        continue;
      }

      commands.push(
        `M${runStart + marginSize} ${y + marginSize}h${x - runStart}v1H${runStart + marginSize}z`,
      );
      runStart = -1;
    }
  }

  return commands.join("");
}

/** Builds a single SVG path of softly rounded data dots for `variant="branded"`. */
function buildRoundedModulesPathData(
  dataModules: ReadonlyArray<readonly [x: number, y: number]>,
  marginSize: number,
): string {
  const inset = 0.07;
  const side = 1 - inset * 2;
  const radius = 0.3;
  const straight = side - radius * 2;
  const parts: Array<string> = [];

  for (const [x, y] of dataModules) {
    const left = (x + marginSize + inset).toFixed(2);
    const top = (y + marginSize + inset).toFixed(2);
    parts.push(
      `M${(Number(left) + radius).toFixed(2)} ${top}` +
        `h${straight.toFixed(2)}` +
        `a${radius} ${radius} 0 0 1 ${radius} ${radius}` +
        `v${straight.toFixed(2)}` +
        `a${radius} ${radius} 0 0 1 -${radius} ${radius}` +
        `h-${straight.toFixed(2)}` +
        `a${radius} ${radius} 0 0 1 -${radius} -${radius}` +
        `v-${straight.toFixed(2)}` +
        `a${radius} ${radius} 0 0 1 ${radius} -${radius}z`,
    );
  }

  return parts.join("");
}

export const QRCodeSvg = memo(function QRCodeSvg({
  value,
  size = 128,
  level = "L",
  marginSize = 0,
  title,
  className,
  foregroundColor = "#000",
  backgroundColor = "#fff",
  variant = "classic",
  showCenterMark = true,
}: QRCodeSvgProps) {
  const qrCode = QrCode.encodeText(value, ERROR_CORRECTION_LEVELS[level]);
  const viewBoxSize = qrCode.size + marginSize * 2;

  if (variant === "branded") {
    const geometry = buildBrandedQrGeometry(qrCode, level, {
      includeCenterMark: showCenterMark,
    });
    const modulesPath = buildRoundedModulesPathData(geometry.dataModules, marginSize);

    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        width={size}
        height={size}
        shapeRendering="geometricPrecision"
        role={title ? "img" : undefined}
        aria-label={title}
        data-qr-variant="branded"
        className={className}
      >
        {title ? <title>{title}</title> : null}
        <rect width={viewBoxSize} height={viewBoxSize} fill={backgroundColor} />
        <path d={modulesPath} fill={foregroundColor} data-slot="qr-branded-modules" />
        <g data-slot="qr-finder-eyes">
          {geometry.finderEyes.map((eye) => {
            const ox = eye.x + marginSize;
            const oy = eye.y + marginSize;
            return (
              <g key={`${eye.x}:${eye.y}`}>
                {/* Dual-ring rounded finder eye preserving canonical 1:1:3:1:1 scan ratio */}
                <rect
                  x={ox + 0.5}
                  y={oy + 0.5}
                  width={6}
                  height={6}
                  rx={1.85}
                  fill="none"
                  stroke={foregroundColor}
                  strokeWidth={1}
                />
                <rect x={ox + 2} y={oy + 2} width={3} height={3} rx={0.95} fill={foregroundColor} />
              </g>
            );
          })}
        </g>
        {geometry.centerMark ? (
          <g data-slot="qr-center-mark">
            <rect
              x={geometry.centerMark.start + marginSize - 0.15}
              y={geometry.centerMark.start + marginSize - 0.15}
              width={geometry.centerMark.span + 0.3}
              height={geometry.centerMark.span + 0.3}
              rx={1.25}
              fill={backgroundColor}
            />
            <rect
              x={geometry.centerMark.start + marginSize + 0.35}
              y={geometry.centerMark.start + marginSize + 0.35}
              width={geometry.centerMark.span - 0.7}
              height={geometry.centerMark.span - 0.7}
              rx={0.95}
              fill={foregroundColor}
              fillOpacity={0.08}
              stroke={foregroundColor}
              strokeOpacity={0.22}
              strokeWidth={0.24}
            />
            {/* Minimal geometric spark emblem centered inside the high-ECC aperture */}
            {(() => {
              const cx = geometry.centerMark.start + marginSize + geometry.centerMark.span / 2;
              const cy = cx;
              const arm = geometry.centerMark.span * 0.27;
              const waist = arm * 0.36;
              const spark = `M${cx} ${cy - arm}L${cx + waist} ${cy - waist}L${cx + arm} ${cy}L${cx + waist} ${cy + waist}L${cx} ${cy + arm}L${cx - waist} ${cy + waist}L${cx - arm} ${cy}L${cx - waist} ${cy - waist}Z`;
              return <path d={spark} fill={foregroundColor} />;
            })()}
          </g>
        ) : null}
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      data-qr-variant="classic"
      className={className}
    >
      {title ? <title>{title}</title> : null}
      <rect width={viewBoxSize} height={viewBoxSize} fill={backgroundColor} />
      <path d={buildQrPathData(qrCode, marginSize)} fill={foregroundColor} />
    </svg>
  );
});

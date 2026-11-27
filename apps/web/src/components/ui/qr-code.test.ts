import { QrCode } from "@t3tools/shared/qrCode";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBrandedQrGeometry,
  encodeQrMatrix,
  getQrAlignmentPatternCenters,
  getQrCenterMarkAperture,
  isQrFinderModule,
  isQrFunctionModule,
  type QRCodeErrorCorrectionLevel,
} from "./qr-code";

const ECC_MAP: Record<QRCodeErrorCorrectionLevel, typeof QrCode.Ecc.LOW> = {
  L: QrCode.Ecc.LOW,
  M: QrCode.Ecc.MEDIUM,
  Q: QrCode.Ecc.QUARTILE,
  H: QrCode.Ecc.HIGH,
};

const SAMPLE_PAIRING_URLS = [
  "http://192.168.1.100:3773/pair#token=abc123def456",
  "https://app.t3.codes/pair#host=https%3A%2F%2Fmy-linux.ts.net&token=one-time-secret-999",
  "rutico://pair?pairingUrl=https%3A%2F%2F100.82.53.91%3A3773%2Fpair%23token%3Dxyz789",
] as const;

describe("QRCode matrix equivalence and branded geometry", () => {
  it.each(["L", "M", "Q", "H"] as const)(
    "produces a 100% equivalent module matrix to @t3tools/shared/qrCode at ECC level %s",
    (level) => {
      for (const url of SAMPLE_PAIRING_URLS) {
        const direct = QrCode.encodeText(url, ECC_MAP[level]);
        const encoded = encodeQrMatrix(url, level);

        expect(encoded.size).toBe(direct.size);
        expect(encoded.version).toBe(direct.version);

        for (let y = 0; y < direct.size; y += 1) {
          for (let x = 0; x < direct.size; x += 1) {
            expect(encoded.modules[y]?.[x]).toBe(direct.getModule(x, y));
          }
        }
      }
    },
  );

  it("accounts for every dark module 1-to-1 between branded finder eyes + rounded data modules and the canonical matrix", () => {
    for (const url of SAMPLE_PAIRING_URLS) {
      for (const level of ["L", "M", "Q", "H"] as const) {
        const direct = QrCode.encodeText(url, ECC_MAP[level]);
        const branded = buildBrandedQrGeometry(direct, level, { includeCenterMark: false });

        expect(branded.size).toBe(direct.size);
        expect(branded.centerMark).toBeNull();
        expect(branded.finderEyes).toEqual([
          { x: 0, y: 0 },
          { x: direct.size - 7, y: 0 },
          { x: 0, y: direct.size - 7 },
        ]);

        // Reconstruct dark modules from finder eyes + data modules and prove exact equivalence.
        const reconstructed = new Set<string>();
        for (const eye of branded.finderEyes) {
          for (let dy = 0; dy < 7; dy += 1) {
            for (let dx = 0; dx < 7; dx += 1) {
              const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
              if (dist !== 2) {
                reconstructed.add(`${eye.x + dx},${eye.y + dy}`);
              }
            }
          }
        }
        for (const [x, y] of branded.dataModules) {
          expect(isQrFinderModule(x, y, direct.size)).toBe(false);
          const key = `${x},${y}`;
          expect(reconstructed.has(key)).toBe(false);
          reconstructed.add(key);
        }

        const expected = new Set<string>();
        for (let y = 0; y < direct.size; y += 1) {
          for (let x = 0; x < direct.size; x += 1) {
            if (direct.getModule(x, y)) {
              expected.add(`${x},${y}`);
            }
          }
        }

        expect(reconstructed).toEqual(expected);
      }
    }
  });

  it("bounds the optional center mark aperture strictly below Reed-Solomon recovery capacity and outside all function patterns", () => {
    expect(getQrCenterMarkAperture(33, "L")).toBeNull();
    expect(getQrCenterMarkAperture(33, "M")).toBeNull();
    expect(getQrCenterMarkAperture(21, "H")).toBeNull();

    let renderedCenterMarkCount = 0;
    for (const url of SAMPLE_PAIRING_URLS) {
      const direct = QrCode.encodeText(url, QrCode.Ecc.HIGH);
      const branded = buildBrandedQrGeometry(direct, "H", { includeCenterMark: true });
      const aperture = branded.centerMark;

      if (aperture !== null) {
        renderedCenterMarkCount += 1;
        const apertureModules = aperture.span * aperture.span;
        const totalModules = direct.size * direct.size;
        // High ECC recovers up to 30% codewords; our center mark occupies < 6% of total area.
        expect(apertureModules / totalModules).toBeLessThan(0.06);

        // Never touches finder patterns, timing lines (x=6 or y=6), format bits (<=8), or alignment patterns.
        expect(aperture.start).toBeGreaterThan(8);
        expect(aperture.end).toBeLessThan(direct.size - 8);
        for (let y = aperture.start; y < aperture.end; y += 1) {
          for (let x = aperture.start; x < aperture.end; x += 1) {
            expect(isQrFunctionModule(x, y, direct.size)).toBe(false);
          }
        }
      }

      // Every dark module outside finder eyes and any valid aperture is preserved verbatim.
      const renderedData = new Set(branded.dataModules.map(([x, y]) => `${x},${y}`));
      for (let y = 0; y < direct.size; y += 1) {
        for (let x = 0; x < direct.size; x += 1) {
          if (isQrFinderModule(x, y, direct.size)) continue;
          const inAperture =
            aperture !== null &&
            x >= aperture.start &&
            x < aperture.end &&
            y >= aperture.start &&
            y < aperture.end;
          if (inAperture) {
            expect(renderedData.has(`${x},${y}`)).toBe(false);
          } else {
            expect(renderedData.has(`${x},${y}`)).toBe(direct.getModule(x, y));
          }
        }
      }
    }

    // Pairing URLs without a central alignment pattern (e.g. Version 6) still show the center mark.
    expect(renderedCenterMarkCount).toBeGreaterThan(0);

    // Across all 40 ISO 18004 QR versions, the aperture must never intersect any function pattern.
    for (let version = QrCode.MIN_VERSION; version <= QrCode.MAX_VERSION; version += 1) {
      const size = version * 4 + 17;
      for (const level of ["Q", "H"] as const) {
        const aperture = getQrCenterMarkAperture(size, level);
        if (aperture === null) continue;
        for (let y = aperture.start; y < aperture.end; y += 1) {
          for (let x = aperture.start; x < aperture.end; x += 1) {
            expect(isQrFunctionModule(x, y, size)).toBe(false);
          }
        }
      }
    }
  });

  it("preserves the central 5x5 alignment pattern intact on Version 7 branded QR codes", () => {
    // 60 ASCII bytes at High ECC encodes strictly to QR Version 7 (size 45, center alignment at (22, 22)).
    const v7Payload = "https://pair.example.test/connect#token=0123456789abcdefghij";
    const direct = QrCode.encodeText(v7Payload, QrCode.Ecc.HIGH);
    expect(direct.version).toBe(7);
    expect(direct.size).toBe(45);
    expect(getQrAlignmentPatternCenters(direct.version)).toContainEqual([22, 22]);

    const branded = buildBrandedQrGeometry(direct, "H", { includeCenterMark: true });
    expect(branded.centerMark).toBeNull();

    const renderedData = new Set(branded.dataModules.map(([x, y]) => `${x},${y}`));
    let darkAlignmentModules = 0;
    for (let y = 20; y <= 24; y += 1) {
      for (let x = 20; x <= 24; x += 1) {
        const expectedDark = direct.getModule(x, y);
        expect(renderedData.has(`${x},${y}`)).toBe(expectedDark);
        if (expectedDark) darkAlignmentModules += 1;
      }
    }
    // A canonical 5x5 alignment pattern has 16 outer-ring + 1 center = 17 dark modules.
    expect(darkAlignmentModules).toBe(17);
  });
});

import { QrCode } from "@t3tools/shared/qrCode";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBrandedQrGeometry,
  encodeQrMatrix,
  getQrCenterMarkAperture,
  isQrFinderModule,
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

  it("bounds the optional center mark aperture strictly below Reed-Solomon recovery capacity and outside function patterns", () => {
    expect(getQrCenterMarkAperture(33, "L")).toBeNull();
    expect(getQrCenterMarkAperture(33, "M")).toBeNull();
    expect(getQrCenterMarkAperture(21, "H")).toBeNull();

    for (const url of SAMPLE_PAIRING_URLS) {
      const direct = QrCode.encodeText(url, QrCode.Ecc.HIGH);
      const branded = buildBrandedQrGeometry(direct, "H", { includeCenterMark: true });
      const aperture = branded.centerMark;

      expect(aperture).not.toBeNull();
      if (!aperture) continue;

      const apertureModules = aperture.span * aperture.span;
      const totalModules = direct.size * direct.size;
      // High ECC recovers up to 30% codewords; our center mark occupies < 6% of total area.
      expect(apertureModules / totalModules).toBeLessThan(0.06);

      // Never touches finder patterns, timing lines (x=6 or y=6), or format bits (<=8).
      expect(aperture.start).toBeGreaterThan(8);
      expect(aperture.end).toBeLessThan(direct.size - 8);

      // Every dark module outside finder eyes and the bounded aperture is preserved verbatim.
      const renderedData = new Set(branded.dataModules.map(([x, y]) => `${x},${y}`));
      for (let y = 0; y < direct.size; y += 1) {
        for (let x = 0; x < direct.size; x += 1) {
          if (isQrFinderModule(x, y, direct.size)) continue;
          const inAperture =
            x >= aperture.start && x < aperture.end && y >= aperture.start && y < aperture.end;
          if (inAperture) {
            expect(renderedData.has(`${x},${y}`)).toBe(false);
          } else {
            expect(renderedData.has(`${x},${y}`)).toBe(direct.getModule(x, y));
          }
        }
      }
    }
  });
});

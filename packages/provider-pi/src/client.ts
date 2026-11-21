import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { OmpSettings, PiSettings } from "./settings.ts";

export const piClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("pi"),
  label: "Pi",
  acpRegistryAgentIds: ["pi-acp"],
  settingsSchema: PiSettings,
  icon: {
    viewBox: "165.29 165.29 469.43 469.43",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [
      {
        d: "M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z",
        fillRule: "evenodd",
      },
      { d: "M517.36 400H634.72V634.72H517.36Z" },
    ],
  },
});

export const ompClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("omp"),
  label: "OMP",
  settingsSchema: OmpSettings,
  // https://omp.sh/favicon.svg, expressed in provider-icon coordinates.
  icon: {
    viewBox: "0 0 64 64",
    fill: { light: "#0f0a14", dark: "#0f0a14" },
    paths: [
      {
        d: "M12 0h40a12 12 0 0 1 12 12v40a12 12 0 0 1-12 12H12A12 12 0 0 1 0 52V12A12 12 0 0 1 12 0Z",
      },
      {
        d: "M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z",
        gradient: {
          x1: 14,
          y1: 16,
          x2: 53.779,
          y2: 51.801,
          stops: [
            { offset: 0, color: "#ed4abf" },
            { offset: 0.5, color: "#9b4dff" },
            { offset: 1, color: "#5ad8e6" },
          ],
        },
      },
    ],
  },
});

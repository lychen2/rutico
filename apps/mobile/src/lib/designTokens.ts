export const MOBILE_SHAPE = {
  group: { ios: 24, android: 28 },
  toast: 26,
  glass: 32,
  sheetCorner: 28,
  capsuleCard: 24,
  menuOuter: 16,
  menuInner: 10,
  pill: 9999,
} as const;

export const MOBILE_MOTION = {
  adjust: 120,
  enter: 200,
  exit: 150,
  sheetEdgeThreshold: 48,
  pullRefreshThreshold: 64,
  pullCreateThreshold: 104,
  edgeBackExclusionWidth: 28,
  toastFlingVelocity: 650,
} as const;

export interface AndroidSurfaceChrome {
  readonly boxShadow: ReadonlyArray<{
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blurRadius: number;
    readonly spreadDistance?: number;
    readonly color: string;
  }>;
  readonly specularTopBorderColor: string;
  readonly borderColor: string;
}

/**
 * Material 3 tonal elevation chrome for Android surfaces: dual-layer GPU boxShadow
 * plus a crisp 1px top specular highlight edge (zero blur / zero iOS Glass dependency).
 */
export function androidTonalSurfaceChrome(
  isDark: boolean,
  elevation: "low" | "medium" | "high" = "medium",
): AndroidSurfaceChrome {
  if (elevation === "low") {
    return {
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 2,
          blurRadius: 8,
          color: isDark ? "rgba(0, 0, 0, 0.30)" : "rgba(0, 0, 0, 0.08)",
        },
      ],
      specularTopBorderColor: isDark ? "rgba(255, 255, 255, 0.10)" : "rgba(255, 255, 255, 0.58)",
      borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)",
    };
  }
  if (elevation === "high") {
    return {
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 10,
          blurRadius: 28,
          color: isDark ? "rgba(0, 0, 0, 0.44)" : "rgba(0, 0, 0, 0.14)",
        },
        {
          offsetX: 0,
          offsetY: 2,
          blurRadius: 6,
          color: isDark ? "rgba(0, 0, 0, 0.28)" : "rgba(0, 0, 0, 0.07)",
        },
      ],
      specularTopBorderColor: isDark ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.78)",
      borderColor: isDark ? "rgba(255, 255, 255, 0.11)" : "rgba(15, 23, 42, 0.10)",
    };
  }
  return {
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 6,
        blurRadius: 18,
        color: isDark ? "rgba(0, 0, 0, 0.36)" : "rgba(0, 0, 0, 0.12)",
      },
      {
        offsetX: 0,
        offsetY: 1,
        blurRadius: 4,
        color: isDark ? "rgba(0, 0, 0, 0.22)" : "rgba(0, 0, 0, 0.06)",
      },
    ],
    specularTopBorderColor: isDark ? "rgba(255, 255, 255, 0.13)" : "rgba(255, 255, 255, 0.68)",
    borderColor: isDark ? "rgba(255, 255, 255, 0.09)" : "rgba(15, 23, 42, 0.09)",
  };
}

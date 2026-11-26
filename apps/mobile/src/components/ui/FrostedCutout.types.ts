export interface FrostedCutoutLockRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FrostedCutoutProps {
  readonly cutoutTop: number;
  readonly cutoutWidth: number;
  readonly cutoutHeight: number;
  readonly cutoutRadius: number;
  readonly appearance: "light" | "dark";
  readonly locked?: boolean;
  readonly lockRect?: FrostedCutoutLockRect | null;
}

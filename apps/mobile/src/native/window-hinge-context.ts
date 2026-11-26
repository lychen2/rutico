import { createContext } from "react";
import type { VerticalHinge } from "../lib/layout";

export type FoldOrientation = "vertical" | "horizontal";
export type FoldPostureKind = "book" | "tabletop";

export interface AndroidFoldPosture {
  readonly orientation: FoldOrientation;
  readonly posture: FoldPostureKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly windowX: number;
  readonly windowY: number;
  /** Hardware hinge angle in degrees when backed by TYPE_HINGE_ANGLE; null without sensor. */
  readonly angle: number | null;
  readonly hasAngleSensor: boolean;
}

/** A creased vertical hinge in window coordinates, for overlays placed in window space. */
export const WindowHingeContext = createContext<VerticalHinge | null>(null);

/** Active foldable posture (book or tabletop) in view/window coordinates, or null when flat. */
export const FoldPostureContext = createContext<AndroidFoldPosture | null>(null);

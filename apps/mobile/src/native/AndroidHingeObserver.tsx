import type { VerticalHinge } from "../lib/layout";
import type { AndroidFoldPosture } from "./window-hinge-context";

export function AndroidHingeObserver(_props: {
  readonly onChange: (hinge: VerticalHinge | null, windowHinge: VerticalHinge | null) => void;
  readonly onPostureChange?: (posture: AndroidFoldPosture | null) => void;
}) {
  return null;
}

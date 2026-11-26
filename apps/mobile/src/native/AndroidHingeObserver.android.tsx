import { requireNativeView } from "expo";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import type { VerticalHinge } from "../lib/layout";
import type { AndroidFoldPosture, FoldOrientation, FoldPostureKind } from "./window-hinge-context";

interface NativeHingePayload {
  readonly orientation?: FoldOrientation;
  readonly posture?: FoldPostureKind;
  readonly x?: number;
  readonly windowX?: number;
  readonly width?: number;
  readonly y?: number;
  readonly windowY?: number;
  readonly height?: number;
  readonly angle?: number;
  readonly hasAngleSensor?: boolean;
}

interface ObserverProps extends ViewProps {
  readonly onHingeChange: (event: NativeSyntheticEvent<NativeHingePayload>) => void;
}

const Observer = requireNativeView<ObserverProps>("T3FoldPosture");

/**
 * Reports vertical (book) and horizontal (tabletop) foldable hinges in view and window coordinates.
 * `onChange` receives only vertical hinges for side-by-side split alignment; `onPostureChange`
 * receives both book and tabletop postures including y/height bounds and optional hardware angle.
 */
export function AndroidHingeObserver(props: {
  /** Receives a vertical hinge in this view's coordinates and in window coordinates. */
  readonly onChange: (hinge: VerticalHinge | null, windowHinge: VerticalHinge | null) => void;
  /** Receives full vertical (book) or horizontal (tabletop) fold posture bounds. */
  readonly onPostureChange?: (posture: AndroidFoldPosture | null) => void;
}) {
  return (
    <Observer
      pointerEvents="none"
      onHingeChange={({ nativeEvent }) => {
        const {
          x,
          width,
          windowX,
          y,
          height,
          windowY,
          orientation,
          posture,
          angle,
          hasAngleSensor,
        } = nativeEvent;
        if (x === undefined || width === undefined || windowX === undefined) {
          props.onChange(null, null);
          props.onPostureChange?.(null);
          return;
        }
        const resolvedOrientation: FoldOrientation =
          orientation === "horizontal" ? "horizontal" : "vertical";
        const resolvedPosture: FoldPostureKind =
          posture === "tabletop" || resolvedOrientation === "horizontal" ? "tabletop" : "book";
        const resolvedAngle = typeof angle === "number" && Number.isFinite(angle) ? angle : null;
        const fullPosture: AndroidFoldPosture = {
          orientation: resolvedOrientation,
          posture: resolvedPosture,
          x,
          y: y ?? 0,
          width,
          height: height ?? 0,
          windowX,
          windowY: windowY ?? 0,
          angle: resolvedAngle,
          hasAngleSensor: hasAngleSensor === true,
        };
        if (resolvedOrientation === "vertical") {
          props.onChange({ x, width }, { x: windowX, width });
        } else {
          props.onChange(null, null);
        }
        props.onPostureChange?.(fullPosture);
      }}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
    />
  );
}

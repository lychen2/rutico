import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import type { FrostedCutoutLockRect, FrostedCutoutProps } from "./FrostedCutout.types";

const CORNER_SIZE = 24;
const CORNER_STROKE = 3;
const CORNER_RADIUS = 12;
const LOCK_FALLBACK_SQUEEZE_INSET = 12;
const MIN_LOCK_RECT_SPAN = 18;
const CONTAINER_EDGE_PADDING = 12;

export interface ReticleCornerPoint {
  readonly x: number;
  readonly y: number;
}

export interface ReticleCornerTargets {
  readonly topLeft: ReticleCornerPoint;
  readonly topRight: ReticleCornerPoint;
  readonly bottomLeft: ReticleCornerPoint;
  readonly bottomRight: ReticleCornerPoint;
  readonly mode: "resting" | "bounds-lock" | "centered-squeeze";
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolves the 4 corner L-bracket anchor origins (`x`, `y` of each `CORNER_SIZE` view)
 * for resting viewfinder framing, `BarcodeScanningResult.bounds` lock-on, or a graceful
 * centered squeeze fallback when Android CameraX reports empty/degenerate bounds.
 */
export function computeReticleCornerTargets(input: {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly cutoutTop: number;
  readonly cutoutWidth: number;
  readonly cutoutHeight: number;
  readonly locked: boolean;
  readonly lockRect: FrostedCutoutLockRect | null | undefined;
}): ReticleCornerTargets {
  const restingX = (input.containerWidth - input.cutoutWidth) / 2;
  const restingY = input.cutoutTop;
  const restingW = input.cutoutWidth;
  const restingH = input.cutoutHeight;

  let targetX = restingX;
  let targetY = restingY;
  let targetW = restingW;
  let targetH = restingH;
  let mode: ReticleCornerTargets["mode"] = "resting";

  if (input.locked) {
    const rect = input.lockRect;
    const hasValidBounds =
      rect != null &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= MIN_LOCK_RECT_SPAN &&
      rect.height >= MIN_LOCK_RECT_SPAN &&
      input.containerWidth > CORNER_SIZE * 2 &&
      input.containerHeight > CORNER_SIZE * 2;

    if (hasValidBounds) {
      const maxWidth = Math.max(CORNER_SIZE * 2, input.containerWidth - CONTAINER_EDGE_PADDING * 2);
      const maxHeight = Math.max(
        CORNER_SIZE * 2,
        input.containerHeight - CONTAINER_EDGE_PADDING * 2,
      );
      targetW = clamp(rect.width, CORNER_SIZE * 2 + 8, maxWidth);
      targetH = clamp(rect.height, CORNER_SIZE * 2 + 8, maxHeight);
      targetX = clamp(
        rect.x,
        CONTAINER_EDGE_PADDING,
        Math.max(CONTAINER_EDGE_PADDING, input.containerWidth - CONTAINER_EDGE_PADDING - targetW),
      );
      targetY = clamp(
        rect.y,
        CONTAINER_EDGE_PADDING,
        Math.max(CONTAINER_EDGE_PADDING, input.containerHeight - CONTAINER_EDGE_PADDING - targetH),
      );
      mode = "bounds-lock";
    } else {
      const squeeze = Math.min(
        LOCK_FALLBACK_SQUEEZE_INSET,
        Math.max(0, (restingW - CORNER_SIZE * 2) / 2),
        Math.max(0, (restingH - CORNER_SIZE * 2) / 2),
      );
      targetX = restingX + squeeze;
      targetY = restingY + squeeze;
      targetW = restingW - squeeze * 2;
      targetH = restingH - squeeze * 2;
      mode = "centered-squeeze";
    }
  }

  return {
    topLeft: { x: targetX, y: targetY },
    topRight: { x: targetX + targetW - CORNER_SIZE, y: targetY },
    bottomLeft: { x: targetX, y: targetY + targetH - CORNER_SIZE },
    bottomRight: { x: targetX + targetW - CORNER_SIZE, y: targetY + targetH - CORNER_SIZE },
    mode,
  };
}

export function FrostedCutout(props: FrostedCutoutProps) {
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const light = props.appearance === "light";
  const locked = props.locked === true;

  const x = (width - props.cutoutWidth) / 2;
  const y = props.cutoutTop;
  const w = props.cutoutWidth;
  const h = props.cutoutHeight;
  const r = Math.min(props.cutoutRadius, w / 2, h / 2);
  const hole = `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

  const targets = computeReticleCornerTargets({
    containerWidth: width,
    containerHeight: height,
    cutoutTop: props.cutoutTop,
    cutoutWidth: props.cutoutWidth,
    cutoutHeight: props.cutoutHeight,
    locked,
    lockRect: props.lockRect,
  });

  const tlX = useSharedValue(targets.topLeft.x);
  const tlY = useSharedValue(targets.topLeft.y);
  const trX = useSharedValue(targets.topRight.x);
  const trY = useSharedValue(targets.topRight.y);
  const blX = useSharedValue(targets.bottomLeft.x);
  const blY = useSharedValue(targets.bottomLeft.y);
  const brX = useSharedValue(targets.bottomRight.x);
  const brY = useSharedValue(targets.bottomRight.y);
  const bracketScale = useSharedValue(1);
  const hasSnappedLayoutRef = useRef(false);
  const hasLaidOutRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives Reanimated 4 corner-bracket springs to track cutout geometry and barcode lock-on bounds
  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    if (!hasLaidOutRef.current) {
      hasLaidOutRef.current = true;
      tlX.set(targets.topLeft.x);
      tlY.set(targets.topLeft.y);
      trX.set(targets.topRight.x);
      trY.set(targets.topRight.y);
      blX.set(targets.bottomLeft.x);
      blY.set(targets.bottomLeft.y);
      brX.set(targets.bottomRight.x);
      brY.set(targets.bottomRight.y);
      bracketScale.set(locked ? 1.04 : 1);
      return;
    }
    tlX.set(withSpring(targets.topLeft.x, SPRING_SPATIAL_SNAPPY));
    tlY.set(withSpring(targets.topLeft.y, SPRING_SPATIAL_SNAPPY));
    trX.set(withSpring(targets.topRight.x, SPRING_SPATIAL_SNAPPY));
    trY.set(withSpring(targets.topRight.y, SPRING_SPATIAL_SNAPPY));
    blX.set(withSpring(targets.bottomLeft.x, SPRING_SPATIAL_SNAPPY));
    blY.set(withSpring(targets.bottomLeft.y, SPRING_SPATIAL_SNAPPY));
    brX.set(withSpring(targets.bottomRight.x, SPRING_SPATIAL_SNAPPY));
    brY.set(withSpring(targets.bottomRight.y, SPRING_SPATIAL_SNAPPY));
    bracketScale.set(withSpring(locked ? 1.04 : 1, SPRING_SPATIAL_SNAPPY));
  }, [
    blX,
    blY,
    bracketScale,
    brX,
    brY,
    height,
    locked,
    targets.bottomLeft.x,
    targets.bottomLeft.y,
    targets.bottomRight.x,
    targets.bottomRight.y,
    targets.topLeft.x,
    targets.topLeft.y,
    targets.topRight.x,
    targets.topRight.y,
    tlX,
    tlY,
    trX,
    trY,
    width,
  ]);

  const tlStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tlX.get() },
      { translateY: tlY.get() },
      { scale: bracketScale.get() },
    ],
  }));
  const trStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: trX.get() },
      { translateY: trY.get() },
      { scale: bracketScale.get() },
    ],
  }));
  const blStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: blX.get() },
      { translateY: blY.get() },
      { scale: bracketScale.get() },
    ],
  }));
  const brStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: brX.get() },
      { translateY: brY.get() },
      { scale: bracketScale.get() },
    ],
  }));

  const bracketColor = locked
    ? light
      ? "#059669"
      : "#34d399"
    : light
      ? "rgba(24,24,27,0.86)"
      : "rgba(255,255,255,0.92)";
  const rimStroke = locked
    ? light
      ? "rgba(5,150,105,0.55)"
      : "rgba(52,211,153,0.65)"
    : light
      ? "rgba(255,255,255,0.58)"
      : "rgba(255,255,255,0.22)";

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        const nextHeight = event.nativeEvent.layout.height;
        if (!hasSnappedLayoutRef.current && nextWidth > 0 && nextHeight > 0) {
          hasSnappedLayoutRef.current = true;
          const initial = computeReticleCornerTargets({
            containerWidth: nextWidth,
            containerHeight: nextHeight,
            cutoutTop: props.cutoutTop,
            cutoutWidth: props.cutoutWidth,
            cutoutHeight: props.cutoutHeight,
            locked,
            lockRect: props.lockRect,
          });
          tlX.set(initial.topLeft.x);
          tlY.set(initial.topLeft.y);
          trX.set(initial.topRight.x);
          trY.set(initial.topRight.y);
          blX.set(initial.bottomLeft.x);
          blY.set(initial.bottomLeft.y);
          brX.set(initial.bottomRight.x);
          brY.set(initial.bottomRight.y);
          bracketScale.set(locked ? 1.04 : 1);
        }
        setWidth(nextWidth);
        setHeight(nextHeight);
      }}
    >
      {width > 0 && height > 0 ? (
        <>
          <Svg height={height} width={width}>
            <Defs>
              <RadialGradient id="cutout-vignette" cx="50%" cy="44%" r="72%">
                <Stop
                  offset="48%"
                  stopColor={light ? "#ffffff" : "#000000"}
                  stopOpacity={light ? 0.42 : 0.48}
                />
                <Stop
                  offset="100%"
                  stopColor={light ? "#e4e4e7" : "#000000"}
                  stopOpacity={light ? 0.72 : 0.78}
                />
              </RadialGradient>
            </Defs>
            {/* Layered radial vignette outside the viewfinder aperture */}
            <Path
              d={`M0,0 H${width} V${height} H0 Z ${hole}`}
              fill="url(#cutout-vignette)"
              fillRule="evenodd"
            />
            {/* Crisp 1px optical specular rim around the cutout */}
            <Rect
              x={x + 0.5}
              y={y + 0.5}
              width={Math.max(0, w - 1)}
              height={Math.max(0, h - 1)}
              rx={Math.max(0, r - 0.5)}
              ry={Math.max(0, r - 0.5)}
              fill="none"
              stroke={rimStroke}
              strokeWidth={1}
            />
          </Svg>

          {/* Four independent Reanimated 4 L-bracket corner reticles */}
          <Animated.View
            style={[
              styles.cornerBase,
              {
                borderTopWidth: CORNER_STROKE,
                borderLeftWidth: CORNER_STROKE,
                borderTopLeftRadius: CORNER_RADIUS,
                borderColor: bracketColor,
              },
              tlStyle,
            ]}
          />
          <Animated.View
            style={[
              styles.cornerBase,
              {
                borderTopWidth: CORNER_STROKE,
                borderRightWidth: CORNER_STROKE,
                borderTopRightRadius: CORNER_RADIUS,
                borderColor: bracketColor,
              },
              trStyle,
            ]}
          />
          <Animated.View
            style={[
              styles.cornerBase,
              {
                borderBottomWidth: CORNER_STROKE,
                borderLeftWidth: CORNER_STROKE,
                borderBottomLeftRadius: CORNER_RADIUS,
                borderColor: bracketColor,
              },
              blStyle,
            ]}
          />
          <Animated.View
            style={[
              styles.cornerBase,
              {
                borderBottomWidth: CORNER_STROKE,
                borderRightWidth: CORNER_STROKE,
                borderBottomRightRadius: CORNER_RADIUS,
                borderColor: bracketColor,
              },
              brStyle,
            ]}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cornerBase: {
    position: "absolute",
    top: 0,
    left: 0,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
});

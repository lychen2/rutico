import { useLayoutEffect } from "react";
import type { ColorValue } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { SymbolView } from "./AppSymbol";

export const THREAD_DISCLOSURE_TRANSITION_MS = 180;

export function ThreadDisclosureChevron(props: {
  readonly expanded: boolean;
  readonly collapsedDirection: "right" | "down";
  readonly size: number;
  readonly tintColor?: ColorValue;
  readonly tintColorClassName?: string;
}) {
  const expandedAngle = props.collapsedDirection === "right" ? 90 : 180;
  const rotation = useSharedValue(props.expanded ? expandedAngle : 0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the chevron's Reanimated rotation value when the expanded state changes
  useLayoutEffect(() => {
    rotation.set(
      withTiming(props.expanded ? expandedAngle : 0, {
        duration: THREAD_DISCLOSURE_TRANSITION_MS,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [expandedAngle, props.expanded, rotation]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width: props.size, height: props.size }, rotationStyle]}
    >
      <SymbolView
        name={props.collapsedDirection === "right" ? "chevron.right" : "chevron.down"}
        size={props.size}
        tintColor={props.tintColor}
        tintColorClassName={props.tintColorClassName}
        type="monochrome"
      />
    </Animated.View>
  );
}

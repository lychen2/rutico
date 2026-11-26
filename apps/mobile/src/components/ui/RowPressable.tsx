import type { ComponentProps, ReactNode } from "react";
import { Pressable } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { cn } from "../../lib/cn";
import { useHoverGesture } from "../../lib/useHoverGesture";

const PRESS_SPRING_CONFIG = {
  damping: 20,
  stiffness: 420,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

const PRESS_HIGHLIGHT_IN_TIMING = {
  duration: 100,
  reduceMotion: ReduceMotion.System,
} as const;

const PRESS_HIGHLIGHT_OUT_TIMING = {
  duration: 150,
  reduceMotion: ReduceMotion.System,
} as const;

export function RowPressable({
  children,
  className,
  interactionClassName = "bg-row-hover",
  interactionOpacity = 1,
  onPressIn,
  onPressOut,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "children"> & {
  readonly children: ReactNode;
  readonly interactionClassName?: string;
  readonly interactionOpacity?: number;
}) {
  const disabled = Boolean(props.disabled);
  const { hovered, hoverGesture } = useHoverGesture(disabled);
  const pressScale = useSharedValue(1);
  const pressHighlight = useSharedValue(0);
  const animatedScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.get() }],
  }));
  const animatedOverlayStyle = useAnimatedStyle(() => {
    if (disabled) return { opacity: 0 };
    const level = hovered ? 1 : pressHighlight.get();
    return { opacity: level * interactionOpacity };
  });
  const fillsRowSlot = typeof className === "string" && /\bflex-(?:1|grow)\b/.test(className);

  return (
    <GestureDetector gesture={hoverGesture}>
      <Animated.View
        style={[fillsRowSlot ? { flex: 1, minWidth: 0 } : { flexShrink: 1 }, animatedScaleStyle]}
      >
        <Pressable
          {...props}
          onPressIn={(event) => {
            if (!disabled) {
              pressScale.set(withSpring(0.984, PRESS_SPRING_CONFIG));
              pressHighlight.set(withTiming(1, PRESS_HIGHLIGHT_IN_TIMING));
            }
            onPressIn?.(event);
          }}
          onPressOut={(event) => {
            pressScale.set(withSpring(1, PRESS_SPRING_CONFIG));
            pressHighlight.set(withTiming(0, PRESS_HIGHLIGHT_OUT_TIMING));
            onPressOut?.(event);
          }}
          className={cn("relative overflow-hidden", className)}
        >
          <Animated.View
            pointerEvents="none"
            className={cn("absolute inset-0", interactionClassName)}
            style={animatedOverlayStyle}
          />
          {children}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

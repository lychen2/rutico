import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormSheet } from "react-native-screens";
import { useResolveClassNames } from "uniwind";

import { MOBILE_MOTION, MOBILE_SHAPE } from "../../lib/designTokens";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_EFFECTS_FAST, SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import { BottomSheetContext } from "./BottomSheetContext";
import type { PaneSheetProps } from "./PaneSheet.types";
export type { PaneSheetProps } from "./PaneSheet.types";

const GRABBER_REST_WIDTH = 32;
const GRABBER_ACTIVE_WIDTH = 48;

/** A native sheet holding a pane that draws its own bar, which runs up under the drawn grabber. */
export function PaneSheet({
  children,
  onDetentChanged,
  onNativeDismissPrevented,
  ...props
}: PaneSheetProps) {
  const containerStyle = useResolveClassNames("bg-header");
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const baseCornerRadius = MOBILE_SHAPE.sheetCorner;
  const [nearStatusBar, setNearStatusBar] = useState(false);

  const grabberActive = useSharedValue(0);
  const topCornerRadius = useSharedValue<number>(baseCornerRadius);

  const handleGrabberTouchStart = () => {
    grabberActive.set(withSpring(1, SPRING_EFFECTS_FAST));
    triggerSemanticHaptic("dragStart");
  };

  const handleGrabberTouchEnd = () => {
    grabberActive.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
  };

  const grabberStyle = useAnimatedStyle(() => {
    const active = grabberActive.get();
    return {
      width: interpolate(
        active,
        [0, 1],
        [GRABBER_REST_WIDTH, GRABBER_ACTIVE_WIDTH],
        Extrapolation.CLAMP,
      ),
      opacity: interpolate(active, [0, 1], [0.42, 0.88], Extrapolation.CLAMP),
      transform: [{ scaleY: interpolate(active, [0, 1], [1, 1.15], Extrapolation.CLAMP) }],
    };
  });

  const surfaceCornerStyle = useAnimatedStyle(() => {
    const radius = topCornerRadius.get();
    return {
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
    };
  });

  const handleContainerLayout = (sheetHeight: number) => {
    const availableHeight = Math.max(1, windowHeight - insets.top);
    const remainingToTop = Math.max(0, availableHeight - sheetHeight);
    const ratio = Math.min(1, remainingToTop / MOBILE_MOTION.sheetEdgeThreshold);
    const nextRadius = Math.round(baseCornerRadius * ratio);
    topCornerRadius.set(withSpring(nextRadius, SPRING_SPATIAL_SNAPPY));
    const isNearTop = remainingToTop <= 8;
    if (isNearTop !== nearStatusBar) setNearStatusBar(isNearTop);
  };

  return (
    <FormSheet
      {...props}
      preferredCornerRadius={nearStatusBar ? 0 : baseCornerRadius}
      nativeContainerStyle={containerStyle}
      onDetentChanged={(event) => {
        grabberActive.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
        triggerSemanticHaptic("segmentTick");
        onDetentChanged?.(event);
      }}
      onNativeDismissPrevented={(event) => {
        triggerSemanticHaptic("reject");
        onNativeDismissPrevented?.(event);
      }}
    >
      <BottomSheetContext value>
        {/* Android FormSheet does not bound flex children. */}
        <Animated.View
          collapsable={false}
          className="absolute inset-0 overflow-hidden bg-header pt-3"
          style={surfaceCornerStyle}
          onLayout={(event) => handleContainerLayout(event.nativeEvent.layout.height)}
        >
          {children}
          {/* Constrained centered pill with passive touch hooks so pane header buttons and native FormSheet drag remain unblocked. */}
          <View pointerEvents="box-none" className="absolute inset-x-0 top-0 items-center">
            <View
              onTouchStart={handleGrabberTouchStart}
              onTouchEnd={handleGrabberTouchEnd}
              onTouchCancel={handleGrabberTouchEnd}
              className="h-4 w-16 items-center justify-center pt-1"
            >
              <Animated.View
                pointerEvents="none"
                className="h-1 rounded-full bg-header-foreground"
                style={grabberStyle}
              />
            </View>
          </View>
        </Animated.View>
      </BottomSheetContext>
    </FormSheet>
  );
}

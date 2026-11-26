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
import { AppBar } from "./AppBar";
import { BottomSheetContext } from "./BottomSheetContext";
import { RoutedFormSheetContext } from "./RoutedFormSheetContext";
import { ScreenContent } from "./ScreenContent";
import type { SheetProps } from "./Sheet.types";
export type { SheetProps } from "./Sheet.types";

const GRABBER_REST_WIDTH = 32;
const GRABBER_ACTIVE_WIDTH = 48;

export function Sheet(props: SheetProps) {
  const containerStyle = useResolveClassNames("bg-header");
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(true);
  const [nearStatusBar, setNearStatusBar] = useState(false);

  const grabberActive = useSharedValue(0);
  const topCornerRadius = useSharedValue<number>(MOBILE_SHAPE.sheetCorner);

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
    const nextRadius = Math.round(MOBILE_SHAPE.sheetCorner * ratio);
    topCornerRadius.set(withSpring(nextRadius, SPRING_SPATIAL_SNAPPY));
    const isNearTop = remainingToTop <= 8;
    if (isNearTop !== nearStatusBar) setNearStatusBar(isNearTop);
  };

  return (
    <FormSheet
      isOpen={isOpen}
      detents={[0.5, 0.9]}
      prefersGrabberVisible={false}
      preferredCornerRadius={nearStatusBar ? 0 : MOBILE_SHAPE.sheetCorner}
      preventNativeDismiss={props.dismissDisabled}
      nativeContainerStyle={containerStyle}
      onDetentChanged={() => {
        grabberActive.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
        triggerSemanticHaptic("segmentTick");
      }}
      onNativeDismissPrevented={() => {
        triggerSemanticHaptic("reject");
      }}
      onDismiss={props.onClose}
      onNativeDismiss={props.onClose}
    >
      <BottomSheetContext value>
        <RoutedFormSheetContext value={false}>
          {/* Android FormSheet does not bound flex children. */}
          <Animated.View
            collapsable={false}
            className="absolute inset-0 overflow-hidden bg-header"
            style={surfaceCornerStyle}
            onLayout={(event) => handleContainerLayout(event.nativeEvent.layout.height)}
          >
            <AppBar
              sheet
              title={props.title}
              onBack={props.dismissDisabled ? undefined : () => setIsOpen(false)}
              hideBottomBorder
            />
            <ScreenContent>{props.children}</ScreenContent>
            {/* Constrained centered pill with passive touch hooks so AppBar controls and native FormSheet drag remain unblocked. */}
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
        </RoutedFormSheetContext>
      </BottomSheetContext>
    </FormSheet>
  );
}

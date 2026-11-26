import { useGT } from "gt-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated as RNAnimated,
  Easing as RNEasing,
  Platform,
  StyleSheet,
  useAnimatedValue,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  FadeOut,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type EntryAnimationsValues,
} from "react-native-reanimated";

import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { androidTonalSurfaceChrome, MOBILE_MOTION, MOBILE_SHAPE } from "../../lib/designTokens";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_DETENT_SNAP } from "../../lib/mobileMotion";
import { AppActivityIndicator } from "./AppActivityIndicator";
import { SymbolView } from "./AppSymbol";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { GlassSurface } from "./GlassSurface";
import { IconButton } from "./IconButton";
import { useControlTheme } from "./useControlTheme";

export type ToastProps = {
  readonly message: string;
  readonly description?: string;
  readonly singleLine?: boolean;
  readonly tone?: "default" | "success" | "danger";
  readonly busy?: boolean;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** Optional linear countdown bar duration (ms), paused automatically while held/dragged. */
  readonly countdownMs?: number;
  /** External pause override for the countdown bar. */
  readonly countdownPaused?: boolean;
  readonly onHoldChange?: (held: boolean) => void;
} & (
  | { readonly dismissMode: "swipe"; readonly onDismiss: () => void }
  | { readonly dismissMode?: "button"; readonly onDismiss?: () => void }
);

export function Toast(props: ToastProps) {
  return props.dismissMode === "swipe" ? (
    <SwipeableToast {...props} />
  ) : (
    <ToastContent {...props} />
  );
}

function ToastCountdownHairline(props: {
  readonly durationMs: number;
  readonly paused: boolean;
  readonly tone: ToastProps["tone"];
}) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const progress = useAnimatedValue(1, { useNativeDriver: true });
  const remainingRef = useRef(1);

  // Obeys DISABLE_COMMIT_PAUSING_MECHANISM by driving the continuous countdown with RN Animated.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks RN Animated value progress so press-hold can pause and resume cleanly
  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      remainingRef.current = value;
    });
    return () => {
      progress.removeListener(id);
    };
  }, [progress]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs or pauses the native countdown hairline based on hold, focus, and reduced motion
  useEffect(() => {
    if (reducedMotion || !appActive) {
      progress.stopAnimation();
      return;
    }
    if (props.paused) {
      progress.stopAnimation((value) => {
        remainingRef.current = value;
      });
      return;
    }
    const remainingFraction = Math.max(0, Math.min(1, remainingRef.current));
    if (remainingFraction <= 0) return;
    const animation = RNAnimated.timing(progress, {
      toValue: 0,
      duration: Math.max(80, Math.round(props.durationMs * remainingFraction)),
      easing: RNEasing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [appActive, progress, props.durationMs, props.paused, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <View
      pointerEvents="none"
      className="h-[2px] w-full overflow-hidden bg-border/40"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <RNAnimated.View
        className={cn(
          "h-full w-full",
          props.tone === "danger"
            ? "bg-danger-foreground"
            : props.tone === "success"
              ? "bg-adaptive-emerald-600-400"
              : "bg-primary",
        )}
        style={{
          transformOrigin: "left",
          transform: [{ scaleX: progress }],
        }}
      />
    </View>
  );
}

function ToastContent(
  props: ToastProps & { readonly glassReady?: boolean; readonly held?: boolean },
) {
  const gt = useGT();
  const { fontScale } = useWindowDimensions();
  const { colorScheme } = useControlTheme();
  const isDark = colorScheme === "dark";
  const borderRadius = Platform.OS === "ios" ? 28 : MOBILE_SHAPE.toast;
  // Explicit single-line notices reserve the action's width and truncate the text.
  const inlineAction = props.singleLine || (!props.description && fontScale < 1.5);
  const message =
    props.singleLine && props.description
      ? `${props.message}: ${props.description}`
      : props.message;
  const action = props.action ? (
    <Button
      label={props.action.label}
      onPress={props.action.onPress}
      size={Platform.OS === "ios" ? "compact" : "default"}
    />
  ) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- announces the toast message to VoiceOver and triggers arrival haptic feedback
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(props.message);
    if (props.busy) return;
    if (props.tone === "danger") {
      triggerSemanticHaptic("reject");
    } else if (props.tone === "success") {
      triggerSemanticHaptic("confirm");
    } else {
      triggerSemanticHaptic("contextClick");
    }
  }, [props.busy, props.message, props.tone]);

  const androidChrome = androidTonalSurfaceChrome(isDark, "high");
  const countdownPaused = Boolean(props.held || props.countdownPaused);

  const surface = (
    <GlassSurface
      key={props.glassReady === false ? "entering" : "settled"}
      chrome={Platform.OS === "ios" && isDark ? "none" : undefined}
      tintColor={Platform.OS === "ios" ? null : undefined}
      className={Platform.OS === "ios" ? "bg-transparent p-2" : "overflow-hidden bg-card-alt"}
      style={{
        borderRadius,
        ...(Platform.OS === "android"
          ? {
              borderWidth: 1,
              borderColor: androidChrome.borderColor,
              borderTopColor: androidChrome.specularTopBorderColor,
            }
          : null),
      }}
    >
      <View className={Platform.OS === "ios" ? undefined : "p-3"}>
        <View
          className={cn(
            "flex-row items-center gap-3",
            // Match the leading inset to the action label's, which sits inside the button's padding.
            Platform.OS === "ios" && inlineAction && action && "pl-5",
          )}
        >
          {props.busy ? (
            <AppActivityIndicator />
          ) : (
            <SymbolView
              name={
                props.tone === "danger"
                  ? "exclamationmark.triangle"
                  : props.tone === "success"
                    ? "checkmark.circle"
                    : "info.circle"
              }
              size={20}
              tintColorClassName={
                props.tone === "danger"
                  ? "accent-danger-foreground"
                  : props.tone === "success"
                    ? "accent-adaptive-emerald-600-400"
                    : "accent-icon"
              }
            />
          )}
          <View className="min-w-0 flex-1" accessibilityLiveRegion="polite">
            <AppText
              textRole="footnote"
              className="font-t3-semibold"
              numberOfLines={props.singleLine ? 1 : undefined}
              accessibilityLabel={props.singleLine ? message : undefined}
            >
              {message}
            </AppText>
            {props.description && !props.singleLine ? (
              <AppText textRole="label" className="text-foreground-muted">
                {props.description}
              </AppText>
            ) : null}
          </View>
          {inlineAction && action ? <View className="self-center">{action}</View> : null}
          {props.onDismiss && props.dismissMode !== "swipe" ? (
            <IconButton
              accessibilityLabel={gt("Dismiss message")}
              icon="xmark"
              onPress={props.onDismiss}
            />
          ) : null}
        </View>
        {action && !inlineAction ? <View className="mt-2 self-end">{action}</View> : null}
      </View>
      {props.countdownMs !== undefined && props.countdownMs > 0 ? (
        <ToastCountdownHairline
          durationMs={props.countdownMs}
          paused={countdownPaused}
          tone={props.tone}
        />
      ) : null}
    </GlassSurface>
  );

  return Platform.OS === "ios" ? (
    <View
      style={{
        borderRadius,
        boxShadow: [
          {
            offsetX: 0,
            offsetY: 0,
            blurRadius: 8,
            color: isDark ? "rgba(0, 0, 0, 0.22)" : "rgba(0, 0, 0, 0.08)",
          },
        ],
      }}
    >
      {surface}
    </View>
  ) : (
    <View
      style={{
        borderRadius,
        boxShadow: [...androidChrome.boxShadow],
      }}
    >
      {surface}
    </View>
  );
}

const ENTER_TIMING = {
  duration: MOBILE_MOTION.enter,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const TOAST_EXITING = FadeOut.duration(MOBILE_MOTION.exit).reduceMotion(ReduceMotion.System);
const TOAST_FLING_VELOCITY = MOBILE_MOTION.toastFlingVelocity;

function triggerToastDismissHaptic() {
  triggerSemanticHaptic("gestureEnd");
}

function SwipeableToast(props: ToastProps & { readonly onDismiss: () => void }) {
  const gt = useGT();
  const [glassReady, setGlassReady] = useState(Platform.OS !== "ios");
  const [held, setHeld] = useState(false);
  const finishEntering = useCallback(() => setGlassReady(true), []);
  const { onDismiss, onHoldChange } = props;

  const updateHeld = useCallback(
    (next: boolean) => {
      setHeld(next);
      onHoldChange?.(next);
    },
    [onHoldChange],
  );

  // UIKit can skip glass on a moving host; remount the surface after entry so its blur installs.
  const toastEntering = (values: EntryAnimationsValues) => {
    "worklet";
    return {
      initialValues: { originY: values.targetOriginY + values.targetHeight + 12 },
      animations: { originY: withTiming(values.targetOriginY, ENTER_TIMING) },
      callback: (finished: boolean) => {
        if (finished) runOnJS(finishEntering)();
      },
    };
  };

  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(56);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the Reanimated omni-axis swipe animations on unmount
  useLayoutEffect(
    () => () => {
      cancelAnimation(translationX);
      cancelAnimation(translationY);
    },
    [translationX, translationY],
  );

  const gesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory, not a React component.
      Gesture.Pan()
        .minDistance(4)
        .onBegin(() => {
          cancelAnimation(translationX);
          cancelAnimation(translationY);
          runOnJS(updateHeld)(true);
        })
        .onUpdate((event) => {
          translationX.set(event.translationX);
          translationY.set(event.translationY * 0.85);
        })
        .onEnd((event) => {
          const currentWidth = Math.max(width.get(), 240);
          const currentHeight = Math.max(height.get(), 56);
          const tx = translationX.get();
          const ty = translationY.get();
          const absVx = Math.abs(event.velocityX);
          const absVy = Math.abs(event.velocityY);

          const dismissHorizontal =
            Math.abs(tx) > currentWidth * 0.25 ||
            (absVx > TOAST_FLING_VELOCITY && tx * event.velocityX >= 0 && absVx >= absVy);
          const dismissVertical =
            Math.abs(ty) > Math.max(44, currentHeight * 0.72) ||
            (absVy > TOAST_FLING_VELOCITY && ty * event.velocityY >= 0 && absVy > absVx);

          if (dismissHorizontal) {
            const direction = Math.sign(tx || event.velocityX || 1);
            const duration = Math.max(
              90,
              Math.min(180, Math.round((currentWidth / Math.max(absVx, 900)) * 220)),
            );
            runOnJS(triggerToastDismissHaptic)();
            translationX.set(
              withTiming(
                direction * (currentWidth + 32),
                {
                  duration,
                  easing: Easing.out(Easing.cubic),
                  reduceMotion: ReduceMotion.System,
                },
                (finished) => {
                  if (finished) runOnJS(onDismiss)();
                },
              ),
            );
            translationY.set(
              withTiming(ty + event.velocityY * 0.08, {
                duration,
                easing: Easing.out(Easing.cubic),
                reduceMotion: ReduceMotion.System,
              }),
            );
            return;
          }

          if (dismissVertical) {
            const direction = Math.sign(ty || event.velocityY || 1);
            const targetY = direction * (currentHeight + 84);
            const duration = Math.max(
              90,
              Math.min(180, Math.round((140 / Math.max(absVy, 900)) * 240)),
            );
            runOnJS(triggerToastDismissHaptic)();
            translationY.set(
              withTiming(
                targetY,
                {
                  duration,
                  easing: Easing.out(Easing.cubic),
                  reduceMotion: ReduceMotion.System,
                },
                (finished) => {
                  if (finished) runOnJS(onDismiss)();
                },
              ),
            );
            translationX.set(
              withTiming(tx + event.velocityX * 0.06, {
                duration,
                easing: Easing.out(Easing.cubic),
                reduceMotion: ReduceMotion.System,
              }),
            );
            return;
          }

          translationX.set(withSpring(0, SPRING_DETENT_SNAP));
          translationY.set(withSpring(0, SPRING_DETENT_SNAP));
        })
        .onFinalize(() => {
          runOnJS(updateHeld)(false);
        }),
    [height, onDismiss, translationX, translationY, updateHeld, width],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const tx = translationX.get();
    const ty = translationY.get();
    const currentWidth = Math.max(width.get(), 1);
    const horizontalRatio = Math.min(1, Math.abs(tx) / currentWidth);
    const verticalRatio = Math.min(1, Math.abs(ty) / 96);
    const dragRatio = Math.max(horizontalRatio, verticalRatio);
    const tiltDeg = Math.max(-4, Math.min(4, (tx / currentWidth) * 6));
    return {
      opacity: 1 - dragRatio * 0.48,
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotate: `${tiltDeg}deg` },
        { scale: 1 - dragRatio * 0.035 },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      exiting={TOAST_EXITING}
      onAccessibilityEscape={onDismiss}
      onLayout={(event) => {
        width.set(event.nativeEvent.layout.width);
        height.set(event.nativeEvent.layout.height);
      }}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View collapsable={false} entering={toastEntering} style={animatedStyle}>
          {Platform.OS === "android" ? (
            // Keep the dismiss target separate so TalkBack can also focus the action button.
            <View
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={props.message}
              accessibilityActions={[{ name: "dismiss", label: gt("Dismiss message") }]}
              onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === "dismiss") onDismiss();
              }}
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <ToastContent {...props} glassReady={glassReady} held={held} />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

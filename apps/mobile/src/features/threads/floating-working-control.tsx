import type { SubagentPillSegment } from "@t3tools/client-runtime/state/thread-subagents";
import { useIsFocused } from "@react-navigation/native";
import { GlassContainer, GlassView } from "expo-glass-effect";
import { useGT } from "gt-react-native";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  useAnimatedValue,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  ReduceMotion,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { GlassBackdrop } from "../../components/ui/GlassBackdrop";
import { useAppActive } from "../../lib/appState";
import { androidTonalSurfaceChrome, MOBILE_SHAPE } from "../../lib/designTokens";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY, startNativePulseLoop } from "../../lib/mobileMotion";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { BrowserPreviewButton } from "../browser/browser-preview-button";
import { DevicePreviewButton } from "../devices/device-preview-button";
import type { FloatingStatusAction, FloatingWorkingStatus } from "./floating-working-status";
import { ShimmeringWorkContent } from "./thread-work-log";

const CONTROL_HEIGHT = 38.5;
const CONTROL_GAP = 8;
const COMPOSER_CAPSULE_INSET = 6;
const GLASS_MERGE_SPACING = 12;
const CONTROL_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const CONTROL_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const CONTROL_TIMING = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const CONTROL_ROW_GAP = 14;
const CONTROL_SEPARATION = (CONTROL_ROW_GAP + CONTROL_HEIGHT) / 2;
const LABEL_ENTERING = FadeIn.duration(160).delay(80).reduceMotion(ReduceMotion.System);
const LABEL_EXITING = FadeOut.duration(100).reduceMotion(ReduceMotion.System);
const EXPANDED_BODY_ENTERING = FadeIn.duration(150).reduceMotion(ReduceMotion.System);
const EXPANDED_BODY_EXITING = FadeOut.duration(100).reduceMotion(ReduceMotion.System);

// Expo reapplies glass after layout or reattachment, restoring material UIKit can lose behind visible labels.
const UniwindGlassView = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});
const UniwindGlassContainer = withUniwind(GlassContainer, {
  style: { fromClassName: "className" },
});
const AnimatedGlassView = Animated.createAnimatedComponent(UniwindGlassView);

// Segment widths feed back into labelWidth; ignore sub-point changes to avoid rounding-driven ellipsis loops.
function settleWidth(next: number) {
  return (current: number) => (Math.abs(current - next) < 1 ? current : next);
}

const CONTROL_OVERLAY_OFFSET = CONTROL_HEIGHT + CONTROL_GAP - COMPOSER_CAPSULE_INSET;
export const FLOATING_WORKING_CONTROL_COVERAGE = CONTROL_OVERLAY_OFFSET + CONTROL_GAP;

function CapsuleActivityHalo(props: { readonly tone: "primary" | "warning" | "danger" }) {
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const shouldPulse = appActive && isFocused && !reducedMotion;
  const pulse = useAnimatedValue(0, { useNativeDriver: true });

  // Safe RN Animated native pulse obeys DISABLE_COMMIT_PAUSING_MECHANISM: true.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives native pulse halo on the Android Dynamic Capsule when active, focused, and motion is allowed
  useEffect(
    () =>
      startNativePulseLoop(pulse, {
        active: shouldPulse,
        duration: 1650,
        mode: "expand",
      }),
    [pulse, shouldPulse],
  );

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.35],
  });

  const dotClass =
    props.tone === "danger"
      ? "bg-danger-foreground"
      : props.tone === "warning"
        ? "bg-warning-foreground"
        : "bg-primary";

  return (
    <View className="relative size-2.5 items-center justify-center">
      {shouldPulse ? (
        <RNAnimated.View
          pointerEvents="none"
          className={`absolute inset-0 rounded-full ${dotClass}`}
          style={{ opacity, transform: [{ scale }] }}
        />
      ) : null}
      <View className={`size-2 rounded-full ${dotClass}`} />
    </View>
  );
}

function UnreadStreamBreathDot(props: { readonly active: boolean }) {
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const shouldPulse = props.active && appActive && isFocused && !reducedMotion;
  const pulse = useAnimatedValue(0, { useNativeDriver: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives native breathing unread indicator on Scroll-to-End while new tokens stream
  useEffect(
    () =>
      startNativePulseLoop(pulse, {
        active: shouldPulse,
        duration: 1500,
        mode: "breathe",
      }),
    [pulse, shouldPulse],
  );

  if (!props.active) return null;

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.18],
  });

  return (
    <RNAnimated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary"
      style={shouldPulse ? { opacity, transform: [{ scale }] } : undefined}
    />
  );
}

export function FloatingWorkingControl(props: {
  readonly colorScheme: "light" | "dark";
  readonly status: FloatingWorkingStatus | null;
  readonly extensionStatus?: { readonly label: string; readonly onPress: () => void } | null;
  readonly devicePreview: { readonly count: number; readonly onPress: () => void } | null;
  readonly browserPreview: { readonly count: number; readonly onPress: () => void } | null;
  readonly showScrollToEnd: boolean;
  readonly onScrollToEnd: () => void;
  /** True while new streaming tokens arrive off-screen below the viewport. */
  readonly hasUnreadStream?: boolean;
  readonly agents: SubagentPillSegment | null;
  readonly onOpenAgents: () => void;
  readonly queuedCount: number;
  readonly onOpenQueue: () => void;
  readonly lift?: SharedValue<number>;
}) {
  const gt = useGT();
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [overlayWidth, setOverlayWidth] = useState(windowWidth);
  const [queueWidth, setQueueWidth] = useState(0);
  const [actionWidth, setActionWidth] = useState(0);
  const [extensionWidth, setExtensionWidth] = useState(0);
  const [capsuleExpanded, setCapsuleExpanded] = useState(false);
  const extensionStatus = props.extensionStatus ?? null;
  const extensionOnly = props.status?.kind === "extension";
  const useGlass = NATIVE_LIQUID_GLASS_SUPPORTED && !extensionOnly;
  const actions: ReadonlyArray<FloatingStatusAction> =
    props.status?.kind === "goal"
      ? props.status.actions
      : props.status?.kind === "stop" && props.status.action !== null
        ? [props.status.action]
        : [];
  const [agentsWidth, setAgentsWidth] = useState(0);
  const hasQueue = props.queuedCount > 0;
  const hasPreview = props.devicePreview !== null || props.browserPreview !== null;
  const [previewWidth, setPreviewWidth] = useState(0);
  const agents = props.agents;
  const hasAgents = agents !== null;
  const hasStatus = props.status !== null;
  const hasCapsule = hasStatus || hasQueue || hasAgents || hasPreview;
  const isAndroidDynamicCapsule = Platform.OS === "android" && !useGlass && hasCapsule;
  const canExpandCapsule =
    isAndroidDynamicCapsule &&
    (hasAgents || hasQueue || hasPreview || actions.length > 0 || extensionStatus !== null);

  if ((!hasCapsule || !canExpandCapsule) && capsuleExpanded) {
    setCapsuleExpanded(false);
  }

  const expandProgress = useSharedValue(0);
  const capsuleDragOffset = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives in-place Material 3 Dynamic Capsule spring expansion
  useEffect(() => {
    expandProgress.set(withSpring(capsuleExpanded ? 1 : 0, SPRING_SPATIAL_SNAPPY));
  }, [capsuleExpanded, expandProgress]);

  const setExpandedWithHaptic = useCallback((next: boolean) => {
    setCapsuleExpanded((current) => {
      if (current === next) return current;
      triggerSemanticHaptic(next ? "toggleOn" : "toggleOff");
      return next;
    });
  }, []);

  const capsulePanGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory, not a React component.
      Gesture.Pan()
        .enabled(canExpandCapsule)
        .activeOffsetY([-10, 10])
        .failOffsetX([-20, 20])
        .onUpdate((event) => {
          const clamped = Math.max(-28, Math.min(28, event.translationY * 0.4));
          capsuleDragOffset.set(clamped);
        })
        .onEnd((event) => {
          capsuleDragOffset.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          if (!capsuleExpanded && (event.translationY > 18 || event.velocityY > 360)) {
            runOnJS(setExpandedWithHaptic)(true);
          } else if (capsuleExpanded && (event.translationY < -18 || event.velocityY < -360)) {
            runOnJS(setExpandedWithHaptic)(false);
          }
        })
        .onFinalize(() => {
          capsuleDragOffset.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
        }),
    [canExpandCapsule, capsuleDragOffset, capsuleExpanded, setExpandedWithHaptic],
  );

  // Only reserve the scroll button's slot while it is visible.
  const reservedWidth = props.showScrollToEnd ? CONTROL_HEIGHT + 32 : 16;
  const availableLabelWidth = Math.max(
    0,
    Math.min(overlayWidth, windowWidth) -
      reservedWidth -
      (actions.length > 0 ? actionWidth : 0) -
      (hasQueue ? queueWidth : 0) -
      (hasAgents ? agentsWidth : 0) -
      (hasPreview ? previewWidth : 0) -
      (canExpandCapsule ? 34 : 0),
  );
  const labelWidth = Math.max(
    0,
    availableLabelWidth - (extensionStatus === null ? 0 : extensionWidth),
  );
  const separationProgress = useSharedValue(props.showScrollToEnd ? 1 : 0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- animates the Reanimated separation value when scroll-to-end visibility changes
  useEffect(() => {
    separationProgress.set(withTiming(props.showScrollToEnd ? 1 : 0, CONTROL_TIMING));
  }, [props.showScrollToEnd, separationProgress]);

  const lift = props.lift;
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(lift?.get() ?? 0) }],
  }));
  const arrowTransformStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -CONTROL_SEPARATION * (1 - separationProgress.get()) }],
  }));
  const arrowContentStyle = useAnimatedStyle(() => ({
    opacity: separationProgress.get(),
  }));

  // Animate an in-flow sizer for native glass layout. Measure labels at fixed width to avoid repeated animation retargeting.
  const capsuleWidth = useSharedValue<number | null>(null);
  const measuredWidthRef = useRef<number | null>(null);
  const handleLabelLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width === measuredWidthRef.current) {
      return;
    }
    const first = measuredWidthRef.current === null;
    measuredWidthRef.current = width;
    capsuleWidth.set(first ? width : withTiming(width, CONTROL_TIMING));
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the Reanimated capsule width value and measured width when the status goes away
  useEffect(() => {
    if (!hasStatus) {
      measuredWidthRef.current = null;
      capsuleWidth.set(null);
    }
  }, [capsuleWidth, hasStatus]);
  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: CONTROL_SEPARATION * (1 - separationProgress.get()) },
      { translateY: capsuleDragOffset.get() },
    ],
  }));
  const capsuleSizerStyle = useAnimatedStyle(() => ({
    width: capsuleWidth.get() ?? 0,
  }));
  const androidDynamicShellStyle = useAnimatedStyle(() => {
    const progress = expandProgress.get();
    return {
      borderRadius: interpolate(
        progress,
        [0, 1],
        [22, MOBILE_SHAPE.capsuleCard],
        Extrapolation.CLAMP,
      ),
    };
  });
  const expandChevronStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(expandProgress.get(), [0, 1], [0, 180], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));

  if (!hasCapsule && !props.showScrollToEnd) {
    return null;
  }

  const previewCompact =
    hasStatus ||
    hasAgents ||
    hasQueue ||
    (props.devicePreview !== null && props.browserPreview !== null);
  const statusInteractive =
    props.status?.kind === "connection" ||
    props.status?.kind === "extension" ||
    props.status?.kind === "child-input";
  const capsuleInteractive =
    statusInteractive ||
    extensionStatus !== null ||
    actions.length > 0 ||
    hasQueue ||
    hasAgents ||
    hasPreview ||
    canExpandCapsule;

  const isDark = props.colorScheme === "dark";
  const androidChrome = androidTonalSurfaceChrome(isDark, capsuleExpanded ? "high" : "medium");
  const expandedCardMaxWidth = Math.min(Math.max(260, overlayWidth - 28), 380);
  const capsuleTone: "primary" | "warning" | "danger" =
    props.status?.kind === "connection"
      ? "danger"
      : props.status?.kind === "stop" && props.status.unresponsive
        ? "warning"
        : "primary";

  const statusContent =
    props.status !== null ? (
      <View
        pointerEvents={statusInteractive ? "box-none" : "none"}
        className="h-11 items-center justify-center overflow-hidden"
      >
        <Animated.View className="h-11" style={capsuleSizerStyle} />
        <View
          pointerEvents={statusInteractive ? "box-none" : "none"}
          className="absolute h-11 items-center justify-center"
          style={{ width: labelWidth }}
        >
          <FloatingStatusLabel
            key={
              props.status.kind === "extension"
                ? props.status.kind
                : `${props.status.kind}:${props.status.label}`
            }
            status={props.status}
            onLayout={handleLabelLayout}
          />
        </View>
      </View>
    ) : null;

  const capsuleContent = (
    <View className="flex-row items-center">
      {isAndroidDynamicCapsule && !hasStatus ? (
        <View className="pl-3.5 pr-1">
          <CapsuleActivityHalo tone={capsuleTone} />
        </View>
      ) : null}
      {statusContent}
      {extensionStatus !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={extensionStatus.label}
          accessibilityHint={gt("Shows the full Pi status")}
          onPress={extensionStatus.onPress}
          onLayout={(event) => setExtensionWidth(settleWidth(event.nativeEvent.layout.width))}
          style={{ maxWidth: availableLabelWidth * 0.5 }}
          className="h-11 flex-row items-center px-3 active:opacity-70"
        >
          {hasStatus ? <View className="absolute left-0 h-4 w-px bg-border" /> : null}
          <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
            {extensionStatus.label}
          </Text>
        </Pressable>
      ) : null}
      {actions.length > 0 && !capsuleExpanded ? (
        <View
          onLayout={(event) => setActionWidth(settleWidth(event.nativeEvent.layout.width))}
          className="h-11 flex-row items-center"
        >
          {actions.map((action) => (
            <Fragment key={action.label}>
              <View className="h-4 w-px bg-border" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={action.onPress}
                className={`h-11 items-center justify-center px-3 active:opacity-70 ${action.disabled ? "opacity-50" : ""}`}
              >
                <Text className="font-t3-medium text-xs text-foreground" numberOfLines={1}>
                  {action.label}
                </Text>
              </Pressable>
            </Fragment>
          ))}
        </View>
      ) : null}
      {hasPreview && !capsuleExpanded ? (
        <View
          className="h-11 flex-row items-center"
          onLayout={(event) => setPreviewWidth(settleWidth(event.nativeEvent.layout.width))}
        >
          {hasStatus ? <View className="h-4 w-px bg-border" /> : null}
          {props.devicePreview !== null ? (
            <DevicePreviewButton {...props.devicePreview} compact={previewCompact} />
          ) : null}
          {props.browserPreview !== null ? (
            <BrowserPreviewButton {...props.browserPreview} compact={previewCompact} />
          ) : null}
        </View>
      ) : null}
      {agents !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Open agents, {agents}", { agents: agents.accessibilityLabel })}
          accessibilityHint={gt("Opens this turn's subagents")}
          onPress={props.onOpenAgents}
          onLayout={(event) => setAgentsWidth(settleWidth(event.nativeEvent.layout.width))}
          className="h-11 flex-row items-center gap-1.5 px-3 active:opacity-70"
        >
          {hasStatus || hasPreview ? <View className="absolute left-0 h-4 w-px bg-border" /> : null}
          <SymbolView name="person.2" size={13} tintColorClassName="accent-foreground" />
          <Text className="font-t3-medium text-xs tabular-nums" numberOfLines={1}>
            {agents.label}
          </Text>
        </Pressable>
      ) : null}
      {hasQueue && !capsuleExpanded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("{count, plural, other {Open queue, {count} messages}}", {
            count: props.queuedCount,
          })}
          accessibilityHint={gt("Opens queued messages to send now, edit, or remove")}
          onPress={props.onOpenQueue}
          onLayout={(event) => setQueueWidth(settleWidth(event.nativeEvent.layout.width))}
          style={{ maxWidth: Math.min(overlayWidth, windowWidth) * 0.45 }}
          className="h-11 flex-row items-center gap-2 px-3 active:opacity-70"
        >
          {hasStatus || hasPreview || hasAgents ? (
            <View className="absolute left-0 h-4 w-px bg-border" />
          ) : null}
          <SymbolView name="list.number" size={13} tintColorClassName="accent-foreground" />
          <Text className="shrink font-t3-medium text-xs tabular-nums" numberOfLines={1}>
            {gt("{count, plural, other {{count} queued}}", { count: props.queuedCount })}
          </Text>
        </Pressable>
      ) : null}
      {canExpandCapsule ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            capsuleExpanded ? gt("Collapse status capsule") : gt("Expand status capsule")
          }
          accessibilityState={{ expanded: capsuleExpanded }}
          hitSlop={6}
          onPress={() => setExpandedWithHaptic(!capsuleExpanded)}
          className="h-11 w-9 items-center justify-center active:opacity-70"
        >
          <Animated.View style={expandChevronStyle}>
            <SymbolView
              name="chevron.down"
              size={11}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
          </Animated.View>
        </Pressable>
      ) : null}
    </View>
  );

  const expandedCardDetails =
    isAndroidDynamicCapsule && capsuleExpanded ? (
      <Animated.View
        entering={reducedMotion ? undefined : EXPANDED_BODY_ENTERING}
        exiting={reducedMotion ? undefined : EXPANDED_BODY_EXITING}
        className="gap-2 border-t border-border/60 px-3.5 pb-3 pt-2.5"
        style={{ width: expandedCardMaxWidth }}
      >
        {agents !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Open agents, {agents}", { agents: agents.accessibilityLabel })}
            onPress={() => {
              setExpandedWithHaptic(false);
              props.onOpenAgents();
            }}
            className="min-h-10 flex-row items-center justify-between rounded-xl bg-subtle/60 px-3 py-2 active:opacity-75"
          >
            <View className="flex-row items-center gap-2">
              <CapsuleActivityHalo tone="primary" />
              <Text className="font-t3-medium text-xs text-foreground">{gt("Active agents")}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Text className="font-t3-semibold text-xs tabular-nums text-foreground">
                {agents.label}
              </Text>
              <SymbolView
                name="chevron.right"
                size={11}
                tintColorClassName="accent-foreground-muted"
                type="monochrome"
              />
            </View>
          </Pressable>
        ) : null}
        {hasQueue ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("{count, plural, other {Open queue, {count} messages}}", {
              count: props.queuedCount,
            })}
            onPress={() => {
              setExpandedWithHaptic(false);
              props.onOpenQueue();
            }}
            className="min-h-10 flex-row items-center justify-between rounded-xl bg-subtle/60 px-3 py-2 active:opacity-75"
          >
            <View className="flex-row items-center gap-2">
              <SymbolView name="list.number" size={13} tintColorClassName="accent-foreground" />
              <Text className="font-t3-medium text-xs tabular-nums text-foreground">
                {gt("{count, plural, other {{count} queued}}", { count: props.queuedCount })}
              </Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={11}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
          </Pressable>
        ) : null}
        {hasPreview ? (
          <View className="flex-row items-center gap-2">
            {props.devicePreview !== null ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setExpandedWithHaptic(false);
                  props.devicePreview?.onPress();
                }}
                className="min-h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-subtle/60 px-3 py-1.5 active:opacity-75"
              >
                <SymbolView
                  name={{ ios: "iphone", android: "smartphone" }}
                  size={13}
                  tintColorClassName="accent-foreground"
                />
                <Text className="font-t3-medium text-xs tabular-nums text-foreground">
                  {gt("Devices ({count})", { count: props.devicePreview.count })}
                </Text>
              </Pressable>
            ) : null}
            {props.browserPreview !== null ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setExpandedWithHaptic(false);
                  props.browserPreview?.onPress();
                }}
                className="min-h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-subtle/60 px-3 py-1.5 active:opacity-75"
              >
                <SymbolView
                  name={{ ios: "globe", android: "public" }}
                  size={13}
                  tintColorClassName="accent-foreground"
                />
                <Text className="font-t3-medium text-xs tabular-nums text-foreground">
                  {gt("Browser ({count})", { count: props.browserPreview.count })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {actions.length > 0 ? (
          <View className="flex-row items-center gap-2">
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={() => {
                  triggerSemanticHaptic("contextClick");
                  action.onPress();
                }}
                className={`min-h-9 flex-1 items-center justify-center rounded-xl border border-border bg-card px-3 py-1.5 active:opacity-75 ${action.disabled ? "opacity-50" : ""}`}
              >
                <Text className="font-t3-semibold text-xs text-foreground" numberOfLines={1}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Animated.View>
    ) : null;

  return (
    <Animated.View
      pointerEvents="box-none"
      className="absolute left-0 right-0 z-20 items-center"
      style={[{ top: -CONTROL_OVERLAY_OFFSET }, liftStyle]}
      onLayout={(event) => setOverlayWidth(event.nativeEvent.layout.width)}
      entering={useGlass || extensionOnly || reducedMotion ? undefined : CONTROL_ENTERING}
      exiting={useGlass || extensionOnly || reducedMotion ? undefined : CONTROL_EXITING}
    >
      {hasCapsule && useGlass ? (
        <UniwindGlassContainer
          spacing={GLASS_MERGE_SPACING}
          pointerEvents="box-none"
          className="flex-row items-center gap-4"
        >
          <AnimatedGlassView
            colorScheme={props.colorScheme}
            glassEffectStyle="regular"
            isInteractive={capsuleInteractive}
            pointerEvents={capsuleInteractive ? "box-none" : "none"}
            className="h-11 items-center justify-center overflow-hidden rounded-full"
            style={capsuleStyle}
          >
            {capsuleContent}
          </AnimatedGlassView>

          <AnimatedGlassView
            colorScheme={props.colorScheme}
            glassEffectStyle={{ style: props.showScrollToEnd ? "regular" : "none", animate: true }}
            isInteractive
            pointerEvents={props.showScrollToEnd ? "auto" : "none"}
            accessibilityElementsHidden={!props.showScrollToEnd}
            importantForAccessibility={props.showScrollToEnd ? "auto" : "no-hide-descendants"}
            className="h-11 w-11 items-center justify-center overflow-hidden rounded-full"
            style={arrowTransformStyle}
          >
            <Animated.View style={arrowContentStyle}>
              <ScrollToEndButton
                disabled={!props.showScrollToEnd}
                hasUnreadStream={props.hasUnreadStream}
                onPress={props.onScrollToEnd}
              />
            </Animated.View>
          </AnimatedGlassView>
        </UniwindGlassContainer>
      ) : hasCapsule ? (
        <View pointerEvents="box-none" className="flex-row items-start gap-3">
          <GestureDetector gesture={capsulePanGesture}>
            <Animated.View
              pointerEvents={capsuleInteractive ? "box-none" : "none"}
              style={[
                capsuleStyle,
                Platform.OS === "android"
                  ? {
                      overflow: "visible",
                      boxShadow: [...androidChrome.boxShadow],
                    }
                  : {
                      borderRadius: 9999,
                      overflow: "visible",
                      shadowColor: "#000000",
                      shadowOpacity: isDark ? 0.22 : 0.08,
                      shadowRadius: 16,
                      shadowOffset: { width: 0, height: 6 },
                    },
                Platform.OS === "android" ? androidDynamicShellStyle : undefined,
              ]}
            >
              <Animated.View
                className="overflow-hidden border"
                style={[
                  Platform.OS === "android"
                    ? [
                        androidDynamicShellStyle,
                        {
                          borderColor: androidChrome.borderColor,
                          borderTopColor: androidChrome.specularTopBorderColor,
                        },
                      ]
                    : { borderRadius: 9999 },
                ]}
              >
                <GlassBackdrop />
                <View className="min-h-11 items-center justify-center">{capsuleContent}</View>
                {expandedCardDetails}
              </Animated.View>
            </Animated.View>
          </GestureDetector>

          <Animated.View
            pointerEvents={props.showScrollToEnd ? "auto" : "none"}
            accessibilityElementsHidden={!props.showScrollToEnd}
            importantForAccessibility={props.showScrollToEnd ? "auto" : "no-hide-descendants"}
            style={[arrowTransformStyle, arrowContentStyle]}
          >
            <View className="relative">
              <ControlPill
                accessibilityLabel={gt("Scroll to end")}
                activateOnPressIn
                className="h-11 w-11 border border-border bg-glass-fallback shadow-md shadow-black/10"
                disabled={!props.showScrollToEnd}
                icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
                onPress={props.onScrollToEnd}
              />
              <UnreadStreamBreathDot
                active={Boolean(props.showScrollToEnd && props.hasUnreadStream)}
              />
            </View>
          </Animated.View>
        </View>
      ) : NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <UniwindGlassView
          colorScheme={props.colorScheme}
          glassEffectStyle="regular"
          isInteractive
          className="h-11 w-11 items-center justify-center overflow-hidden rounded-full"
        >
          <ScrollToEndButton
            hasUnreadStream={props.hasUnreadStream}
            onPress={props.onScrollToEnd}
          />
        </UniwindGlassView>
      ) : (
        <View className="relative">
          <ControlPill
            accessibilityLabel={gt("Scroll to end")}
            activateOnPressIn
            className="h-11 w-11 border border-border bg-glass-fallback shadow-md shadow-black/10"
            icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
            onPress={props.onScrollToEnd}
          />
          <UnreadStreamBreathDot active={Boolean(props.hasUnreadStream)} />
        </View>
      )}
    </Animated.View>
  );
}

function ConnectionDangerDot() {
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const shouldPulse = appActive && isFocused && !reducedMotion;
  const pulse = useAnimatedValue(0, { useNativeDriver: true });

  // Uses native Animated instead of Reanimated withRepeat so continuous motion never starves
  // React commits while DISABLE_COMMIT_PAUSING_MECHANISM is enabled.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives a subtle native pulsing halo on the disconnected status dot while focused and foregrounded
  useEffect(() => {
    pulse.setValue(0);
    if (!shouldPulse) return;
    const loop = RNAnimated.loop(
      RNAnimated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: RNEasing.out(RNEasing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [pulse, shouldPulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.1],
  });

  return (
    <View className="relative size-2 items-center justify-center">
      {shouldPulse ? (
        <RNAnimated.View
          pointerEvents="none"
          className="absolute inset-0 rounded-full bg-danger-foreground"
          style={{ opacity, transform: [{ scale }] }}
        />
      ) : null}
      <View className="size-2 rounded-full bg-danger-foreground" />
    </View>
  );
}

function FloatingStatusLabel(props: {
  readonly status: FloatingWorkingStatus;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}) {
  if (props.status.kind === "extension") {
    return (
      <StatusLabelRow
        accessibilityLabel={props.status.label}
        accessibilityRole="button"
        onPress={props.status.onPress}
        onLayout={props.onLayout}
        className="gap-1.5"
        animated={false}
      >
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
        <SymbolView name="chevron.down" size={10} tintColorClassName="accent-foreground" />
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "child-input") {
    return (
      <StatusLabelRow
        key="child-input"
        accessibilityLabel={props.status.accessibilityLabel}
        accessibilityRole="button"
        className="gap-2"
        onLayout={props.onLayout}
        onPress={props.status.onPress}
      >
        <SymbolView name="text.bubble" size={13} tintColorClassName="accent-foreground" />
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "connection") {
    return (
      <StatusLabelRow
        key="connection"
        accessibilityLabel={props.status.label}
        accessibilityRole="button"
        className="gap-2"
        onLayout={props.onLayout}
        onPress={props.status.onPress}
      >
        <ConnectionDangerDot />
        <Text
          className="max-w-[260px] shrink font-t3-medium text-xs text-foreground"
          numberOfLines={1}
        >
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "stop") {
    return (
      <StatusLabelRow
        key="stop"
        accessibilityLabel={props.status.label}
        className="gap-2"
        onLayout={props.onLayout}
      >
        {props.status.unresponsive ? (
          <SymbolView
            name="exclamationmark.triangle"
            size={13}
            tintColorClassName="accent-warning-foreground"
            type="monochrome"
          />
        ) : (
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
        )}
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "goal") {
    return (
      <StatusLabelRow
        key="goal"
        accessibilityLabel={props.status.accessibilityLabel}
        className="gap-2"
        onLayout={props.onLayout}
      >
        <SymbolView
          name="target"
          size={13}
          tintColorClassName="accent-foreground"
          type="monochrome"
        />
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  return (
    <StatusLabelRow
      key="preparing"
      accessibilityLabel={props.status.label}
      className="gap-1.5"
      onLayout={props.onLayout}
    >
      <SymbolView
        name="arrow.triangle.branch"
        size={13}
        tintColorClassName="accent-foreground"
        type="monochrome"
      />
      <ShimmeringWorkContent
        className="flex-none"
        textClassName="font-t3-medium"
        compact
        icon="arrow.triangle.branch"
        iconSubtleColor="transparent"
        label={props.status.label}
        showIcon={false}
      />
    </StatusLabelRow>
  );
}

function StatusLabelRow(props: {
  readonly animated?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: "button";
  readonly className?: string;
  readonly children: ReactNode;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onPress?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const rowClassName = `h-11 flex-row items-center px-4 ${props.className ?? ""}`;
  return (
    <Animated.View
      className="absolute max-w-full"
      entering={props.animated === false || reducedMotion ? undefined : LABEL_ENTERING}
      exiting={props.animated === false || reducedMotion ? undefined : LABEL_EXITING}
      onLayout={props.onLayout}
    >
      {props.onPress ? (
        <Pressable
          accessibilityLabel={props.accessibilityLabel}
          accessibilityRole={props.accessibilityRole}
          className={`${rowClassName} active:opacity-70`}
          onPress={props.onPress}
        >
          {props.children}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={props.accessibilityLabel} className={rowClassName}>
          {props.children}
        </View>
      )}
    </Animated.View>
  );
}

function ScrollToEndButton(props: {
  readonly disabled?: boolean;
  readonly hasUnreadStream?: boolean;
  readonly onPress: () => void;
}) {
  const gt = useGT();
  return (
    <View className="relative">
      <ControlPill
        accessibilityLabel={gt("Scroll to end")}
        activateOnPressIn
        className="h-11 w-11 bg-transparent"
        disabled={props.disabled}
        icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
        onPress={props.onPress}
      />
      <UnreadStreamBreathDot active={Boolean(!props.disabled && props.hasUnreadStream)} />
    </View>
  );
}

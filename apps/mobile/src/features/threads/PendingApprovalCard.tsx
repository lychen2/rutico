import { Button } from "../../components/ui/Button";
import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  RuntimeRequestId,
} from "@t3tools/contracts";
import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
} from "@t3tools/client-runtime/state/thread-requests";
import { T, useGT, useMessages } from "gt-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ThreadDisclosureChevron } from "../../components/ui/ThreadDisclosureChevron";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_SPATIAL_SNAPPY } from "../../lib/mobileMotion";
import type { PendingApproval } from "../../lib/threadActivity";

const COLLAPSE_DRAG_DISTANCE = 44;
const COLLAPSE_VELOCITY_THRESHOLD = 520;
const EXPAND_DRAG_DISTANCE = 28;
const EXPAND_VELOCITY_THRESHOLD = 420;
const DECISION_STAMP_DWELL_MS = 320;

const CARD_LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(26)
  .stiffness(360)
  .mass(0.75)
  .reduceMotion(ReduceMotion.System);
const STAMP_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const STAMP_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

export interface PendingApprovalCardProps {
  readonly canOperateThread: boolean;
  readonly approval: PendingApproval;
  readonly respondingApprovalId: RuntimeRequestId | null;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  const gt = useGT();
  const m = useMessages();
  const options: ReadonlyArray<ProviderApprovalOption> = props.approval.options ?? [
    { decision: "accept", label: gt("Allow once") },
    { decision: "acceptForSession", label: gt("Allow session") },
    {
      decision: "decline",
      label: gt("Decline", { $context: "verb, rejects the approval request" }),
    },
  ];
  const warning = options.find((option) => option.warning)?.warning;
  const canRespond = props.approval.responseCapability === "live";
  const isResponding = props.respondingApprovalId === props.approval.requestId;
  const [pendingDecision, setPendingDecision] = useState<ProviderApprovalDecision | null>(null);
  const [decisionDwellActive, setDecisionDwellActive] = useState(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);

  const activeDecision = isResponding || decisionDwellActive ? pendingDecision : null;
  const disabled = !canRespond || isResponding || decisionDwellActive;
  const title = props.approval.appName ?? props.approval.requestKind;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the decision-lock dwell timer on unmount
  useEffect(
    () => () => {
      if (dwellTimerRef.current !== null) {
        clearTimeout(dwellTimerRef.current);
      }
    },
    [],
  );

  const dragOffsetY = useSharedValue(0);

  const collapseCard = useCallback(() => {
    triggerSemanticHaptic("toggleOff");
    setCollapsed(true);
  }, []);

  const expandCard = useCallback(() => {
    triggerSemanticHaptic("toggleOn");
    setCollapsed(false);
  }, []);

  const expandedPanGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-20, 20])
        .onUpdate((event) => {
          const clamped = event.translationY > 0 ? Math.min(event.translationY, 120) : 0;
          dragOffsetY.set(clamped);
        })
        .onEnd((event) => {
          const shouldCollapse =
            event.translationY >= COLLAPSE_DRAG_DISTANCE ||
            event.velocityY >= COLLAPSE_VELOCITY_THRESHOLD;
          dragOffsetY.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          if (shouldCollapse) {
            runOnJS(collapseCard)();
          }
        })
        .onFinalize(() => {
          if (dragOffsetY.get() !== 0) {
            dragOffsetY.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          }
        }),
    [collapseCard, dragOffsetY],
  );

  const collapsedPanGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-20, 20])
        .onUpdate((event) => {
          const clamped = event.translationY < 0 ? Math.max(event.translationY, -44) : 0;
          dragOffsetY.set(clamped);
        })
        .onEnd((event) => {
          const shouldExpand =
            event.translationY <= -EXPAND_DRAG_DISTANCE ||
            event.velocityY <= -EXPAND_VELOCITY_THRESHOLD;
          dragOffsetY.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          if (shouldExpand) {
            runOnJS(expandCard)();
          }
        })
        .onFinalize(() => {
          if (dragOffsetY.get() !== 0) {
            dragOffsetY.set(withSpring(0, SPRING_SPATIAL_SNAPPY));
          }
        }),
    [dragOffsetY, expandCard],
  );

  const dragAnimatedStyle = useAnimatedStyle(() => {
    const offset = dragOffsetY.get();
    return {
      transform: [{ translateY: offset }],
      opacity: offset > 0 ? Math.max(0.72, 1 - offset / 220) : 1,
    };
  });

  const handleDecision = (decision: ProviderApprovalDecision) => {
    setPendingDecision(decision);
    setDecisionDwellActive(true);
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
    }
    dwellTimerRef.current = setTimeout(() => {
      dwellTimerRef.current = null;
      setDecisionDwellActive(false);
    }, DECISION_STAMP_DWELL_MS);
    triggerSemanticHaptic(decision === "decline" ? "reject" : "confirm");
    void props.onRespond(props.approval.requestId, decision);
  };

  if (collapsed) {
    return (
      <GestureDetector gesture={collapsedPanGesture}>
        <Animated.View
          layout={CARD_LAYOUT_TRANSITION}
          style={dragAnimatedStyle}
          className="rounded-full border border-warning-border bg-card-alt px-4 py-2"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Expand approval request: {title}", { title })}
            onPress={expandCard}
            className="min-h-10 flex-row items-center gap-2 active:opacity-70"
          >
            <SymbolView
              name="exclamationmark.shield"
              size={14}
              tintColorClassName="accent-warning-foreground"
              type="monochrome"
            />
            <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-warning-foreground">
              <T>Approval needed</T>
            </Text>
            <Text
              className="min-w-0 flex-1 font-t3-medium text-xs text-foreground"
              numberOfLines={1}
            >
              {title}
            </Text>
            <SymbolView
              name="chevron.up"
              size={12}
              tintColorClassName="accent-icon-subtle"
              type="monochrome"
            />
          </Pressable>
        </Animated.View>
      </GestureDetector>
    );
  }

  const decisionDeclined = activeDecision === "decline";

  return (
    <Animated.View
      layout={CARD_LAYOUT_TRANSITION}
      style={dragAnimatedStyle}
      className="gap-2.5 rounded-[20px] border border-warning-border bg-card-alt p-4"
    >
      <GestureDetector gesture={expandedPanGesture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Collapse approval request")}
          onPress={collapseCard}
          className="-mx-2 -mt-2 gap-2 px-2 pb-1 pt-1 active:opacity-75"
        >
          <View className="items-center">
            <View className="h-1 w-9 rounded-full bg-foreground-muted/30" />
          </View>
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-1.5">
              <SymbolView
                name="exclamationmark.shield"
                size={12}
                tintColorClassName="accent-warning-foreground"
                type="monochrome"
              />
              <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-warning-foreground">
                <T>Approval needed</T>
              </Text>
            </View>
            <View className="h-7 w-7 items-center justify-center rounded-full bg-subtle-strong">
              <SymbolView
                name="chevron.down"
                size={12}
                tintColorClassName="accent-icon-subtle"
                type="monochrome"
              />
            </View>
          </View>
        </Pressable>
      </GestureDetector>
      <Text className="font-t3-bold text-lg text-foreground">{title}</Text>
      {props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-foreground-secondary">
          {props.approval.detail}
        </Text>
      ) : null}
      {props.approval.reason ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">
          {props.approval.reason}
        </Text>
      ) : null}
      {props.approval.fullAccessOverride ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: explanationOpen }}
            hitSlop={4}
            className="min-h-[40px] flex-row items-center gap-1.5 py-1.5 active:opacity-70"
            onPress={() => {
              triggerSemanticHaptic("contextClick");
              setExplanationOpen((open) => !open);
            }}
          >
            <ThreadDisclosureChevron
              expanded={explanationOpen}
              collapsedDirection="right"
              size={11}
              tintColorClassName="accent-icon-muted"
            />
            <Text className="font-t3-medium text-xs text-foreground-secondary">
              {m(FULL_ACCESS_OVERRIDE_QUESTION)}
            </Text>
          </Pressable>
          {explanationOpen ? (
            <Text className="pb-1 pl-4 font-sans text-xs leading-normal text-foreground-muted">
              {fullAccessOverrideExplanation(props.approval.fullAccessOverride, m)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {!canRespond ? (
        <Text className="font-sans text-sm leading-5 text-foreground-muted">
          <T>
            The provider process for this request is no longer available. Interrupt or restart the
            run to continue.
          </T>
        </Text>
      ) : null}
      {warning ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">{warning}</Text>
      ) : null}
      {activeDecision !== null ? (
        <Animated.View
          entering={STAMP_ENTERING}
          exiting={STAMP_EXITING}
          accessibilityLiveRegion="polite"
          className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border px-4 py-3"
          style={{
            backgroundColor: decisionDeclined
              ? "rgba(239, 68, 68, 0.14)"
              : "rgba(16, 185, 129, 0.14)",
            borderColor: decisionDeclined ? "rgba(239, 68, 68, 0.32)" : "rgba(16, 185, 129, 0.32)",
          }}
        >
          <SymbolView
            name={decisionDeclined ? "xmark.circle.fill" : "checkmark.circle.fill"}
            size={16}
            tintColorClassName={
              decisionDeclined ? "accent-danger-foreground" : "accent-adaptive-emerald-600-400"
            }
            type="monochrome"
          />
          <Text
            className={
              decisionDeclined
                ? "font-t3-bold text-sm text-danger-foreground"
                : "font-t3-bold text-sm text-adaptive-emerald-700-300"
            }
          >
            {decisionDeclined
              ? gt("Declined")
              : activeDecision === "acceptForSession"
                ? gt("Approved for session")
                : gt("Approved")}
          </Text>
        </Animated.View>
      ) : (
        <View className="gap-2">
          {options.map((option) => (
            <Button
              key={option.decision}
              label={option.label}
              tone={
                option.decision === "accept"
                  ? "primary"
                  : option.decision === "decline"
                    ? "danger"
                    : "secondary"
              }
              loading={activeDecision === option.decision}
              disabled={disabled || !props.canOperateThread}
              onPress={() => handleDecision(option.decision)}
              fullWidth
            />
          ))}
        </View>
      )}
      {!props.canOperateThread ? (
        <Text className="font-sans text-xs text-foreground-muted">
          <T>This connection cannot respond to approvals.</T>
        </Text>
      ) : null}
    </Animated.View>
  );
}

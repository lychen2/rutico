import { Button } from "../../components/ui/Button";
import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  RuntimeRequestId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type ApprovalTextPart,
  approvalTextParts,
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
  PUSH_HOOKS_APPROVAL_QUESTION,
  pushHooksApprovalRows,
} from "@t3tools/client-runtime/state/thread-requests";
import { T, useGT, useMessages } from "gt-react-native";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
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

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
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

const CARD_LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(26)
  .stiffness(360)
  .mass(0.75)
  .reduceMotion(ReduceMotion.System);
const STAMP_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const STAMP_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

type ApprovalSubmissionPhase = "in_flight" | "confirmed" | "failed";

interface ApprovalSubmissionState {
  readonly requestId: RuntimeRequestId;
  readonly decision: ProviderApprovalDecision;
  readonly phase: ApprovalSubmissionPhase;
  readonly errorMessage?: string | undefined;
}

type SettledDecisionKind = "approved" | "declined" | "cancelled";

function settledDecisionKind(decision: ProviderApprovalDecision): SettledDecisionKind {
  if (decision === "decline") return "declined";
  if (decision === "cancel") return "cancelled";
  return "approved";
}

function parseApprovalResponseFailure(result: unknown): {
  readonly failed: boolean;
  readonly errorMessage?: string | undefined;
} {
  if (result === false) {
    return { failed: true };
  }
  if (result instanceof Error) {
    return { failed: true, errorMessage: result.message || undefined };
  }
  if (typeof result === "object" && result !== null && "_tag" in result) {
    const tagged = result as { readonly _tag?: unknown; readonly error?: unknown };
    if (tagged._tag === "Failure") {
      if ("cause" in result) {
        try {
          const squashed = squashAtomCommandFailure(
            result as unknown as Parameters<typeof squashAtomCommandFailure>[0],
          );
          if (squashed instanceof Error && squashed.message) {
            return { failed: true, errorMessage: squashed.message };
          }
        } catch {
          // Lightweight failure objects without a full Effect Cause still count as failures.
        }
      }
      if (tagged.error instanceof Error && tagged.error.message) {
        return { failed: true, errorMessage: tagged.error.message };
      }
      return { failed: true };
    }
  }
  return { failed: false };
}

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
  const [submission, setSubmission] = useState<ApprovalSubmissionState | null>(null);
  const mountedRef = useRef(true);
  const attemptSeqRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const currentSubmission = submission?.requestId === props.approval.requestId ? submission : null;
  const isInFlight = isResponding || currentSubmission?.phase === "in_flight";
  const isConfirmed = !isInFlight && currentSubmission?.phase === "confirmed";
  const isFailed = !isInFlight && currentSubmission?.phase === "failed";
  const disabled = !canRespond || isInFlight || isConfirmed;
  // T3 Code's own question reads as the app asking: a plain sentence, then what it names.
  const { pushHooks } = props.approval;
  const detail =
    !pushHooks && props.approval.detail ? approvalTextParts(props.approval.detail) : null;
  const title = pushHooks
    ? m(PUSH_HOOKS_APPROVAL_QUESTION)
    : (props.approval.appName ?? props.approval.requestKind);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mounted state so settled approval responses do not update an unmounted card
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    if (disabled || !props.canOperateThread) return;
    const requestId = props.approval.requestId;
    const attemptSeq = attemptSeqRef.current + 1;
    attemptSeqRef.current = attemptSeq;
    setSubmission({ requestId, decision, phase: "in_flight" });
    triggerSemanticHaptic("contextClick");

    let responsePromise: Promise<unknown>;
    try {
      responsePromise = Promise.resolve(props.onRespond(requestId, decision));
    } catch (error) {
      responsePromise = Promise.reject(error);
    }

    void responsePromise.then(
      (result) => {
        if (!mountedRef.current || attemptSeqRef.current !== attemptSeq) return;
        const failure = parseApprovalResponseFailure(result);
        if (failure.failed) {
          setSubmission({
            requestId,
            decision,
            phase: "failed",
            errorMessage: failure.errorMessage,
          });
          triggerSemanticHaptic("reject");
          return;
        }
        setSubmission({ requestId, decision, phase: "confirmed" });
        const kind = settledDecisionKind(decision);
        triggerSemanticHaptic(
          kind === "approved" ? "confirm" : kind === "declined" ? "reject" : "toggleOff",
        );
      },
      (error: unknown) => {
        if (!mountedRef.current || attemptSeqRef.current !== attemptSeq) return;
        setSubmission({
          requestId,
          decision,
          phase: "failed",
          errorMessage: error instanceof Error && error.message ? error.message : undefined,
        });
        triggerSemanticHaptic("reject");
      },
    );
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
            <Text className="font-t3-semibold text-xs text-warning-foreground">
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

  const confirmedDecision = isConfirmed ? (currentSubmission?.decision ?? null) : null;
  const confirmedKind = confirmedDecision !== null ? settledDecisionKind(confirmedDecision) : null;
  const inFlightDecision = isInFlight ? (currentSubmission?.decision ?? null) : null;
  const submittingLabel =
    inFlightDecision === "cancel"
      ? gt("Cancelling request…")
      : inFlightDecision === "decline"
        ? gt("Submitting decline…")
        : inFlightDecision !== null
          ? gt("Submitting approval…")
          : gt("Submitting response…");
  const confirmedLabel =
    confirmedKind === "declined"
      ? gt("Declined")
      : confirmedKind === "cancelled"
        ? gt("Cancelled")
        : confirmedDecision === "acceptForSession"
          ? gt("Approved for session")
          : confirmedDecision === "acceptAlways"
            ? gt("Approved always")
            : gt("Approved");
  const failedLabel = currentSubmission?.errorMessage
    ? gt("Couldn't submit response: {reason} Try again.", {
        reason: currentSubmission.errorMessage,
      })
    : gt("Couldn't submit response. Try again.");

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
              <Text className="font-t3-semibold text-xs text-warning-foreground">
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
      {pushHooks ? (
        <View className="gap-1.5">
          {pushHooksApprovalRows(pushHooks, m).map((row, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- rows never reorder and two hooks may read alike
            <View key={index} className="gap-0.5">
              <Text className="font-sans text-xs text-foreground-muted">{row.label}</Text>
              <Text selectable className="font-sans text-sm leading-normal text-foreground">
                {row.name ? `${row.name}  ` : null}
                <Text className="font-mono text-sm text-foreground">{row.code}</Text>
              </Text>
            </View>
          ))}
        </View>
      ) : detail ? (
        <>
          {detail.hiddenLength > 0 ? (
            <>
              <ApprovalTextScroll parts={detail.parts} />
              <Text className="font-sans text-xs leading-normal text-warning-foreground">
                {gt(
                  "{count, plural, one {… {hidden} character in the middle is not shown.} other {… {hidden} characters in the middle are not shown.}} The text ends with:",
                  { count: detail.hiddenLength, hidden: detail.hiddenLength.toLocaleString() },
                )}
              </Text>
              <ApprovalTextScroll parts={detail.tail} fromEnd />
            </>
          ) : (
            <ApprovalTextParts parts={detail.parts} />
          )}
        </>
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
      {confirmedKind !== null ? (
        <Animated.View
          entering={STAMP_ENTERING}
          exiting={STAMP_EXITING}
          testID="approval-status-banner"
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={confirmedLabel}
          accessibilityState={{ busy: false }}
          className={
            confirmedKind === "cancelled"
              ? "min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-subtle px-4 py-3"
              : "min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border px-4 py-3"
          }
          style={
            confirmedKind === "declined"
              ? {
                  backgroundColor: "rgba(239, 68, 68, 0.14)",
                  borderColor: "rgba(239, 68, 68, 0.32)",
                }
              : confirmedKind === "approved"
                ? {
                    backgroundColor: "rgba(16, 185, 129, 0.14)",
                    borderColor: "rgba(16, 185, 129, 0.32)",
                  }
                : undefined
          }
        >
          <SymbolView
            name={
              confirmedKind === "declined"
                ? "xmark.circle.fill"
                : confirmedKind === "cancelled"
                  ? "slash.circle"
                  : "checkmark.circle.fill"
            }
            size={16}
            tintColorClassName={
              confirmedKind === "declined"
                ? "accent-danger-foreground"
                : confirmedKind === "cancelled"
                  ? "accent-foreground-muted"
                  : "accent-adaptive-emerald-600-400"
            }
            type="monochrome"
          />
          <Text
            className={
              confirmedKind === "declined"
                ? "font-t3-bold text-sm text-danger-foreground"
                : confirmedKind === "cancelled"
                  ? "font-t3-bold text-sm text-foreground-secondary"
                  : "font-t3-bold text-sm text-adaptive-emerald-700-300"
            }
          >
            {confirmedLabel}
          </Text>
        </Animated.View>
      ) : (
        <View className="gap-2">
          {isInFlight ? (
            <Animated.View
              entering={STAMP_ENTERING}
              exiting={STAMP_EXITING}
              testID="approval-status-banner"
              accessible
              accessibilityRole="progressbar"
              accessibilityLiveRegion="polite"
              accessibilityLabel={submittingLabel}
              accessibilityState={{ busy: true }}
              className="min-h-11 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-subtle px-4 py-2.5"
            >
              <AppActivityIndicator size="small" colorClassName="accent-foreground-muted" />
              <Text className="font-t3-medium text-sm text-foreground-secondary">
                {submittingLabel}
              </Text>
            </Animated.View>
          ) : isFailed ? (
            <Animated.View
              entering={STAMP_ENTERING}
              exiting={STAMP_EXITING}
              testID="approval-status-banner"
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={failedLabel}
              accessibilityState={{ busy: false }}
              className="min-h-11 flex-row items-center gap-2 rounded-2xl border px-3.5 py-2.5"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                borderColor: "rgba(239, 68, 68, 0.32)",
              }}
            >
              <SymbolView
                name="exclamationmark.triangle"
                size={15}
                tintColorClassName="accent-danger-foreground"
                type="monochrome"
              />
              <Text className="min-w-0 flex-1 font-t3-medium text-xs leading-normal text-danger-foreground">
                {failedLabel}
              </Text>
            </Animated.View>
          ) : null}
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
              loading={inFlightDecision === option.decision}
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

/**
 * One end of text too long to show in full, in a box that scrolls on its own, so the note, the
 * other end and the buttons stay within reach. The end opens on its last line.
 */
function ApprovalTextScroll(props: {
  readonly parts: ReadonlyArray<ApprovalTextPart>;
  readonly fromEnd?: boolean;
}) {
  const box = useRef<ComponentRef<typeof ScrollView>>(null);
  return (
    <ScrollView
      ref={box}
      className="max-h-40"
      nestedScrollEnabled
      onContentSizeChange={
        props.fromEnd ? () => box.current?.scrollToEnd({ animated: false }) : undefined
      }
    >
      <ApprovalTextParts parts={props.parts} />
    </ScrollView>
  );
}

function ApprovalTextParts(props: { readonly parts: ReadonlyArray<ApprovalTextPart> }) {
  return (
    <Text className="font-sans text-sm leading-normal text-foreground-secondary">
      {props.parts.map((part, index) =>
        part.named ? (
          // Tinted only: a second font inside wrapped lines makes Android lay the text out shorter
          // than it draws, which cuts off its last lines.
          // oxlint-disable-next-line react/no-array-index-key -- parts never reorder and two may read alike
          <Text key={index} className="text-warning-foreground">
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

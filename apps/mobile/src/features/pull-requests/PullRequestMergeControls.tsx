import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { changeRequestTermKind } from "../../lib/changeRequestTerm";
import type { PullRequestDetail, PullRequestMergeMethod } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { AsyncResult } from "effect/reactivity";
import { useGT, useMessages } from "gt-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated as RNAnimated,
  Easing as RNEasing,
  Platform,
  Pressable,
  useAnimatedValue,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { SplitButton } from "../../components/ui/SplitButton";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import { SPRING_DETENT_SNAP } from "../../lib/mobileMotion";
import { useEnvironmentServerConfig } from "../../state/entities";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { composerPullRequests } from "../../state/pull-requests";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  allowedMergeMethods,
  canPerformPullRequestAction,
  mergeUnavailableReason,
  MERGE_METHODS,
  mergeMethodKind,
  PR_ACTION_ICONS,
  pullRequestActionLabel,
  resolveMergeMethod,
} from "./pullRequestActions";
import { pullRequestStackMerge, singlePullRequestMergeAllowed } from "./pullRequestStack";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";
import { usePullRequestAction } from "./usePullRequestAction";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { PullRequestGlyph } from "./pullRequestGlyphs";
import type { PullRequestStackState } from "./usePullRequestStack";
import { m as resolveMessage } from "../../i18n/messages";

const SLIDE_THUMB_SIZE = 44;
const SLIDE_TRACK_PADDING = 4;
const SLIDE_COMMIT_THRESHOLD = 0.92;
const SLIDE_BUCKET_STEP = 0.15;
const ACCESSIBLE_CONFIRM_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const ACCESSIBLE_CONFIRM_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

function useScreenReaderEnabled() {
  const [enabled, setEnabled] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks TalkBack/screen-reader state to provide a non-drag merge confirmation fallback
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}

function MergedSheenBanner(props: { readonly label: string }) {
  const reducedMotion = useReducedMotion();
  const sheenProgress = useAnimatedValue(0, { useNativeDriver: true });
  const [width, setWidth] = useState(0);

  // One-shot emerald sheen via RN Animated (useNativeDriver: true), never looping.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs a one-shot emerald sheen sweep once when a pull request displays as merged
  useEffect(() => {
    if (reducedMotion || width <= 0) return;
    sheenProgress.setValue(0);
    const anim = RNAnimated.timing(sheenProgress, {
      toValue: 1,
      duration: 680,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reducedMotion, sheenProgress, width]);

  const translateX = sheenProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-96, Math.max(240, width + 96)],
  });

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      className="min-h-12 flex-row items-center justify-center gap-2 overflow-hidden rounded-full border px-4 py-2.5"
      style={{
        backgroundColor: "rgba(16, 185, 129, 0.14)",
        borderColor: "rgba(16, 185, 129, 0.32)",
      }}
    >
      {!reducedMotion && width > 0 ? (
        <RNAnimated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 84,
            backgroundColor: "rgba(255, 255, 255, 0.22)",
            transform: [{ translateX }, { skewX: "-18deg" }],
          }}
        />
      ) : null}
      <SymbolView
        name={PullRequestGlyph.merged}
        size={15}
        tintColorClassName="accent-adaptive-emerald-600-400"
        type="monochrome"
      />
      <Text className="font-t3-bold text-sm text-adaptive-emerald-700-300">{props.label}</Text>
    </View>
  );
}

function AndroidSlideToMergeTrack(props: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly busy: boolean;
  readonly onCommitMerge: () => void;
}) {
  const gt = useGT();
  const { busy, onCommitMerge } = props;
  const trackWidth = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const lastBucket = useSharedValue(0);
  const locked = useSharedValue(false);

  const handleSlideStart = useCallback(() => {
    triggerSemanticHaptic("gestureStart");
  }, []);
  const handleSlideBucket = useCallback(() => {
    triggerSemanticHaptic("segmentFrequentTick");
  }, []);
  const handleSlideCommit = useCallback(() => {
    triggerSemanticHaptic("confirm");
    onCommitMerge();
  }, [onCommitMerge]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets slide thumb position once an in-flight merge settles
  useEffect(() => {
    if (!busy) {
      locked.set(false);
      thumbX.set(withSpring(0, SPRING_DETENT_SNAP));
      lastBucket.set(0);
    }
  }, [busy, lastBucket, locked, thumbX]);

  const panGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- RNGH Gesture factory API
      Gesture.Pan()
        .enabled(!busy)
        .activeOffsetX([-6, 6])
        .failOffsetY([-14, 14])
        .onBegin(() => {
          lastBucket.set(0);
          runOnJS(handleSlideStart)();
        })
        .onUpdate((event) => {
          if (locked.get()) return;
          const maxTravel = trackWidth.get() - SLIDE_THUMB_SIZE - SLIDE_TRACK_PADDING * 2;
          if (maxTravel <= 0) return;
          const nextX = Math.max(0, Math.min(maxTravel, event.translationX));
          thumbX.set(nextX);
          const bucket = Math.floor(nextX / maxTravel / SLIDE_BUCKET_STEP);
          if (bucket !== lastBucket.get()) {
            lastBucket.set(bucket);
            if (bucket > 0) {
              runOnJS(handleSlideBucket)();
            }
          }
        })
        .onEnd((_event, success) => {
          if (locked.get()) return;
          const maxTravel = trackWidth.get() - SLIDE_THUMB_SIZE - SLIDE_TRACK_PADDING * 2;
          const progress = maxTravel > 0 ? thumbX.get() / maxTravel : 0;
          if (success === true && progress >= SLIDE_COMMIT_THRESHOLD) {
            locked.set(true);
            thumbX.set(withSpring(maxTravel, SPRING_DETENT_SNAP));
            runOnJS(handleSlideCommit)();
          } else {
            lastBucket.set(0);
            thumbX.set(withSpring(0, SPRING_DETENT_SNAP));
          }
        })
        .onFinalize(() => {
          if (!locked.get() && thumbX.get() !== 0) {
            lastBucket.set(0);
            thumbX.set(withSpring(0, SPRING_DETENT_SNAP));
          }
        }),
    [
      busy,
      handleSlideBucket,
      handleSlideCommit,
      handleSlideStart,
      lastBucket,
      locked,
      thumbX,
      trackWidth,
    ],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.get() }],
  }));

  const fillStyle = useAnimatedStyle(() => {
    const maxTravel = Math.max(1, trackWidth.get() - SLIDE_THUMB_SIZE - SLIDE_TRACK_PADDING * 2);
    const progress = thumbX.get() / maxTravel;
    return {
      width: thumbX.get() + SLIDE_THUMB_SIZE + SLIDE_TRACK_PADDING * 2,
      opacity: interpolate(progress, [0, 0.25, 1], [0.18, 0.3, 0.42], Extrapolation.CLAMP),
    };
  });

  const labelStyle = useAnimatedStyle(() => {
    const maxTravel = Math.max(1, trackWidth.get() - SLIDE_THUMB_SIZE - SLIDE_TRACK_PADDING * 2);
    const progress = thumbX.get() / maxTravel;
    return {
      opacity: interpolate(progress, [0, 0.55], [1, 0.15], Extrapolation.CLAMP),
    };
  });

  if (busy) {
    return (
      <View className="h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary px-4">
        <AppActivityIndicator size="small" colorClassName="accent-primary-foreground" />
        <Text className="font-t3-bold text-sm text-primary-foreground">{gt("Merging…")}</Text>
      </View>
    );
  }

  return (
    <GestureDetector gesture={panGesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={gt("Slide across to merge")}
        onLayout={(event) => {
          trackWidth.set(event.nativeEvent.layout.width);
        }}
        className="relative h-[52px] flex-1 justify-center overflow-hidden rounded-full border border-border bg-subtle"
        style={{ padding: SLIDE_TRACK_PADDING }}
      >
        <Animated.View
          pointerEvents="none"
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={fillStyle}
        />
        <Animated.View
          pointerEvents="none"
          style={labelStyle}
          className="absolute inset-0 flex-row items-center justify-center pl-11 pr-4"
        >
          <Text numberOfLines={1} className="font-t3-medium text-xs text-foreground">
            {gt("Slide · {label}", { label: props.label })}
          </Text>
        </Animated.View>
        <Animated.View
          style={[
            {
              width: SLIDE_THUMB_SIZE,
              height: SLIDE_THUMB_SIZE,
            },
            thumbStyle,
          ]}
          className="items-center justify-center rounded-full bg-primary"
        >
          <SymbolView
            name={PullRequestGlyph.merged}
            size={16}
            tintColorClassName="accent-primary-foreground"
            type="monochrome"
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export function PullRequestMergeControls(props: {
  readonly pr: PullRequestDetail;
  readonly params: PullRequestParams;
  readonly stack: PullRequestStackState;
}) {
  const { pr, stack } = props;
  const gt = useGT();
  const m = useMessages();
  const terminology = sourceControlClients.get(pr.provider).changeRequest;
  const target = pullRequestTarget(props.params);
  const permissions = usePullRequestPermissions(props.params, pr);
  const stateAction = usePullRequestAction(props.params, pr);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const serverSettings = useEnvironmentServerConfig(target.environmentId)?.settings;
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const runAction = useAtomCommand(composerPullRequests.runAction, { reportFailure: false });
  const refreshDetail = useAtomRefresh(composerPullRequests.detail(target));
  const refreshActivity = useAtomRefresh(composerPullRequests.activity(target));
  const [selectedMethod, setSelectedMethod] = useState<PullRequestMergeMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [accessibleConfirmHeadSha, setAccessibleConfirmHeadSha] = useState<string | null>(null);
  const pending = useRef(false);
  const screenReaderEnabled = useScreenReaderEnabled();
  const reducedMotion = useReducedMotion();
  const useAccessibleTapConfirm = screenReaderEnabled || reducedMotion;
  const methods = allowedMergeMethods(pr);
  const method = resolveMergeMethod(
    pr,
    selectedMethod,
    serverSettings
      ? resolveProjectSettings(serverSettings, target.input.projectId).settings
          .pullRequestMergeMethod
      : null,
    AsyncResult.isSuccess(preferences) ? preferences.value.pullRequestMergeMethod : undefined,
  );
  const scope = stack.stack ? pullRequestStackMerge(stack.stack, pr.number, terminology, m) : null;
  const canMergeSingle = singlePullRequestMergeAllowed({
    supportsStackActions: stack.supportsStackActions,
    hasStack: stack.stack !== null,
    isFresh: stack.isFresh,
  });
  const checkingStack =
    permissions.connected && stack.supportsStackActions && !stack.isFresh && !stack.error;
  const reason =
    (!permissions.connected
      ? gt("Reconnect to merge.")
      : mergeUnavailableReason(pr, permissions.canWrite, terminology, m)) ??
    (stack.stack
      ? !stack.supportsStackActions
        ? gt("This environment can display stacks but cannot merge them.")
        : !stack.isFresh
          ? gt("Refresh the stack before merging.")
          : scope?.reason
      : !canMergeSingle
        ? stack.error
          ? gt("Couldn't check stack membership. Refresh before merging.")
          : gt("Checking stack membership…")
        : null);
  const canMerge = !busy && method !== undefined && !reason;
  const label = method
    ? scope && scope.layers.length > 1
      ? gt(
          "{kind, select, squash {Squash and merge stack ({count})} merge {Create a merge commit stack ({count})} rebase {Rebase and merge stack ({count})} other {Fast-forward merge stack ({count})}}",
          { kind: mergeMethodKind(method), count: scope.layers.length },
        )
      : m(MERGE_METHODS[method].title)
    : gt("Merge unavailable");
  const nextAction =
    pr.state === "closed" ? "reopen" : pr.state === "open" && pr.isDraft ? "ready" : null;
  // States the button itself names, instead of a reason line under it. Draft and
  // closed offer their way forward when the viewer can take it.
  const status: {
    label: string;
    icon: AppSymbolName;
    final?: boolean;
    action?: "ready" | "reopen";
  } | null =
    nextAction && stateAction.available(nextAction)
      ? {
          label: pullRequestActionLabel(nextAction, terminology, m),
          icon: PR_ACTION_ICONS[nextAction],
          final: nextAction === "reopen",
          action: nextAction,
        }
      : pr.state === "merged"
        ? {
            label: gt("Merged", { $context: "pull request state" }),
            icon: PullRequestGlyph.merged,
            final: true,
          }
        : pr.state === "closed"
          ? {
              label: gt("Closed", { $context: "pull request state" }),
              icon: PullRequestGlyph.closed,
              final: true,
            }
          : pr.isDraft
            ? {
                label: gt("Draft", { $context: "pull request state" }),
                icon: PullRequestGlyph.draft,
              }
            : pr.mergeability === "conflicting"
              ? { label: gt("Resolve conflicts to merge"), icon: PullRequestGlyph.conflicting }
              : pr.autoMergeEnabled
                ? {
                    label: pr.autoMergeMethod
                      ? gt(
                          "Auto-merge pending ({kind, select, squash {squash} merge {merge} rebase {rebase} fastForward {fast-forward} other {{method}}})",
                          {
                            kind: mergeMethodKind(pr.autoMergeMethod),
                            method: pr.autoMergeMethod,
                          },
                        )
                      : gt("Auto-merge pending"),
                    icon: "clock",
                  }
                : checkingStack && !busy
                  ? { label: gt("Checking stack…"), icon: PullRequestGlyph.merged }
                  : null;
  const autoAction = pr.autoMergeEnabled ? "disable-auto-merge" : "enable-auto-merge";
  // A stack auto-merge request on this layer also covers the open layers below it.
  const stackAutoMerge =
    stack.stack !== null &&
    stack.supportsStackActions &&
    stack.isFresh &&
    pr.capabilities.stackAutoMerge === true;
  const canAutoMerge =
    !busy &&
    (autoAction === "disable-auto-merge" ||
      (stack.stack ? stackAutoMerge && scope !== null && !scope.reason : canMergeSingle)) &&
    permissions.canWrite &&
    canPerformPullRequestAction(pr, autoAction);

  const perform = async (
    action: "merge" | "enable-auto-merge" | "disable-auto-merge",
    shownHeadSha: string | undefined,
  ) => {
    if (
      pending.current ||
      (action !== "disable-auto-merge" && !method) ||
      (action === "merge" ? !canMerge : !canAutoMerge)
    )
      return;
    pending.current = true;
    setBusy(true);
    const response = await runAction({
      ...target,
      input: {
        ...target.input,
        action,
        // A merge lands the head on screen and refuses one that moved; a stack pins its other layers.
        ...(action !== "disable-auto-merge" && shownHeadSha
          ? { expectedHeadSha: shownHeadSha }
          : {}),
        // A cancel needs no pinned heads, so it keeps the stack scope even while the stack refreshes.
        ...(stack.stack &&
        ((action === "enable-auto-merge" && stackAutoMerge) ||
          (action === "disable-auto-merge" &&
            stack.supportsStackActions &&
            pr.capabilities.stackAutoMerge === true))
          ? { stackNumber: stack.stack.number }
          : {}),
        ...(action === "enable-auto-merge" && method && stackAutoMerge && scope
          ? { expectedStackHeads: scope.heads, mergeMethod: method }
          : action === "merge" && method && stack.stack && scope
            ? {
                stackNumber: stack.stack.number,
                expectedStackHeads: scope.heads,
                mergeMethod: method,
              }
            : action === "merge" && method
              ? {
                  resolveMergeMethod: (fresh) => {
                    if (
                      !canPerformPullRequestAction(fresh, "merge") ||
                      !allowedMergeMethods(fresh).includes(method)
                    )
                      throw new Error(
                        gt(
                          "The {term, select, mr {merge request} cr {change request} other {pull request}} changed. Refresh before merging.",
                          {
                            term: changeRequestTermKind(terminology),
                          },
                        ),
                      );
                    return method;
                  },
                }
              : action === "enable-auto-merge" && method
                ? { mergeMethod: method }
                : {}),
      },
    });
    // A stack can partly merge before the provider reports a failure.
    if (!AsyncResult.isSuccess(response)) refreshDetail();
    refreshActivity();
    stack.refresh();
    pending.current = false;
    setBusy(false);
    if (AsyncResult.isSuccess(response)) {
      triggerSemanticHaptic("confirm");
    } else if (AsyncResult.isFailure(response)) {
      triggerSemanticHaptic("reject");
      const cause = squashAtomCommandFailure(response);
      Dialog.alert(
        gt("Couldn't complete the merge action"),
        cause instanceof Error
          ? (errorDisplayMessage(cause, resolveMessage) ?? cause.message)
          : gt("Try again."),
      );
    }
  };
  const confirm = (action: "merge" | "enable-auto-merge" | "disable-auto-merge") => {
    // The overview refreshes on focus, so the alert merges the head it was opened on.
    const shownHeadSha = pr.headSha;
    const title =
      action === "merge"
        ? scope && scope.layers.length > 1
          ? gt(
              "{count, plural, one {Merge {count} stack layers?} other {Merge {count} stack layers?}}",
              { count: scope.layers.length },
            )
          : gt(
              "Merge {term, select, mr {merge request} cr {change request} other {pull request}}?",
              { term: changeRequestTermKind(terminology) },
            )
        : action === "enable-auto-merge"
          ? gt("Enable auto-merge?")
          : gt("Disable auto-merge?");
    const message =
      action === "merge" && scope
        ? gt(
            "Merge {layers} into {base} using {kind, select, squash {squash} merge {merge} rebase {rebase} fastForward {fast-forward} other {{method}}}. Layers above #{number} stay open.",
            {
              layers: scope.layers.map((layer) => `#${layer.number}`).join(" → "),
              base: stack.stack?.base ?? "",
              kind: mergeMethodKind(method),
              method: method ?? "",
              number: pr.number,
            },
          )
        : action === "enable-auto-merge" && stackAutoMerge && scope
          ? gt(
              "Merge {layers} into {base} using {kind, select, squash {squash} merge {merge} rebase {rebase} fastForward {fast-forward} other {{method}}} once their requirements are met. This may happen immediately.",
              {
                layers: scope.layers.map((layer) => `#${layer.number}`).join(" → "),
                base: stack.stack?.base ?? "",
                kind: mergeMethodKind(method),
                method: method ?? "",
              },
            )
          : action === "enable-auto-merge"
            ? gt(
                "Merge #{number} using {kind, select, squash {squash} merge {merge} rebase {rebase} fastForward {fast-forward} other {{method}}} when its requirements are met. This may happen immediately.",
                { number: pr.number, kind: mergeMethodKind(method), method: method ?? "" },
              )
            : action === "disable-auto-merge"
              ? gt(
                  "Stop the provider from automatically merging this {term, select, mr {merge request} cr {change request} other {pull request}}.",
                  {
                    term: changeRequestTermKind(terminology),
                  },
                )
              : gt(
                  "Merge #{number} into {branch} using {kind, select, squash {squash} merge {merge} rebase {rebase} fastForward {fast-forward} other {{method}}}.",
                  {
                    number: pr.number,
                    branch: pr.baseBranch,
                    kind: mergeMethodKind(method),
                    method: method ?? "",
                  },
                );
    Dialog.alert(title, message, [
      { text: gt("Cancel"), style: "cancel" },
      {
        text:
          action === "merge"
            ? label
            : action === "enable-auto-merge"
              ? gt("Enable auto-merge")
              : gt("Disable auto-merge"),
        onPress: () => void perform(action, shownHeadSha),
      },
    ]);
  };
  const mergeMenuActions = status?.final
    ? []
    : [
        ...methods.map((id) => ({
          id,
          title: m(MERGE_METHODS[id].title),
          state: id === method ? ("on" as const) : ("off" as const),
          attributes: { disabled: !canMerge && !canAutoMerge },
        })),
        ...(canAutoMerge
          ? [
              {
                id: autoAction,
                title: pr.autoMergeEnabled ? gt("Disable auto-merge") : gt("Enable auto-merge"),
                image: "clock",
              },
            ]
          : []),
      ];

  const handleMenuActionId = (id: string) => {
    const selected = methods.find((candidate) => candidate === id);
    if (selected) {
      triggerSemanticHaptic("segmentTick");
      setSelectedMethod(selected);
      void savePreferences({ pullRequestMergeMethod: selected });
    } else if (id === autoAction && canAutoMerge) {
      confirm(autoAction);
    }
  };

  const mergeAccessibilityLabel = status
    ? status.label
    : scope
      ? gt(
          "{count, plural, one {{label}, {count} stack layers through '#'{number}} other {{label}, {count} stack layers through '#'{number}}}",
          {
            label,
            count: scope.layers.length,
            number: pr.number,
          },
        )
      : label;

  const showAndroidSlideTrack =
    Platform.OS === "android" && canMerge && status === null && !useAccessibleTapConfirm;
  const showMergedSheen = Platform.OS === "android" && pr.state === "merged" && !status?.action;

  return (
    <View className="gap-2 border-t border-border-subtle p-3">
      {showMergedSheen ? (
        <MergedSheenBanner label={gt("Merged", { $context: "pull request state" })} />
      ) : showAndroidSlideTrack ? (
        <View className="flex-row items-center gap-2">
          <AndroidSlideToMergeTrack
            label={label}
            accessibilityLabel={mergeAccessibilityLabel}
            busy={busy}
            onCommitMerge={() => {
              const shownHeadSha = pr.headSha;
              void perform("merge", shownHeadSha);
            }}
          />
          {mergeMenuActions.length > 0 ? (
            <Menu
              title={gt("Merge options")}
              accessibilityLabel={gt("Merge options")}
              actions={mergeMenuActions}
              onPressAction={({ nativeEvent }) => handleMenuActionId(nativeEvent.event)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Merge options")}
                className="h-[52px] w-12 items-center justify-center rounded-full border border-border bg-subtle active:opacity-75"
              >
                <SymbolView
                  name="chevron.down"
                  size={14}
                  tintColorClassName="accent-foreground"
                  type="monochrome"
                />
              </Pressable>
            </Menu>
          ) : null}
        </View>
      ) : Platform.OS === "android" &&
        accessibleConfirmHeadSha !== null &&
        canMerge &&
        status === null ? (
        <Animated.View
          entering={ACCESSIBLE_CONFIRM_ENTERING}
          exiting={ACCESSIBLE_CONFIRM_EXITING}
          className="gap-2 rounded-2xl border border-border bg-subtle/60 p-3"
        >
          <Text className="font-t3-medium text-xs text-foreground">
            {gt("Confirm {label} into {branch}?", {
              label,
              branch: scope ? (stack.stack?.base ?? pr.baseBranch) : pr.baseBranch,
            })}
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label={gt("Cancel")}
                tone="secondary"
                disabled={busy}
                onPress={() => {
                  triggerSemanticHaptic("toggleOff");
                  setAccessibleConfirmHeadSha(null);
                }}
                fullWidth
              />
            </View>
            <View className="flex-1">
              <Button
                label={gt("Confirm merge")}
                tone="primary"
                loading={busy}
                disabled={busy}
                onPress={() => {
                  const headSha = accessibleConfirmHeadSha;
                  setAccessibleConfirmHeadSha(null);
                  void perform("merge", headSha);
                }}
                fullWidth
              />
            </View>
          </View>
        </Animated.View>
      ) : (
        <SplitButton
          label={
            busy || stateAction.busy
              ? gt("Working…")
              : !permissions.connected
                ? gt("Reconnect to merge")
                : (status?.label ?? label)
          }
          accessibilityLabel={mergeAccessibilityLabel}
          icon={status?.icon ?? PullRequestGlyph.merged}
          disabled={status?.action ? stateAction.busy : !canMerge || status !== null}
          loading={busy || stateAction.busy || (!status?.action && checkingStack)}
          onPress={() => {
            if (status?.action) {
              void stateAction.perform(status.action);
              return;
            }
            if (Platform.OS === "android" && useAccessibleTapConfirm) {
              triggerSemanticHaptic("contextClick");
              setAccessibleConfirmHeadSha(pr.headSha ?? "");
              return;
            }
            confirm("merge");
          }}
          menuTitle={gt("Merge options")}
          actions={mergeMenuActions}
          onPressAction={handleMenuActionId}
        />
      )}
      {permissions.connected && !status && reason ? (
        <Text className="px-1 text-xs text-foreground-muted">{reason}</Text>
      ) : null}
      {stack.error && stack.supportsStackActions ? (
        <Button label={gt("Retry stack lookup")} tone="text" onPress={stack.refresh} />
      ) : null}
    </View>
  );
}

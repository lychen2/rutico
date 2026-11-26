import { useGT, useMessages } from "gt-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Animated as RNAnimated,
  Linking,
  Platform,
  Pressable,
  useAnimatedValue,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { androidTonalSurfaceChrome } from "../../lib/designTokens";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import {
  DEFAULT_DECELERATION_RATE,
  SPRING_DETENT_SNAP,
  SPRING_SPATIAL_SNAPPY,
  projectOffset,
  rubberBandClamp,
  startNativePulseLoop,
  withVelocitySpringConfig,
} from "../../lib/mobileMotion";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  CompactVoiceWaveform,
  DictationElapsedTime,
  ReactiveSpringWaveform,
} from "./ComposerDictationControl";
import { useGlobalVoiceInput } from "./VoiceInputProvider";
import { resolveVoiceComposerPresentation } from "./voiceInputPresentation";

const PILL_HEIGHT = 36;
const COLLAPSED_WIDTH = 64;
const EXPANDED_MAX_WIDTH = 280;
const IOS_BOTTOM_CHROME_CLEARANCE = 64;
const ANDROID_ORB_SIZE = 54;
const ANDROID_EDGE_MARGIN = 12;
const LOCK_DRAG_THRESHOLD = 48;
const CANCEL_DRAG_THRESHOLD = 72;

const MORPH_TIMING = {
  duration: 260,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const BUBBLE_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const BUBBLE_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

export function GlobalVoiceInputControl(props: { readonly children: ReactNode }) {
  const voice = useGlobalVoiceInput();
  const [expanded, setExpanded] = useState(false);
  const resolveMessage = useMessages();
  const presentation = resolveVoiceComposerPresentation(
    voice.state,
    voice.elapsedSeconds,
    resolveMessage,
  );
  const visible =
    presentation.statusLabel !== null &&
    !(voice.ownerKey && voice.focusedOwners.has(voice.ownerKey));
  // A pill that reappears starts collapsed.
  if (!visible && expanded) setExpanded(false);
  const pill = visible ? (
    Platform.OS === "android" ? (
      <AndroidMagneticVoiceOrb expanded={expanded} onExpandedChange={setExpanded} />
    ) : (
      <EdgeDictationPill expanded={expanded} onExpandedChange={setExpanded} />
    )
  ) : null;
  return (
    <>
      <View
        className="flex-1"
        onStartShouldSetResponderCapture={() => {
          if (expanded) setExpanded(false);
          return false;
        }}
      >
        {props.children}
      </View>
      {pill && Platform.OS === "ios" ? <FullWindowOverlay>{pill}</FullWindowOverlay> : pill}
    </>
  );
}

function OrbRecordingPulse(props: { readonly active: boolean; readonly danger: boolean }) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const shouldPulse = props.active && appActive && !reducedMotion;
  const pulse = useAnimatedValue(0, { useNativeDriver: true });

  // Safe RN Animated loop (useNativeDriver: true) obeys DISABLE_COMMIT_PAUSING_MECHANISM.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives native recording halo around the Android Voice Orb while foregrounded
  useEffect(
    () =>
      startNativePulseLoop(pulse, {
        active: shouldPulse,
        duration: 1450,
        mode: "expand",
      }),
    [pulse, shouldPulse],
  );

  if (!shouldPulse) return null;

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.48, 0],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.48],
  });

  return (
    <RNAnimated.View
      pointerEvents="none"
      className={cn(
        "absolute inset-0 rounded-full",
        props.danger ? "bg-danger-foreground" : "bg-primary",
      )}
      style={{ opacity, transform: [{ scale }] }}
    />
  );
}

function AndroidMagneticVoiceOrb(props: {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}) {
  const voice = useGlobalVoiceInput();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { fabSize } = useAndroidControlSizing();
  const { themeAppearance } = useAppearancePreferences();
  const isDark = themeAppearance === "dark";
  const gt = useGT();
  const resolveMessage = useMessages();
  const { expanded, onExpandedChange: setExpanded } = props;

  const [dockedSide, setDockedSide] = useState<"left" | "right">("right");
  const [handsFreeLocked, setHandsFreeLocked] = useState(false);
  const [gestureFeedback, setGestureFeedback] = useState<"idle" | "lock-armed" | "cancel-armed">(
    "idle",
  );

  const presentation = resolveVoiceComposerPresentation(
    voice.state,
    voice.elapsedSeconds,
    resolveMessage,
  );
  const phase = voice.state.phase;
  const isRecording = phase === "recording";
  const isError = phase === "error";
  const openSettings = isError && voice.state.errorAction === "settings";
  const label = voice.label ?? gt("Draft", { $context: "noun, the draft being dictated into" });

  const minX = insets.left + ANDROID_EDGE_MARGIN;
  const maxX = Math.max(minX, windowWidth - insets.right - ANDROID_EDGE_MARGIN - ANDROID_ORB_SIZE);
  const minY = insets.top + 68;
  const defaultBottom = Math.max(insets.bottom, 16) + 16 + fabSize + 12;
  const maxY = Math.max(minY, windowHeight - defaultBottom - ANDROID_ORB_SIZE);

  const orbX = useSharedValue(maxX);
  const orbY = useSharedValue(maxY);
  const dragStartX = useSharedValue(maxX);
  const dragStartY = useSharedValue(maxY);
  const cancelArmedSV = useSharedValue(false);
  const lockArmedSV = useSharedValue(false);
  const dockedSideSV = useSharedValue<"left" | "right">(dockedSide);
  const lockedSV = useSharedValue(handsFreeLocked);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clamps orb position cleanly on orientation or fold changes
  useEffect(() => {
    dockedSideSV.set(dockedSide);
    lockedSV.set(handsFreeLocked);
    const targetX = dockedSide === "left" ? minX : maxX;
    orbX.set(withSpring(targetX, SPRING_SPATIAL_SNAPPY));
    orbY.set(withSpring(Math.max(minY, Math.min(maxY, orbY.get())), SPRING_SPATIAL_SNAPPY));
  }, [dockedSide, dockedSideSV, handsFreeLocked, lockedSV, maxX, maxY, minX, minY, orbX, orbY]);

  const handleLockArmed = useCallback((armed: boolean) => {
    if (armed) {
      triggerSemanticHaptic("toggleOn");
      setGestureFeedback("lock-armed");
    } else {
      setGestureFeedback("idle");
    }
  }, []);

  const handleCancelArmed = useCallback((armed: boolean) => {
    if (armed) {
      triggerSemanticHaptic("reject");
      setGestureFeedback("cancel-armed");
    } else {
      setGestureFeedback("idle");
    }
  }, []);

  const commitLock = useCallback(() => {
    triggerSemanticHaptic("toggleOn");
    setHandsFreeLocked(true);
    setExpanded(true);
    setGestureFeedback("idle");
  }, [setExpanded]);

  const commitCancel = useCallback(() => {
    triggerSemanticHaptic("reject");
    setGestureFeedback("idle");
    setHandsFreeLocked(false);
    voice.cancel();
  }, [voice]);

  const commitDockSide = useCallback((side: "left" | "right") => {
    triggerSemanticHaptic("gestureEnd");
    setDockedSide(side);
    setGestureFeedback("idle");
  }, []);

  const panGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory, not a React component.
      Gesture.Pan()
        .minDistance(6)
        .onStart(() => {
          cancelAnimation(orbX);
          cancelAnimation(orbY);
          dragStartX.set(orbX.get());
          dragStartY.set(orbY.get());
          cancelArmedSV.set(false);
          lockArmedSV.set(false);
        })
        .onUpdate((event) => {
          const nextX = dragStartX.get() + event.translationX;
          const nextY = dragStartY.get() + event.translationY;
          orbX.set(rubberBandClamp(nextX, minX - 24, maxX + 24, windowWidth * 0.4, 0.25));
          orbY.set(rubberBandClamp(nextY, minY, maxY, windowHeight * 0.4, 0.22));

          if (!isRecording) return;

          // Swipe away from docked edge cancels dictation; swipe upward locks hands-free.
          const inwardDelta =
            dockedSideSV.get() === "right" ? -event.translationX : event.translationX;
          const cancelArmed =
            inwardDelta >= CANCEL_DRAG_THRESHOLD && Math.abs(event.translationY) < 60;
          if (cancelArmed !== cancelArmedSV.get()) {
            cancelArmedSV.set(cancelArmed);
            runOnJS(handleCancelArmed)(cancelArmed);
          }

          const lockArmed =
            !lockedSV.get() &&
            !cancelArmed &&
            -event.translationY >= LOCK_DRAG_THRESHOLD &&
            Math.abs(event.translationX) < 56;
          if (lockArmed !== lockArmedSV.get()) {
            lockArmedSV.set(lockArmed);
            runOnJS(handleLockArmed)(lockArmed);
          }
        })
        .onEnd((event) => {
          if (cancelArmedSV.get()) {
            cancelArmedSV.set(false);
            runOnJS(commitCancel)();
            return;
          }
          if (lockArmedSV.get()) {
            lockArmedSV.set(false);
            const targetX = dockedSideSV.get() === "left" ? minX : maxX;
            const targetY = Math.max(minY, Math.min(maxY, dragStartY.get()));
            orbX.set(withSpring(targetX, SPRING_DETENT_SNAP));
            orbY.set(withSpring(targetY, SPRING_DETENT_SNAP));
            runOnJS(commitLock)();
            return;
          }

          const projectedX = projectOffset(orbX.get(), event.velocityX, DEFAULT_DECELERATION_RATE);
          const projectedY = projectOffset(orbY.get(), event.velocityY, DEFAULT_DECELERATION_RATE);
          const snapSide: "left" | "right" = projectedX < (minX + maxX) * 0.5 ? "left" : "right";
          const targetX = snapSide === "left" ? minX : maxX;
          const targetY = Math.max(minY, Math.min(maxY, projectedY));

          orbX.set(
            withSpring(targetX, withVelocitySpringConfig(SPRING_SPATIAL_SNAPPY, event.velocityX)),
          );
          orbY.set(
            withSpring(targetY, withVelocitySpringConfig(SPRING_SPATIAL_SNAPPY, event.velocityY)),
          );
          runOnJS(commitDockSide)(snapSide);
        }),
    [
      cancelArmedSV,
      commitCancel,
      commitDockSide,
      commitLock,
      dockedSideSV,
      dragStartX,
      dragStartY,
      handleCancelArmed,
      handleLockArmed,
      isRecording,
      lockArmedSV,
      lockedSV,
      maxX,
      maxY,
      minX,
      minY,
      orbX,
      orbY,
      windowHeight,
      windowWidth,
    ],
  );

  const orbContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: orbX.get() }, { translateY: orbY.get() }],
  }));

  const chrome = androidTonalSurfaceChrome(isDark, "high");
  const isCancelArmed = gestureFeedback === "cancel-armed";
  const isLockArmed = gestureFeedback === "lock-armed";
  const previewBubbleWidth = Math.min(windowWidth - 32, EXPANDED_MAX_WIDTH);

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <GestureDetector gesture={panGesture}>
        <Animated.View
          entering={ENTERING}
          pointerEvents="box-none"
          className="absolute left-0 top-0"
          style={orbContainerStyle}
        >
          {/* Floating live transcription / status preview bubble anchored above the Voice Orb */}
          {expanded || isRecording || isError ? (
            <Animated.View
              entering={BUBBLE_ENTERING}
              exiting={BUBBLE_EXITING}
              className="absolute bottom-[62px] overflow-hidden rounded-2xl border bg-card-alt px-3 py-2"
              style={{
                width: expanded ? previewBubbleWidth : Math.min(212, previewBubbleWidth),
                ...(dockedSide === "right" ? { right: 0 } : { left: 0 }),
                borderColor: isCancelArmed ? undefined : chrome.borderColor,
                borderTopColor: chrome.specularTopBorderColor,
                boxShadow: [...chrome.boxShadow],
              }}
            >
              <View className="flex-row items-center gap-2">
                {isCancelArmed ? (
                  <Text className="flex-1 font-t3-semibold text-xs text-danger-foreground">
                    {gt("Release to cancel dictation")}
                  </Text>
                ) : isLockArmed ? (
                  <Text className="flex-1 font-t3-semibold text-xs text-primary">
                    {gt("Release to lock hands-free")}
                  </Text>
                ) : (
                  <>
                    <View className="min-w-0 flex-1 gap-0.5">
                      <View className="flex-row items-center gap-1.5">
                        {handsFreeLocked ? (
                          <SymbolView
                            name={{ ios: "lock", android: "lock" }}
                            size={10}
                            tintColorClassName="accent-primary"
                            type="monochrome"
                          />
                        ) : null}
                        <Text
                          className={cn(
                            "shrink text-xs",
                            isError ? "text-danger-foreground" : "font-t3-medium text-foreground",
                          )}
                          numberOfLines={1}
                        >
                          {isError ? presentation.statusLabel : label}
                        </Text>
                      </View>
                      {isRecording ? (
                        <View className="flex-row items-center gap-2">
                          <ReactiveSpringWaveform audioLevels={voice.audioLevels} height={14} />
                          <DictationElapsedTime
                            className="text-foreground-muted"
                            seconds={voice.elapsedSeconds}
                          />
                        </View>
                      ) : !isError ? (
                        <Text className="text-2xs text-foreground-muted" numberOfLines={1}>
                          {presentation.statusLabel}
                        </Text>
                      ) : null}
                    </View>
                    {expanded ? (
                      <View className="flex-row items-center gap-1">
                        <Pressable
                          accessibilityLabel={
                            isError ? gt("Dismiss voice input error") : gt("Cancel dictation")
                          }
                          accessibilityRole="button"
                          className="size-8 items-center justify-center rounded-full bg-subtle active:opacity-70"
                          onPress={() => {
                            triggerSemanticHaptic("reject");
                            setHandsFreeLocked(false);
                            voice.cancel();
                          }}
                        >
                          <SymbolView
                            name="xmark"
                            size={12}
                            tintColorClassName="accent-icon-muted"
                            type="monochrome"
                          />
                        </Pressable>
                        {isRecording ? (
                          <Pressable
                            accessibilityLabel={gt("Finish dictation")}
                            accessibilityRole="button"
                            className="size-8 items-center justify-center rounded-full bg-primary active:opacity-70"
                            onPress={() => {
                              triggerSemanticHaptic("confirm");
                              setHandsFreeLocked(false);
                              voice.stop();
                            }}
                          >
                            <SymbolView
                              name="checkmark"
                              size={12}
                              weight="semibold"
                              tintColorClassName="accent-primary-foreground"
                              type="monochrome"
                            />
                          </Pressable>
                        ) : isError && voice.isAvailable ? (
                          <Pressable
                            accessibilityLabel={
                              openSettings ? gt("Open microphone settings") : gt("Retry dictation")
                            }
                            accessibilityRole="button"
                            className="size-8 items-center justify-center rounded-full bg-subtle active:opacity-70"
                            onPress={() => {
                              triggerSemanticHaptic("contextClick");
                              if (!openSettings) {
                                void voice.session.retry();
                                return;
                              }
                              voice.cancel();
                              void Linking.openSettings();
                            }}
                          >
                            <SymbolView name="mic" size={14} tintColorClassName="accent-icon" />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </Animated.View>
          ) : null}

          {/* Magnetic Edge Voice Orb */}
          <View
            style={{
              width: ANDROID_ORB_SIZE,
              height: ANDROID_ORB_SIZE,
              borderRadius: ANDROID_ORB_SIZE / 2,
              boxShadow: [...chrome.boxShadow],
            }}
          >
            <OrbRecordingPulse active={isRecording} danger={isCancelArmed} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("{status}, dictating into {destination}", {
                status: presentation.statusLabel,
                destination: label,
              })}
              accessibilityHint={gt("Shows dictation controls")}
              onPress={() => {
                triggerSemanticHaptic("contextClick");
                setExpanded(!expanded);
              }}
              className={cn(
                "flex-1 items-center justify-center rounded-full border",
                isCancelArmed
                  ? "border-danger-foreground bg-danger"
                  : isError
                    ? "border-danger-border bg-card-alt"
                    : "bg-card-alt",
              )}
              style={{
                borderColor: isCancelArmed || isError ? undefined : chrome.borderColor,
                borderTopColor: isCancelArmed ? undefined : chrome.specularTopBorderColor,
              }}
            >
              {isCancelArmed ? (
                <SymbolView
                  name="xmark"
                  size={20}
                  tintColorClassName="accent-danger-foreground"
                  type="monochrome"
                />
              ) : isLockArmed ? (
                <SymbolView
                  name={{ ios: "lock", android: "lock" }}
                  size={18}
                  tintColorClassName="accent-primary"
                  type="monochrome"
                />
              ) : isError ? (
                <SymbolView
                  name="exclamationmark.circle"
                  size={20}
                  tintColorClassName="accent-danger-foreground"
                  type="monochrome"
                />
              ) : isRecording ? (
                <ReactiveSpringWaveform audioLevels={voice.audioLevels} height={20} />
              ) : (
                <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
              )}
            </Pressable>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function EdgeDictationPill(props: {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}) {
  const voice = useGlobalVoiceInput();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { fabSize } = useAndroidControlSizing();
  const { expanded, onExpandedChange: setExpanded } = props;
  const progress = useDerivedValue(() => withTiming(expanded ? 1 : 0, MORPH_TIMING));

  const expandedWidth = Math.min(width - insets.left - insets.right - 32, EXPANDED_MAX_WIDTH);
  const pillStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.get(), [0, 1], [COLLAPSED_WIDTH, expandedWidth]),
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.3, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const bottom =
    Platform.OS === "android"
      ? Math.max(insets.bottom, 16) + 16 + fabSize + 12
      : Math.max(insets.bottom, 12) + IOS_BOTTOM_CHROME_CLEARANCE;

  const gt = useGT();
  const resolveMessage = useMessages();
  const presentation = resolveVoiceComposerPresentation(
    voice.state,
    voice.elapsedSeconds,
    resolveMessage,
  );
  const phase = voice.state.phase;
  const isError = phase === "error";
  const openSettings = isError && voice.state.errorAction === "settings";
  const label = voice.label ?? gt("Draft", { $context: "noun, the draft being dictated into" });

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <Animated.View
        entering={ENTERING}
        className="absolute rounded-l-full border border-r-0 border-border bg-card shadow-md shadow-black/10"
        style={[{ bottom, right: insets.right, height: PILL_HEIGHT }, pillStyle]}
      >
        <View className="flex-1 overflow-hidden rounded-l-full">
          <Animated.View
            accessibilityElementsHidden={expanded}
            importantForAccessibility={expanded ? "no-hide-descendants" : "auto"}
            pointerEvents={expanded ? "none" : "auto"}
            className="absolute bottom-0 right-0 top-0"
            style={[{ width: COLLAPSED_WIDTH }, collapsedStyle]}
          >
            <Pressable
              accessibilityLabel={gt("{status}, dictating into {destination}", {
                status: presentation.statusLabel,
                destination: label,
              })}
              accessibilityHint={gt("Shows dictation controls")}
              accessibilityRole="button"
              className="flex-1 flex-row items-center justify-center gap-1.5 active:opacity-70"
              hitSlop={{ top: 6, bottom: 6, left: 6 }}
              onPress={() => setExpanded(true)}
            >
              {isError ? (
                <SymbolView
                  name="exclamationmark.circle"
                  size={16}
                  tintColorClassName="accent-danger-foreground"
                  type="monochrome"
                />
              ) : phase === "recording" ? (
                <>
                  <View className="size-2 rounded-full bg-danger-foreground" />
                  <DictationElapsedTime
                    className="text-foreground"
                    seconds={voice.elapsedSeconds}
                  />
                </>
              ) : (
                <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
              )}
            </Pressable>
          </Animated.View>

          <Animated.View
            accessibilityElementsHidden={!expanded}
            importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
            pointerEvents={expanded ? "auto" : "none"}
            className="absolute bottom-0 right-0 top-0 flex-row items-center gap-1.5 pl-1 pr-1.5"
            style={[{ width: expandedWidth }, expandedStyle]}
          >
            <Pressable
              accessibilityLabel={
                isError ? gt("Dismiss voice input error") : gt("Cancel dictation")
              }
              accessibilityRole="button"
              className="size-[30px] items-center justify-center active:opacity-70"
              onPress={voice.cancel}
            >
              <SymbolView
                name="xmark"
                size={13}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            </Pressable>
            <Pressable
              accessibilityLabel={isError ? (presentation.statusLabel ?? label) : label}
              accessibilityHint={gt("Hides dictation controls")}
              accessibilityRole="button"
              className="min-w-0 flex-1 justify-center self-stretch active:opacity-70"
              onPress={() => setExpanded(false)}
            >
              <Text
                className={cn(
                  "text-xs",
                  isError ? "text-danger-foreground" : "font-t3-medium text-foreground",
                )}
                numberOfLines={1}
              >
                {isError ? presentation.statusLabel : label}
              </Text>
            </Pressable>
            {phase === "recording" ? (
              <>
                <CompactVoiceWaveform audioLevels={voice.audioLevels} />
                <DictationElapsedTime
                  className="text-foreground-muted"
                  seconds={voice.elapsedSeconds}
                />
                <Pressable
                  accessibilityLabel={gt("Finish dictation")}
                  accessibilityRole="button"
                  className="size-[30px] items-center justify-center active:opacity-70"
                  onPress={voice.stop}
                >
                  <View className="size-[24px] items-center justify-center rounded-full bg-primary">
                    <SymbolView
                      name="checkmark"
                      size={12}
                      weight="semibold"
                      tintColorClassName="accent-primary-foreground"
                      type="monochrome"
                    />
                  </View>
                </Pressable>
              </>
            ) : isError ? (
              voice.isAvailable ? (
                <Pressable
                  accessibilityLabel={
                    openSettings ? gt("Open microphone settings") : gt("Retry dictation")
                  }
                  accessibilityRole="button"
                  className="size-[30px] items-center justify-center active:opacity-70"
                  onPress={() => {
                    if (!openSettings) {
                      void voice.session.retry();
                      return;
                    }
                    voice.cancel();
                    void Linking.openSettings();
                  }}
                >
                  <SymbolView name="mic" size={16} tintColorClassName="accent-icon" />
                </Pressable>
              ) : null
            ) : (
              <View
                accessibilityLabel={presentation.statusLabel ?? undefined}
                className="size-[30px] items-center justify-center"
              >
                <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
              </View>
            )}
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

import type { VoiceInputPhase, VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { useGT } from "gt-react-native";
import { memo, useState, type ReactNode } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Text as SystemText,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
  type SharedValue,
} from "react-native-reanimated";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { cn } from "../../lib/cn";
import { SPRING_EFFECTS_FAST } from "../../lib/mobileMotion";
import type { VoiceComposerPresentation } from "./voiceInputPresentation";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";

const DICTATION_TIMING = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const TOOLBAR_FLIP_TIMING = {
  duration: 260,
  easing: Easing.inOut(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const TOOLBAR_HALF_HEIGHT = 22;
const TOOLBAR_PERSPECTIVE = 600;

function toolbarFlip(fromDegrees: number, toDegrees: number): EntryExitAnimationFunction {
  return () => {
    "worklet";
    const fromRadians = (fromDegrees * Math.PI) / 180;
    const toRadians = (toDegrees * Math.PI) / 180;
    const fromSine = Math.sin(fromRadians);
    const toSine = Math.sin(toRadians);
    return {
      initialValues: {
        opacity: fromDegrees === 0 ? 1 : 0,
        transform: [
          { perspective: TOOLBAR_PERSPECTIVE },
          { translateY: -TOOLBAR_HALF_HEIGHT * fromSine },
          { rotateX: `${fromDegrees}deg` },
        ],
      },
      animations: {
        opacity: withTiming(toDegrees === 0 ? 1 : 0, TOOLBAR_FLIP_TIMING),
        transform: [
          { perspective: TOOLBAR_PERSPECTIVE },
          {
            translateY: withTiming(-TOOLBAR_HALF_HEIGHT * toSine, {
              ...TOOLBAR_FLIP_TIMING,
              easing: (time) => {
                const angle =
                  fromRadians + (toRadians - fromRadians) * TOOLBAR_FLIP_TIMING.easing(time);
                return (Math.sin(angle) - fromSine) / (toSine - fromSine);
              },
            }),
          },
          { rotateX: withTiming(`${toDegrees}deg`, TOOLBAR_FLIP_TIMING) },
        ],
      },
    };
  };
}

const DRAFT_TOOLBAR_ENTERING = toolbarFlip(90, 0);
const DRAFT_TOOLBAR_EXITING = toolbarFlip(0, 90);
const DICTATION_TOOLBAR_ENTERING = toolbarFlip(-90, 0);
const DICTATION_TOOLBAR_EXITING = toolbarFlip(0, -90);
const WAVEFORM_BAR_HEIGHT = 32;
const WAVEFORM_MIN_BAR_HEIGHT = 2;
const WAVEFORM_BAR_SPACING = 5;
const WAVEFORM_TIMING = {
  duration: 100,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
} as const;

export function ComposerDictationDraftContent(props: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly compact: boolean;
  readonly hidden: boolean;
}) {
  const hidden = props.hidden;
  const rotation = useDerivedValue(() => withTiming(hidden ? 1 : 0, TOOLBAR_FLIP_TIMING));
  const compact = props.compact;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: compact ? 1 - rotation.value : 1,
    transform: compact
      ? [
          { perspective: TOOLBAR_PERSPECTIVE },
          { translateY: -TOOLBAR_HALF_HEIGHT * Math.sin((rotation.value * Math.PI) / 2) },
          { rotateX: `${rotation.value * 90}deg` },
        ]
      : [],
  }));

  return (
    <Animated.View
      accessibilityElementsHidden={props.hidden}
      importantForAccessibility={props.hidden ? "no-hide-descendants" : "auto"}
      collapsable={false}
      className={props.className}
      pointerEvents={props.hidden ? "none" : "auto"}
      style={[animatedStyle, { backfaceVisibility: "hidden" }]}
    >
      {props.children}
    </Animated.View>
  );
}

export function ComposerDictationToolbar(props: {
  readonly children: ReactNode;
  readonly showsDictation: boolean;
  readonly visible?: boolean;
}) {
  // Android can drop the reduced-motion flip's final frame, leaving the toolbar invisible.
  const reducedMotion = useReducedMotion();
  const entering = props.showsDictation ? DICTATION_TOOLBAR_ENTERING : DRAFT_TOOLBAR_ENTERING;
  const exiting = props.showsDictation ? DICTATION_TOOLBAR_EXITING : DRAFT_TOOLBAR_EXITING;

  return (
    <View className="relative h-[44px] overflow-hidden">
      {props.visible !== false ? (
        <Animated.View
          key={props.showsDictation ? "dictation" : "draft"}
          className="absolute inset-0"
          entering={reducedMotion ? undefined : entering}
          exiting={reducedMotion ? undefined : exiting}
          style={{ backfaceVisibility: "hidden" }}
        >
          {props.children}
        </Animated.View>
      ) : null}
    </View>
  );
}

const WaveformBar = memo(function WaveformBar(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
  readonly sampleIndex: number;
  readonly height?: number;
  readonly weight?: number;
  readonly reducedMotion?: boolean;
}) {
  const { audioLevels, sampleIndex, reducedMotion = false } = props;
  const height = props.height ?? WAVEFORM_BAR_HEIGHT;
  const weight = props.weight ?? 1;
  const animatedStyle = useAnimatedStyle(() => {
    const levels = audioLevels.get();
    const rawLevel = levels[sampleIndex] ?? 0;
    const level = Math.max(0, Math.min(1, rawLevel * weight));
    const targetScale =
      (WAVEFORM_MIN_BAR_HEIGHT + level * (height - WAVEFORM_MIN_BAR_HEIGHT)) / height;
    if (reducedMotion) {
      return {
        opacity: 0.35 + level * 0.65,
        transform: [{ scaleY: Math.max(0.28, targetScale) }],
      };
    }
    return {
      opacity: withTiming(0.24 + level * 0.76, WAVEFORM_TIMING),
      transform: [
        {
          scaleY:
            Platform.OS === "android"
              ? withSpring(targetScale, SPRING_EFFECTS_FAST)
              : withTiming(targetScale, WAVEFORM_TIMING),
        },
      ],
    };
  });

  return (
    <Animated.View
      className="w-0.5 rounded-full bg-foreground"
      style={[{ height }, animatedStyle]}
    />
  );
});

const REACTIVE_SPRING_BARS = [
  { id: "spectrum-0", weight: 0.68, offset: 0 },
  { id: "spectrum-1", weight: 0.9, offset: 1 },
  { id: "spectrum-2", weight: 1.0, offset: 2 },
  { id: "spectrum-3", weight: 0.9, offset: 3 },
  { id: "spectrum-4", weight: 0.68, offset: 4 },
] as const;
const REACTIVE_SPRING_BAR_HEIGHT = 18;

/**
 * 5-bar real-time dB spring spectrum driven directly from the audioLevels SharedValue
 * with zero React re-renders; degrades cleanly to static level indicators under ReduceMotion.
 */
export const ReactiveSpringWaveform = memo(function ReactiveSpringWaveform(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
  readonly height?: number;
  readonly barClassName?: string;
}) {
  const reducedMotion = useReducedMotion();
  const height = props.height ?? REACTIVE_SPRING_BAR_HEIGHT;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center gap-[3px]"
      style={{ height }}
    >
      {REACTIVE_SPRING_BARS.map((bar) => (
        <ReactiveSpectrumBar
          key={bar.id}
          audioLevels={props.audioLevels}
          sampleIndex={Math.max(0, VOICE_WAVEFORM_SAMPLE_COUNT - 5 + bar.offset)}
          height={height}
          weight={bar.weight}
          reducedMotion={reducedMotion}
          barClassName={props.barClassName}
        />
      ))}
    </View>
  );
});

const ReactiveSpectrumBar = memo(function ReactiveSpectrumBar(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
  readonly sampleIndex: number;
  readonly height: number;
  readonly weight: number;
  readonly reducedMotion: boolean;
  readonly barClassName?: string;
}) {
  const { audioLevels, sampleIndex, height, weight, reducedMotion } = props;
  const animatedStyle = useAnimatedStyle(() => {
    const levels = audioLevels.get();
    const rawLevel = levels[sampleIndex] ?? 0;
    const weighted = Math.max(0, Math.min(1, rawLevel * weight));
    const minFraction = 0.22;
    const targetScale = minFraction + weighted * (1 - minFraction);
    if (reducedMotion) {
      return {
        opacity: 0.4 + weighted * 0.6,
        transform: [{ scaleY: Math.max(0.32, Math.round(targetScale * 4) / 4) }],
      };
    }
    return {
      opacity: withSpring(0.35 + weighted * 0.65, SPRING_EFFECTS_FAST),
      transform: [{ scaleY: withSpring(targetScale, SPRING_EFFECTS_FAST) }],
    };
  });

  return (
    <Animated.View
      className={cn("w-[3px] rounded-full bg-primary", props.barClassName)}
      style={[{ height }, animatedStyle]}
    />
  );
});

const COMPACT_WAVEFORM_BAR_COUNT = 8;
const COMPACT_WAVEFORM_BAR_HEIGHT = 14;

export const CompactVoiceWaveform = memo(function CompactVoiceWaveform(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
}) {
  const reducedMotion = useReducedMotion();
  if (Platform.OS === "android") {
    return <ReactiveSpringWaveform audioLevels={props.audioLevels} height={14} />;
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center gap-0.5"
      style={{ height: COMPACT_WAVEFORM_BAR_HEIGHT }}
    >
      {Array.from({ length: COMPACT_WAVEFORM_BAR_COUNT }, (_, index) => (
        <WaveformBar
          key={index}
          audioLevels={props.audioLevels}
          height={COMPACT_WAVEFORM_BAR_HEIGHT}
          sampleIndex={VOICE_WAVEFORM_SAMPLE_COUNT - COMPACT_WAVEFORM_BAR_COUNT + index}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
});

const VoiceWaveform = memo(function VoiceWaveform(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
}) {
  const [barCount, setBarCount] = useState(0);
  const handleLayout = (event: LayoutChangeEvent) => {
    setBarCount(
      Math.max(
        1,
        Math.min(
          VOICE_WAVEFORM_SAMPLE_COUNT,
          Math.floor(event.nativeEvent.layout.width / WAVEFORM_BAR_SPACING),
        ),
      ),
    );
  };

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="min-w-0 flex-1 flex-row items-center justify-between overflow-hidden"
      style={{ height: WAVEFORM_BAR_HEIGHT }}
      onLayout={handleLayout}
    >
      {Array.from({ length: barCount }, (_, index) => (
        <WaveformBar
          key={index}
          audioLevels={props.audioLevels}
          sampleIndex={VOICE_WAVEFORM_SAMPLE_COUNT - barCount + index}
        />
      ))}
    </View>
  );
});

const DICTATION_ERROR_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const DICTATION_ERROR_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

/** Use system tabular figures; DM Sans lacks them and would jitter. */
export function DictationElapsedTime(props: {
  readonly seconds: number;
  readonly className?: string;
}) {
  const gt = useGT();
  const safeSeconds = Math.max(0, Math.floor(props.seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const accessibilityLabel =
    minutes > 0
      ? gt(
          "{minutes, plural, one {{minutes} minute} other {{minutes} minutes}} {seconds, plural, one {{seconds} second} other {{seconds} seconds}} elapsed",
          {
            minutes,
            seconds: remainingSeconds,
          },
        )
      : gt("{seconds, plural, one {{seconds} second} other {{seconds} seconds}} elapsed", {
          seconds: remainingSeconds,
        });
  return (
    <SystemText
      accessibilityLabel={accessibilityLabel}
      className={cn("text-xs", props.className)}
      numberOfLines={1}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {minutes}:{String(remainingSeconds).padStart(2, "0")}
    </SystemText>
  );
}

function VoiceActionButton(props: {
  readonly size?: "regular" | "large";
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly icon: AppSymbolName;
  readonly loading?: boolean;
  readonly onPress: () => void;
  readonly variant?: "plain" | "primary";
}) {
  const { scale } = useAndroidControlSizing();
  const variant = props.variant ?? "plain";
  const loading = props.loading === true;
  const large = props.size === "large";
  const circleSize = Math.round((large ? 44 : 30) * scale);
  const iconSize = Math.round(
    (variant === "primary" ? (large ? 20 : 16) : large ? 24 : 20) * scale,
  );
  const primaryStyle = useAnimatedStyle(() => ({
    opacity: withTiming(loading ? 0 : 1, DICTATION_TIMING),
  }));

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.loading, disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center active:opacity-70"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        opacity: props.disabled && !props.loading ? 0.4 : 1,
        // Matches ComposerActionButton so the circle stays concentric with the large composer corner.
        // An undefined width would still override the class's 44px width.
        ...(variant === "primary" && large ? { width: 62 } : null),
      }}
    >
      <View
        className={cn(
          "items-center justify-center",
          variant === "primary" ? "rounded-full bg-subtle" : "size-[44px]",
        )}
        style={variant === "primary" ? { width: circleSize, height: circleSize } : undefined}
      >
        {variant === "primary" ? (
          <Animated.View
            className="absolute inset-0 rounded-full bg-primary"
            style={primaryStyle}
          />
        ) : null}
        <View className="absolute inset-0 items-center justify-center">
          {props.loading ? (
            <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
          ) : (
            <SymbolView
              name={props.icon}
              size={iconSize}
              weight={variant === "primary" ? "semibold" : "regular"}
              tintColorClassName={
                variant === "primary" ? "accent-primary-foreground" : "accent-icon"
              }
              type="monochrome"
            />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function ComposerDictationError(props: {
  readonly error: string | null;
  readonly onDismiss: () => void;
}) {
  const gt = useGT();
  if (!props.error) return null;
  return (
    <Animated.View
      entering={DICTATION_ERROR_ENTERING}
      exiting={DICTATION_ERROR_EXITING}
      className="min-w-0 flex-row items-center gap-2 px-4 py-3"
    >
      <Text accessibilityRole="alert" className="min-w-0 flex-1 text-sm text-danger-foreground">
        {props.error}
      </Text>
      <Pressable
        accessibilityLabel={gt("Dismiss voice input error")}
        accessibilityRole="button"
        className="size-7 items-center justify-center active:opacity-70"
        hitSlop={10}
        onPress={props.onDismiss}
      >
        <SymbolView
          name="xmark"
          size={12}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
      </Pressable>
    </Animated.View>
  );
}

export function ComposerDictationStatus(props: {
  readonly audioLevels: SharedValue<ReadonlyArray<number>>;
  readonly elapsedSeconds: number;
  readonly phase: VoiceInputPhase;
  readonly presentation: VoiceComposerPresentation;
}) {
  const recording = props.phase === "recording";
  const waveformStyle = useAnimatedStyle(() => ({
    opacity: withTiming(recording ? 1 : 0, DICTATION_TIMING),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: withTiming(recording ? 0 : 1, DICTATION_TIMING),
  }));

  if (!props.presentation.statusLabel || props.presentation.statusKind === "error") return null;
  return (
    <View className="relative h-11 min-w-0 flex-1 justify-center">
      <View
        accessible
        accessibilityLabel={props.presentation.statusLabel}
        accessibilityLiveRegion={props.phase === "recording" ? "none" : "polite"}
        className="h-11"
      >
        <Animated.View
          className="absolute inset-0 min-w-0 flex-row items-center gap-2 px-1"
          style={waveformStyle}
        >
          <VoiceWaveform audioLevels={props.audioLevels} />
          <DictationElapsedTime className="text-foreground-muted" seconds={props.elapsedSeconds} />
        </Animated.View>
        <Animated.View className="absolute inset-0 justify-center px-2" style={labelStyle}>
          <Text className="text-center text-sm text-foreground-muted" numberOfLines={1}>
            {props.presentation.statusLabel}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

export function ComposerDictationCancelAction(props: {
  readonly size?: "regular" | "large";
  readonly presentation: VoiceComposerPresentation;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  if (props.presentation.leadingAction !== "cancel") return null;
  return (
    <VoiceActionButton
      size={props.size}
      accessibilityLabel={gt("Cancel dictation")}
      icon="xmark"
      onPress={props.onCancel}
    />
  );
}

export function ComposerDictationPrimaryAction(props: {
  readonly size?: "regular" | "large";
  readonly state: VoiceInputState;
  readonly presentation: VoiceComposerPresentation;
  readonly isAvailable: boolean;
  readonly disabled?: boolean;
  readonly onStart: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  if (props.presentation.trailingAction === "confirm") {
    return (
      <VoiceActionButton
        size={props.size}
        accessibilityLabel={
          props.presentation.confirmationEnabled
            ? gt("Finish dictation")
            : (props.presentation.statusLabel ?? gt("Preparing voice input"))
        }
        disabled={!props.presentation.confirmationEnabled}
        icon="checkmark"
        loading={!props.presentation.confirmationEnabled}
        onPress={props.onConfirm}
        variant="primary"
      />
    );
  }

  return <ComposerDictationStartAction {...props} />;
}

export function ComposerDictationStartAction(props: {
  readonly size?: "regular" | "large";
  readonly state: VoiceInputState;
  readonly isAvailable: boolean;
  readonly disabled?: boolean;
  readonly onStart: () => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  if (!props.isAvailable) return null;
  const openSettings = props.state.phase === "error" && props.state.errorAction === "settings";
  return (
    <VoiceActionButton
      size={props.size}
      accessibilityLabel={openSettings ? gt("Open microphone settings") : gt("Start dictation")}
      disabled={props.disabled}
      icon="mic"
      onPress={
        openSettings
          ? () => {
              props.onCancel();
              void Linking.openSettings();
            }
          : props.onStart
      }
    />
  );
}

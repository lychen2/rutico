import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, View, type GestureResponderEvent } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import type { TerminalFontSizeZoomEvent } from "./nativeTerminalModule";
import {
  computeTrackpadCursorSteps,
  consumeStickyModifierState,
  nextStickyModifierState,
  type StickyModifierState,
} from "./terminalAndroidControls";
import type { PendingModifier } from "./terminalInput";

const ZOOM_HUD_DISMISS_MS = 900;

export function useStickyTerminalModifier() {
  const [state, setState] = useState<{
    readonly modifier: StickyModifierState | null;
    readonly lastTapMs: number;
  }>({ modifier: null, lastTapMs: 0 });

  const toggle = (modifier: PendingModifier) => {
    setState((current) => {
      const result = nextStickyModifierState({
        current: current.modifier,
        modifier,
        lastTapMs: current.lastTapMs,
      });
      if (result.didLock && Platform.OS === "android") {
        void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Toggle_On).catch(
          () => undefined,
        );
      }
      return { modifier: result.next, lastTapMs: result.tapMs };
    });
  };

  const consume = () => {
    setState((current) => ({
      modifier: consumeStickyModifierState(current.modifier),
      lastTapMs: current.lastTapMs,
    }));
  };

  const clear = () => {
    setState((current) =>
      current.modifier === null ? current : { modifier: null, lastTapMs: current.lastTapMs },
    );
  };

  return {
    modifierState: state.modifier,
    toggle,
    consume,
    clear,
  };
}

export function useTerminalZoomHud(onCommitFontSize: (fontSize: number) => void) {
  const [hud, setHud] = useState<{
    readonly fontSize: number;
    readonly cols: number;
    readonly rows: number;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the HUD auto-dismiss timer when unmounting
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleFontSizeZoom = (event: TerminalFontSizeZoomEvent) => {
    setHud({ fontSize: event.fontSize, cols: event.cols, rows: event.rows });
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHud(null);
    }, ZOOM_HUD_DISMISS_MS);
    if (event.final) {
      onCommitFontSize(event.fontSize);
    }
  };

  return { hud, handleFontSizeZoom };
}

export function TerminalZoomHud(props: {
  readonly hud: { readonly fontSize: number; readonly cols: number; readonly rows: number } | null;
}) {
  const gt = useGT();
  if (!props.hud) return null;
  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeIn.duration(120).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(180).reduceMotion(ReduceMotion.System)}
      className="absolute top-3 self-center rounded-full border border-border bg-card px-3.5 py-1.5"
    >
      <Text className="font-mono text-xs font-t3-semibold tabular-nums text-foreground">
        {gt("{size} sp · {cols}×{rows}", {
          size: Math.round(props.hud.fontSize),
          cols: props.hud.cols,
          rows: props.hud.rows,
        })}
      </Text>
    </Animated.View>
  );
}

export function TerminalTrackpadScrubber(props: {
  readonly onScrubSequence: (sequence: string) => void;
  readonly compact?: boolean;
}) {
  const gt = useGT();
  const [scrubbing, setScrubbing] = useState(false);
  const remainderRef = useRef(0);
  const lastPageXRef = useRef<number | null>(null);

  const handleGrant = (event: GestureResponderEvent) => {
    remainderRef.current = 0;
    lastPageXRef.current = event.nativeEvent.pageX;
    setScrubbing(true);
  };

  const handleMove = (event: GestureResponderEvent) => {
    const pageX = event.nativeEvent.pageX;
    const previous = lastPageXRef.current;
    lastPageXRef.current = pageX;
    if (previous === null) return;
    const { steps, remainder, sequence } = computeTrackpadCursorSteps(
      remainderRef.current + (pageX - previous),
    );
    remainderRef.current = remainder;
    if (steps !== 0 && sequence.length > 0) {
      if (Platform.OS === "android") {
        void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(
          () => undefined,
        );
      }
      props.onScrubSequence(sequence);
    }
  };

  const handleEnd = () => {
    remainderRef.current = 0;
    lastPageXRef.current = null;
    setScrubbing(false);
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={handleGrant}
      onResponderMove={handleMove}
      onResponderRelease={handleEnd}
      onResponderTerminate={handleEnd}
      accessibilityRole="adjustable"
      accessibilityLabel={gt("Cursor trackpad")}
      accessibilityHint={gt("Swipe left or right to move the terminal cursor")}
      className={cn(
        "items-center justify-center rounded-lg border px-2.5",
        props.compact ? "min-h-[36px] min-w-[56px]" : "min-h-[40px] min-w-[62px]",
        scrubbing ? "border-primary bg-primary/20" : "border-border/60 bg-card/40",
      )}
    >
      <Text
        className={cn(
          "font-mono text-xs font-t3-medium",
          scrubbing ? "text-primary" : "text-foreground-muted",
        )}
      >
        {"← · →"}
      </Text>
    </View>
  );
}

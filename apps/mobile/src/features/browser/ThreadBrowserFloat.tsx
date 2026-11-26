import { useIsFocused } from "@react-navigation/native";
import type { EnvironmentId, PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import * as Option from "effect/Option";
import { useGT, useMessages } from "gt-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeOut,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { useAppForeground } from "../../lib/appState";
import { androidTonalSurfaceChrome } from "../../lib/designTokens";
import { triggerSemanticHaptic } from "../../lib/hapticChoreography";
import {
  DEFAULT_DECELERATION_RATE,
  SPRING_DETENT_SNAP,
  SPRING_SPATIAL_SNAPPY,
  projectOffset,
  rubberBandClamp,
  withVelocitySpringConfig,
} from "../../lib/mobileMotion";
import { usePreparedConnection } from "../../state/session";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { browserTabTitle } from "./browserTabs";
import { PreviewStreamWebView } from "./PreviewStreamWebView";

const PIP_SIZE_TIERS = [152, 184, 244] as const;
const PIP_EDGE_MARGIN = 12;
const PIP_EDGE_PEEK_WIDTH = 28;
const PIP_BOTTOM_CLEARANCE = 96;
const PLAYER_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const PLAYER_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

type PipCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type StashedEdge = "left" | "right" | null;

export function ThreadBrowserFloat(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tabs: ReadonlyArray<PreviewSessionSnapshot>;
  readonly loaded: boolean;
  readonly top: number;
  readonly onOpen: (tabId: string) => void;
}) {
  const [tabId, setTabId] = useState<string | null>(null);
  // The reveal requests already seen, so only a tab revealed after the first
  // list pops the player.
  const [seen, setSeen] = useState<{
    readonly tabs: ReadonlyArray<PreviewSessionSnapshot>;
    readonly reveals: ReadonlyMap<string, string | undefined>;
  } | null>(null);
  if (props.loaded && seen?.tabs !== props.tabs) {
    setSeen({
      tabs: props.tabs,
      reveals: new Map(props.tabs.map((tab) => [tab.tabId, tab.revealRequest?.id])),
    });
    const previous = seen?.reveals;
    const opened =
      previous === undefined
        ? undefined
        : props.tabs.findLast(
            (tab) =>
              tab.reveal === true &&
              (tab.revealRequest
                ? previous.get(tab.tabId) !== tab.revealRequest.id
                : !previous.has(tab.tabId)),
          );
    if (opened !== undefined) setTabId(opened.tabId);
  }
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const tab = props.tabs.find((entry) => entry.tabId === tabId) ?? null;
  const onOpen = props.onOpen;
  const open = () => {
    if (tabId === null) return;
    setTabId(null);
    onOpen(tabId);
  };
  const close = () => setTabId(null);
  if (!tab || !focused) return null;
  return (
    <FloatingBrowserPlayer
      environmentId={props.environmentId}
      threadId={props.threadId}
      tab={tab}
      live={foreground}
      top={props.top}
      onOpen={open}
      onClose={close}
    />
  );
}

function FloatingBrowserPlayer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tab: PreviewSessionSnapshot;
  readonly live: boolean;
  readonly top: number;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}) {
  const { themeAppearance, themeVariables } = useAppearancePreferences();
  const isDark = themeAppearance === "dark";
  const gt = useGT();
  const resolveMessage = useMessages();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const prepared = usePreparedConnection(props.environmentId);
  const httpBaseUrl = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [tierIndex, setTierIndex] = useState<0 | 1 | 2>(1);
  const [corner, setCorner] = useState<PipCorner>("top-right");
  const [stashedEdge, setStashedEdge] = useState<StashedEdge>(null);

  const aspect = Math.min(Math.max(viewport ? viewport.width / viewport.height : 16 / 10, 0.5), 2);
  const longSide = Math.min(PIP_SIZE_TIERS[tierIndex], Math.max(140, windowWidth - 48));
  const width = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const height = Math.round(width / aspect);
  const background = themeVariables["--color-sheet-solid"];

  const minX = Math.max(PIP_EDGE_MARGIN, insets.left + PIP_EDGE_MARGIN);
  const maxX = Math.max(
    minX,
    windowWidth - Math.max(PIP_EDGE_MARGIN, insets.right + PIP_EDGE_MARGIN) - width,
  );
  const minY = Math.max(props.top, insets.top + 8);
  const bottomSafe = Math.max(insets.bottom + PIP_BOTTOM_CLEARANCE, keyboardHeight + 24);
  const maxY = Math.max(minY, windowHeight - bottomSafe - height);

  const targetXForState =
    stashedEdge === "left"
      ? -(width - PIP_EDGE_PEEK_WIDTH)
      : stashedEdge === "right"
        ? windowWidth - PIP_EDGE_PEEK_WIDTH
        : corner === "top-left" || corner === "bottom-left"
          ? minX
          : maxX;
  const targetYForState = corner === "bottom-left" || corner === "bottom-right" ? maxY : minY;

  const posX = useSharedValue(targetXForState);
  const posY = useSharedValue(targetYForState);
  const dragStartX = useSharedValue(targetXForState);
  const dragStartY = useSharedValue(targetYForState);
  const pinchScale = useSharedValue(1);
  const activeTierSV = useSharedValue<0 | 1 | 2>(tierIndex);
  const pinchStartTierSV = useSharedValue<0 | 1 | 2>(tierIndex);

  // Clamp and re-dock cleanly when screen geometry changes (e.g., foldable fold/unfold or keyboard).
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles PiP SharedValue position with updated corner, size tier, or viewport bounds
  useEffect(() => {
    activeTierSV.set(tierIndex);
    posX.set(withSpring(targetXForState, SPRING_SPATIAL_SNAPPY));
    posY.set(withSpring(targetYForState, SPRING_SPATIAL_SNAPPY));
  }, [activeTierSV, posX, posY, targetXForState, targetYForState, tierIndex]);

  const commitDock = useCallback(
    (nextCorner: PipCorner, nextStash: StashedEdge) => {
      if (nextStash !== null && nextStash !== stashedEdge) {
        triggerSemanticHaptic("toggleOff");
      } else if (nextStash === null && stashedEdge !== null) {
        triggerSemanticHaptic("toggleOn");
      } else {
        triggerSemanticHaptic("gestureEnd");
      }
      setCorner(nextCorner);
      setStashedEdge(nextStash);
    },
    [stashedEdge],
  );

  const commitTierCrossing = useCallback((nextTier: 0 | 1 | 2) => {
    triggerSemanticHaptic("segmentTick");
    setTierIndex(nextTier);
  }, []);

  const recallFromStash = useCallback(() => {
    triggerSemanticHaptic("toggleOn");
    setStashedEdge(null);
  }, []);

  const panGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory, not a React component.
      Gesture.Pan()
        .minDistance(6)
        .onStart(() => {
          cancelAnimation(posX);
          cancelAnimation(posY);
          dragStartX.set(posX.get());
          dragStartY.set(posY.get());
        })
        .onUpdate((event) => {
          const nextX = dragStartX.get() + event.translationX;
          const nextY = dragStartY.get() + event.translationY;
          posX.set(nextX);
          posY.set(rubberBandClamp(nextY, minY, maxY, Math.max(200, windowHeight * 0.5), 0.22));
        })
        .onEnd((event) => {
          const currentX = posX.get();
          const currentY = posY.get();
          const projectedX = projectOffset(currentX, event.velocityX, DEFAULT_DECELERATION_RATE);
          const projectedY = projectOffset(currentY, event.velocityY, DEFAULT_DECELERATION_RATE);

          const isBottom = projectedY > (minY + maxY) * 0.5;
          const isLeft = projectedX < (minX + maxX) * 0.5;
          const nextCorner: PipCorner = isBottom
            ? isLeft
              ? "bottom-left"
              : "bottom-right"
            : isLeft
              ? "top-left"
              : "top-right";

          const stashLeft = currentX < minX - width * 0.32 || projectedX < -width * 0.45;
          const stashRight =
            currentX > maxX + width * 0.32 || projectedX > windowWidth - width * 0.55;

          const nextStash: StashedEdge = stashLeft ? "left" : stashRight ? "right" : null;
          const destX =
            nextStash === "left"
              ? -(width - PIP_EDGE_PEEK_WIDTH)
              : nextStash === "right"
                ? windowWidth - PIP_EDGE_PEEK_WIDTH
                : isLeft
                  ? minX
                  : maxX;
          const destY = Math.max(minY, Math.min(maxY, isBottom ? maxY : minY));

          posX.set(
            withSpring(destX, withVelocitySpringConfig(SPRING_SPATIAL_SNAPPY, event.velocityX)),
          );
          posY.set(
            withSpring(destY, withVelocitySpringConfig(SPRING_SPATIAL_SNAPPY, event.velocityY)),
          );
          runOnJS(commitDock)(nextCorner, nextStash);
        }),
    [
      commitDock,
      dragStartX,
      dragStartY,
      maxX,
      maxY,
      minX,
      minY,
      posX,
      posY,
      width,
      windowHeight,
      windowWidth,
    ],
  );

  const pinchGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pinch is a gesture factory, not a React component.
      Gesture.Pinch()
        .enabled(stashedEdge === null)
        .onStart(() => {
          pinchStartTierSV.set(activeTierSV.get());
        })
        .onUpdate((event) => {
          const clampedScale = Math.max(0.78, Math.min(1.36, event.scale));
          pinchScale.set(clampedScale);
          const startTier = pinchStartTierSV.get();
          let candidate: 0 | 1 | 2 = startTier;
          if (clampedScale > 1.15 && startTier < 2) {
            candidate = (startTier + 1) as 0 | 1 | 2;
          } else if (clampedScale < 0.86 && startTier > 0) {
            candidate = (startTier - 1) as 0 | 1 | 2;
          }
          if (candidate !== activeTierSV.get()) {
            activeTierSV.set(candidate);
            runOnJS(commitTierCrossing)(candidate);
          }
        })
        .onFinalize(() => {
          pinchScale.set(withSpring(1, SPRING_DETENT_SNAP));
        }),
    [activeTierSV, commitTierCrossing, pinchScale, pinchStartTierSV, stashedEdge],
  );

  const combinedGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Simultaneous is a gesture combiner, not a React component.
      Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.get() },
      { translateY: posY.get() },
      { scale: pinchScale.get() },
    ],
  }));

  const androidChrome = androidTonalSurfaceChrome(isDark, "high");

  return (
    <GestureDetector gesture={combinedGesture}>
      <Animated.View
        entering={PLAYER_ENTERING}
        exiting={PLAYER_EXITING}
        className="absolute left-0 top-0 z-30 overflow-hidden rounded-2xl border border-border"
        style={[
          {
            width,
            height,
            backgroundColor: background,
            ...(Platform.OS === "android"
              ? {
                  borderColor: androidChrome.borderColor,
                  borderTopColor: androidChrome.specularTopBorderColor,
                  boxShadow: [...androidChrome.boxShadow],
                }
              : {
                  shadowColor: "#000000",
                  shadowOpacity: 0.22,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                }),
          },
          containerStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            stashedEdge !== null
              ? gt("Recall browser preview")
              : gt("Open browser, {title}", {
                  title: browserTabTitle(props.tab, resolveMessage),
                })
          }
          accessibilityHint={
            stashedEdge !== null
              ? gt("Slides the floating browser preview back on screen")
              : gt("Opens the browser tab full screen")
          }
          onPress={stashedEdge !== null ? recallFromStash : props.onOpen}
          className="flex-1"
        >
          <View pointerEvents="none" className="flex-1">
            <PreviewStreamWebView
              environmentId={props.environmentId}
              threadId={props.threadId}
              tabId={props.tab.tabId}
              pdfUri={
                props.tab.navStatus._tag === "Success"
                  ? previewPdfAssetUrl(props.tab.navStatus.url, httpBaseUrl)
                  : null
              }
              interactive={false}
              background={background}
              compact
              paused={!props.live}
              onViewport={setViewport}
              onGone={props.onClose}
            />
          </View>
        </Pressable>
        {stashedEdge !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Recall browser preview")}
            onPress={recallFromStash}
            className="absolute inset-y-0 items-center justify-center bg-card-alt/90"
            style={{
              width: PIP_EDGE_PEEK_WIDTH,
              ...(stashedEdge === "left" ? { right: 0 } : { left: 0 }),
            }}
          >
            <SymbolView
              name={stashedEdge === "left" ? "chevron.right" : "chevron.left"}
              size={14}
              tintColorClassName="accent-foreground"
              type="monochrome"
            />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Close floating preview")}
            hitSlop={8}
            onPress={() => {
              triggerSemanticHaptic("contextClick");
              props.onClose();
            }}
            className="absolute right-1.5 top-1.5 size-6 items-center justify-center rounded-full bg-black/55"
          >
            <SymbolView name="xmark" size={11} tintColor="#ffffff" type="monochrome" />
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

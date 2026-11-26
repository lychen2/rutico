import { useAtomValue } from "@effect/atom-react";
import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { PaneContext } from "../../components/ui/Pane";
import { RuticoMobileBackdrop } from "../../components/RuticoMobileBackdrop";
import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { themeColorWithAlpha } from "../../lib/mobileTheme";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  AdaptiveWorkspaceContext,
  WorkspacePaneStateContext,
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "./adaptive-workspace-context";
import { AndroidPaseoPanelsContext } from "./android-paseo-panels-context";
import type { AndroidPaseoPanelsProps } from "./AndroidPaseoPanels";
import { InspectorPanes } from "./inspector-host";
import { InspectorPaneVisibleContext } from "./inspector-panes";
import { InspectorSheetContext } from "./workspace-inspector-sheet";
import type { WorkspaceDetail, WorkspaceDetailSheet } from "./workspace/workspace-detail-selection";
import { WorkspaceThreadSidebar } from "./workspace/WorkspaceThreadSidebar";

const SPRING_CONFIG = {
  damping: 24,
  stiffness: 260,
  mass: 0.85,
  reduceMotion: ReduceMotion.System,
} as const;

const TAB_INDICATOR_SPRING = {
  damping: 22,
  stiffness: 310,
  mass: 0.7,
  reduceMotion: ReduceMotion.System,
} as const;

function PulsingStatusDot(props: {
  readonly tone: "warning" | "primary";
  readonly active: boolean;
}) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const shouldPulse = props.active && appActive && !reducedMotion;
  const pulse = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives continuous Reanimated breathing halo on active agent status pills when visible and foregrounded
  useEffect(() => {
    if (!shouldPulse) {
      cancelAnimation(pulse);
      pulse.set(0);
      return;
    }
    pulse.set(
      withRepeat(
        withTiming(1, {
          duration: 1800,
          easing: Easing.out(Easing.quad),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse, shouldPulse]);

  const haloStyle = useAnimatedStyle(() => {
    const value = pulse.get();
    return {
      opacity: shouldPulse ? interpolate(value, [0, 1], [0.6, 0], Extrapolation.CLAMP) : 0,
      transform: [
        { scale: shouldPulse ? interpolate(value, [0, 1], [1, 2.3], Extrapolation.CLAMP) : 1 },
      ],
    };
  });

  return (
    <View className="relative size-2 items-center justify-center">
      <Animated.View
        pointerEvents="none"
        className={cn(
          "absolute inset-0 rounded-full",
          props.tone === "warning" ? "bg-warning-foreground" : "bg-primary",
        )}
        style={haloStyle}
      />
      <View
        className={cn(
          "size-1.5 rounded-full",
          props.tone === "warning" ? "bg-warning-foreground" : "bg-primary",
        )}
      />
    </View>
  );
}

type InspectorContentValue = NonNullable<AndroidPaseoPanelsProps["inspectorContent"]>;

function WorkbenchTabsBar(props: {
  readonly panes: InspectorContentValue["panes"];
  readonly activeKey: InspectorContentValue["active"] | undefined;
  readonly onSelectPane: InspectorContentValue["onSelectPane"];
}) {
  const gt = useGT();
  const [layouts, setLayouts] = useState<
    Record<string, { readonly x: number; readonly width: number }>
  >({});
  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  const activeRect = props.activeKey !== undefined ? layouts[props.activeKey] : undefined;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives Reanimated spring capsule indicator when selected workbench tab changes
  useEffect(() => {
    if (!activeRect) return;
    if (indicatorW.get() === 0) {
      indicatorX.set(activeRect.x);
      indicatorW.set(activeRect.width);
      indicatorOpacity.set(1);
      return;
    }
    indicatorX.set(withSpring(activeRect.x, TAB_INDICATOR_SPRING));
    indicatorW.set(withSpring(activeRect.width, TAB_INDICATOR_SPRING));
    indicatorOpacity.set(1);
  }, [activeRect, indicatorOpacity, indicatorW, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.get(),
    transform: [{ translateX: indicatorX.get() }],
    width: indicatorW.get(),
  }));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
      <View className="relative flex-row items-center gap-1.5">
        <Animated.View
          pointerEvents="none"
          className="absolute bottom-0 top-0 rounded-full border border-primary/55 bg-primary/20"
          style={indicatorStyle}
        />
        {props.panes.map((pane) => {
          const selected = pane.key === props.activeKey;
          const label =
            pane.label ??
            (pane.key === "git"
              ? gt("Changes")
              : pane.key === "files"
                ? gt("Files")
                : pane.key === "terminal"
                  ? gt("Terminal")
                  : pane.key === "preview"
                    ? gt("Preview")
                    : gt("Inspector"));
          return (
            <Pressable
              key={pane.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={6}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout;
                setLayouts((previous) =>
                  previous[pane.key]?.x === x && previous[pane.key]?.width === width
                    ? previous
                    : { ...previous, [pane.key]: { x, width } },
                );
              }}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => undefined);
                props.onSelectPane?.(pane.key);
              }}
              className={cn(
                "min-h-[36px] justify-center rounded-full border px-3 py-1.5 active:opacity-70",
                selected ? "border-transparent bg-transparent" : "border-border/70 bg-card/65",
              )}
            >
              <Text
                numberOfLines={1}
                className={cn(
                  "text-xs font-t3-medium",
                  selected ? "text-foreground" : "text-foreground-muted",
                )}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function AndroidPaseoPanels(props: AndroidPaseoPanelsProps) {
  const {
    enabled,
    viewportWidth,
    inspectorContent,
    inspectorOpen,
    onCloseInspector,
    onStartNewTask,
    children,
  } = props;
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { themeAppearance, themeVariables } = useAppearancePreferences();
  const isDark = themeAppearance === "dark";
  const outerLayoutValue = useAdaptiveWorkspaceLayout();
  const outerPaneState = useWorkspacePaneState();
  const threadShells = useAtomValue(steadyNavigationThreadShellsAtom);

  const [activePanel, setActivePanel] = useState<-1 | 0 | 1>(0);
  const [prevInspectorOpen, setPrevInspectorOpen] = useState(inspectorOpen);
  const afterWorkbenchCloseRef = useRef<(() => void) | null>(null);

  const drawerWidth = Math.max(260, Math.min(Math.round(viewportWidth * 0.86), 360));
  const workbenchWidth = Math.max(280, Math.min(Math.round(viewportWidth * 0.92), 420));
  const hasWorkbench = Boolean(inspectorContent && inspectorContent.panes.length > 0);

  if (!enabled && activePanel !== 0) {
    setActivePanel(0);
  }
  if (prevInspectorOpen !== inspectorOpen) {
    setPrevInspectorOpen(inspectorOpen);
    if (enabled) {
      if (inspectorOpen && hasWorkbench) {
        setActivePanel(1);
      } else if (!inspectorOpen && activePanel === 1) {
        setActivePanel(0);
      }
    }
  }

  const targetOffset =
    !enabled || activePanel === 0
      ? 0
      : activePanel === -1
        ? drawerWidth
        : hasWorkbench
          ? -workbenchWidth
          : 0;

  const panelOffset = useSharedValue(0);
  const gestureStartOffset = useSharedValue(0);

  const flushAfterWorkbenchClose = useCallback(() => {
    const pending = afterWorkbenchCloseRef.current;
    afterWorkbenchCloseRef.current = null;
    pending?.();
  }, []);

  const closePanels = useCallback(
    (then?: () => void) => {
      Keyboard.dismiss();
      if (then) {
        afterWorkbenchCloseRef.current = then;
      }
      setActivePanel(0);
      if (inspectorOpen) {
        onCloseInspector();
      } else if (then) {
        flushAfterWorkbenchClose();
      }
    },
    [flushAfterWorkbenchClose, inspectorOpen, onCloseInspector],
  );

  const openLeftDrawer = useCallback(() => {
    if (!enabled) return;
    Keyboard.dismiss();
    if (inspectorOpen) {
      onCloseInspector();
    }
    setActivePanel(-1);
  }, [enabled, inspectorOpen, onCloseInspector]);

  const openRightWorkbench = useCallback(() => {
    if (!enabled || !hasWorkbench) return;
    Keyboard.dismiss();
    setActivePanel(1);
  }, [enabled, hasWorkbench]);

  const commitPanel = useCallback(
    (panel: -1 | 0 | 1, changed: boolean) => {
      if (changed) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
      Keyboard.dismiss();
      if (panel === 0) {
        setActivePanel(0);
        if (inspectorOpen) {
          onCloseInspector();
        }
        return;
      }
      if (panel === -1 && inspectorOpen) {
        onCloseInspector();
      }
      setActivePanel(panel);
    },
    [inspectorOpen, onCloseInspector],
  );

  const handleBackPress = useEffectEvent(() => {
    if (!enabled || activePanel === 0) return false;
    closePanels();
    return true;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives Reanimated shared spring offset when active Paseo panel changes
  useEffect(() => {
    panelOffset.set(
      withSpring(targetOffset, SPRING_CONFIG, (finished) => {
        if (finished && targetOffset === 0) {
          runOnJS(flushAfterWorkbenchClose)();
        }
      }),
    );
  }, [flushAfterWorkbenchClose, panelOffset, targetOffset]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to Android hardware back button while a Paseo side panel is open
  useEffect(() => {
    if (!enabled || activePanel === 0) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => handleBackPress());
    return () => subscription.remove();
  }, [activePanel, enabled]);

  const panGesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a gesture factory, not a React component.
      Gesture.Pan()
        .enabled(enabled && viewportWidth > 0)
        .activeOffsetX([-24, 24])
        .failOffsetY([-14, 14])
        .onStart(() => {
          gestureStartOffset.set(panelOffset.get());
        })
        .onUpdate((event) => {
          const minOffset = hasWorkbench ? -workbenchWidth : 0;
          const next = gestureStartOffset.get() + event.translationX;
          panelOffset.set(Math.max(minOffset, Math.min(drawerWidth, next)));
        })
        .onEnd((event) => {
          const minOffset = hasWorkbench ? -workbenchWidth : 0;
          const next = Math.max(
            minOffset,
            Math.min(drawerWidth, gestureStartOffset.get() + event.translationX),
          );
          let nextPanel: -1 | 0 | 1 = 0;
          if (activePanel === 0) {
            if (next > drawerWidth * 0.28 || event.velocityX > 450) {
              nextPanel = -1;
            } else if (hasWorkbench && (next < -workbenchWidth * 0.28 || event.velocityX < -450)) {
              nextPanel = 1;
            }
          } else if (activePanel === -1) {
            nextPanel = next < drawerWidth * 0.72 || event.velocityX < -380 ? 0 : -1;
          } else if (activePanel === 1) {
            nextPanel = next > -workbenchWidth * 0.72 || event.velocityX > 380 ? 0 : 1;
          }
          const destination =
            nextPanel === -1 ? drawerWidth : nextPanel === 1 && hasWorkbench ? -workbenchWidth : 0;
          panelOffset.set(withSpring(destination, SPRING_CONFIG));
          runOnJS(commitPanel)(nextPanel, nextPanel !== activePanel);
        }),
    [
      activePanel,
      commitPanel,
      drawerWidth,
      enabled,
      gestureStartOffset,
      hasWorkbench,
      panelOffset,
      viewportWidth,
      workbenchWidth,
    ],
  );

  const centerStyle = useAnimatedStyle(() => {
    const offset = panelOffset.get();
    const leftProgress = drawerWidth > 0 ? Math.max(0, Math.min(1, offset / drawerWidth)) : 0;
    const rightProgress =
      workbenchWidth > 0 ? Math.max(0, Math.min(1, -offset / workbenchWidth)) : 0;
    const progress = Math.max(leftProgress, rightProgress);
    const translateX = offset >= 0 ? offset : offset * 0.36;
    return {
      borderRadius: interpolate(progress, [0, 0.12, 1], [0, 20, 28], Extrapolation.CLAMP),
      overflow: "hidden" as const,
      transform: [
        { translateX },
        { scale: interpolate(progress, [0, 1], [1, 0.935], Extrapolation.CLAMP) },
      ],
    };
  });

  const leftDrawerStyle = useAnimatedStyle(() => {
    const offset = panelOffset.get();
    const leftProgress = drawerWidth > 0 ? Math.max(0, Math.min(1, offset / drawerWidth)) : 0;
    return {
      opacity: interpolate(leftProgress, [0, 0.2, 1], [0.5, 0.85, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateX: interpolate(
            leftProgress,
            [0, 1],
            [-drawerWidth * 0.32, 0],
            Extrapolation.CLAMP,
          ),
        },
        { scale: interpolate(leftProgress, [0, 1], [0.95, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  const rightWorkbenchStyle = useAnimatedStyle(() => {
    const offset = panelOffset.get();
    const rightProgress =
      workbenchWidth > 0 ? Math.max(0, Math.min(1, -offset / workbenchWidth)) : 0;
    return {
      transform: [
        { translateX: workbenchWidth + offset },
        { scale: interpolate(rightProgress, [0, 1], [0.97, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  const scrimStyle = useAnimatedStyle(() => {
    const offset = panelOffset.get();
    const leftProgress = drawerWidth > 0 ? Math.max(0, Math.min(1, offset / drawerWidth)) : 0;
    const rightProgress =
      workbenchWidth > 0 ? Math.max(0, Math.min(1, -offset / workbenchWidth)) : 0;
    const progress = Math.max(leftProgress, rightProgress);
    return {
      opacity: progress * 0.44,
    };
  });

  const activeThreads = useMemo(
    () =>
      threadShells.filter(
        (thread) =>
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput ||
          thread.pendingSubagentRequest === "approval" ||
          thread.pendingSubagentRequest === "user_input" ||
          (thread.runtime !== null &&
            ["preparing", "queued", "starting", "running", "waiting"].includes(
              thread.runtime.status,
            )),
      ),
    [threadShells],
  );

  const drawerLayoutValue = useMemo(
    () => ({
      ...outerLayoutValue,
      layout: {
        ...outerLayoutValue.layout,
        listPaneWidth: drawerWidth,
      },
      selectDetail: (detail: WorkspaceDetail, sheet?: WorkspaceDetailSheet) => {
        closePanels();
        outerLayoutValue.selectDetail?.(detail, sheet);
      },
      openWorkspaceTab: (
        tab: Parameters<typeof outerLayoutValue.openWorkspaceTab>[0],
        options?: Parameters<typeof outerLayoutValue.openWorkspaceTab>[1],
      ) => {
        closePanels();
        outerLayoutValue.openWorkspaceTab(tab, options);
      },
      startNewTask: () => {
        closePanels();
        onStartNewTask();
      },
    }),
    [closePanels, drawerWidth, onStartNewTask, outerLayoutValue],
  );

  const drawerPaneState = useMemo(
    () => ({
      ...outerPaneState,
      panes: {
        ...outerPaneState.panes,
        primarySidebarVisible: enabled && activePanel === -1,
      },
    }),
    [activePanel, enabled, outerPaneState],
  );

  const contextValue = useMemo(
    () =>
      enabled
        ? {
            activePanel,
            openLeftDrawer,
            openRightWorkbench,
            closePanels: () => closePanels(),
          }
        : null,
    [activePanel, closePanels, enabled, openLeftDrawer, openRightWorkbench],
  );

  if (!enabled) {
    return <AndroidPaseoPanelsContext value={null}>{children}</AndroidPaseoPanelsContext>;
  }

  return (
    <AndroidPaseoPanelsContext value={contextValue}>
      <GestureDetector gesture={panGesture}>
        <View className="flex-1 overflow-hidden bg-header">
          <Animated.View
            style={[
              {
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: drawerWidth,
                backgroundColor: themeVariables["--color-drawer"],
                borderRightWidth: 1,
                borderRightColor: themeColorWithAlpha(themeVariables["--color-border"], 0.6),
                overflow: "hidden",
              },
              leftDrawerStyle,
            ]}
            pointerEvents={activePanel === -1 ? "auto" : "none"}
            accessibilityElementsHidden={activePanel !== -1}
            importantForAccessibility={activePanel === -1 ? "auto" : "no-hide-descendants"}
          >
            <RuticoMobileBackdrop variant="drawer" active={activePanel === -1} />
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: themeColorWithAlpha(
                    themeVariables["--color-drawer"],
                    isDark ? 0.46 : 0.42,
                  ),
                },
              ]}
            />
            <View
              style={{
                paddingTop: insets.top,
                backgroundColor: themeColorWithAlpha(
                  themeVariables["--color-drawer"],
                  isDark ? 0.56 : 0.62,
                ),
                borderBottomColor: themeColorWithAlpha(themeVariables["--color-border"], 0.55),
              }}
              className="overflow-hidden border-b px-3 pb-2.5"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-t3-bold tracking-[0.6px] uppercase text-foreground-muted">
                  {gt("Active / Needs You")}
                </Text>
                <IconButton
                  accessibilityLabel={gt("New agent")}
                  icon="plus"
                  onPress={() => {
                    closePanels();
                    onStartNewTask();
                  }}
                />
              </View>
              {activeThreads.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="flex-row items-center gap-1.5 pt-1"
                >
                  {activeThreads.slice(0, 8).map((thread) => {
                    const needsAttention =
                      thread.hasPendingApprovals ||
                      thread.hasPendingUserInput ||
                      thread.pendingSubagentRequest === "approval" ||
                      thread.pendingSubagentRequest === "user_input";
                    return (
                      <Pressable
                        key={scopedThreadKey(thread.environmentId, thread.id)}
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={() => {
                          void Haptics.selectionAsync().catch(() => undefined);
                          closePanels();
                          outerLayoutValue.selectDetail?.({
                            name: "Thread",
                            params: {
                              environmentId: String(thread.environmentId),
                              threadId: String(thread.id),
                            },
                          });
                        }}
                        className={cn(
                          "min-h-[36px] max-w-[160px] flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-70",
                          needsAttention
                            ? "border-primary/70 bg-primary/20"
                            : "border-border/75 bg-card/75",
                        )}
                      >
                        <PulsingStatusDot
                          tone={needsAttention ? "warning" : "primary"}
                          active={activePanel === -1}
                        />
                        <Text numberOfLines={1} className="text-xs font-t3-medium text-foreground">
                          {thread.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text className="pt-0.5 text-xs text-foreground-muted">
                  {gt("All agents settled")}
                </Text>
              )}
            </View>
            <View className="flex-1">
              <AdaptiveWorkspaceContext value={drawerLayoutValue}>
                <WorkspacePaneStateContext value={drawerPaneState}>
                  <PaneContext value="sidebar">
                    <WorkspaceThreadSidebar />
                  </PaneContext>
                </WorkspacePaneStateContext>
              </AdaptiveWorkspaceContext>
            </View>
          </Animated.View>

          <Animated.View style={[{ flex: 1 }, centerStyle]}>
            {children}
            <Animated.View
              className="absolute inset-0"
              pointerEvents={activePanel !== 0 ? "auto" : "none"}
              style={[{ backgroundColor: "rgba(14, 10, 24, 1)" }, scrimStyle]}
            >
              <Pressable
                accessibilityLabel={gt("Return to chat")}
                className="flex-1"
                onPress={() => closePanels()}
              />
            </Animated.View>
          </Animated.View>

          {hasWorkbench ? (
            <Animated.View
              style={[
                {
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: workbenchWidth,
                  backgroundColor: themeVariables["--color-screen"],
                  borderTopLeftRadius: 24,
                  borderBottomLeftRadius: 24,
                  overflow: "hidden",
                  borderLeftWidth: 1,
                  borderLeftColor: themeColorWithAlpha(themeVariables["--color-border"], 0.6),
                },
                rightWorkbenchStyle,
              ]}
              pointerEvents={activePanel === 1 ? "auto" : "none"}
              accessibilityElementsHidden={activePanel !== 1}
              importantForAccessibility={activePanel === 1 ? "auto" : "no-hide-descendants"}
            >
              <RuticoMobileBackdrop variant="canvas" active={activePanel === 1} />
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: themeColorWithAlpha(
                      themeVariables["--color-screen"],
                      isDark ? 0.58 : 0.62,
                    ),
                  },
                ]}
              />
              <View
                style={{
                  paddingTop: insets.top,
                  backgroundColor: themeColorWithAlpha(
                    themeVariables["--color-header"],
                    isDark ? 0.68 : 0.72,
                  ),
                  borderBottomColor: themeColorWithAlpha(themeVariables["--color-border"], 0.55),
                }}
                className="flex-row items-center gap-2 border-b px-2.5 pb-2"
              >
                <WorkbenchTabsBar
                  panes={inspectorContent?.panes ?? []}
                  activeKey={inspectorContent?.active}
                  onSelectPane={inspectorContent?.onSelectPane}
                />
                <IconButton
                  accessibilityLabel={gt("Close workbench")}
                  icon="xmark"
                  onPress={() => closePanels()}
                />
              </View>
              <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
                <InspectorPaneVisibleContext value={activePanel === 1}>
                  <InspectorSheetContext value={(then) => closePanels(then)}>
                    <PaneContext value="inspector">
                      <InspectorPanes content={inspectorContent} onClose={() => closePanels()} />
                    </PaneContext>
                  </InspectorSheetContext>
                </InspectorPaneVisibleContext>
              </View>
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>
    </AndroidPaseoPanelsContext>
  );
}

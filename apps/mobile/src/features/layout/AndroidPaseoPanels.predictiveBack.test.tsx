import { act, use, type ContextType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { RawPredictiveBackPayload } from "../../native/androidPredictiveBackArbiter";
import type { InspectorContent } from "./inspector-panes";

const mocks = vi.hoisted(() => ({
  panelBackOwnerCounts: [] as number[],
  nativeBackListeners: new Set<(payload: RawPredictiveBackPayload) => void>(),
  backHandlerAddListener: vi.fn(() => ({ remove: vi.fn() })),
  sharedValues: [] as Array<{ value: unknown; get: () => unknown }>,
  triggerSemanticHaptic: vi.fn(),
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) =>
    name === "T3WorkspaceNavigation"
      ? {
          setModalBackOwnerCount: vi.fn(),
          setPanelBackOwnerCount: (count: number) => {
            mocks.panelBackOwnerCounts.push(count);
          },
          addListener: (
            eventName: string,
            listener: (payload: RawPredictiveBackPayload) => void,
          ) => {
            if (eventName === "onPredictiveBack") {
              mocks.nativeBackListeners.add(listener);
            }
            return {
              remove: () => {
                mocks.nativeBackListeners.delete(listener);
              },
            };
          },
        }
      : null,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Animated: { View: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
  BackHandler: { addEventListener: mocks.backHandlerAddListener },
  DeviceEventEmitter: {
    addListener: () => ({ remove: () => {} }),
  },
  Keyboard: { dismiss: () => {} },
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: { absoluteFill: {} },
  useAnimatedValue: () => ({ interpolate: () => 0 }),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => {
      const builder = {
        enabled: () => builder,
        activeOffsetX: () => builder,
        failOffsetY: () => builder,
        onStart: () => builder,
        onUpdate: () => builder,
        onEnd: () => builder,
      };
      return builder;
    },
  },
  GestureDetector: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: {
      View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    },
    Extrapolation: { CLAMP: "clamp" },
    ReduceMotion: { System: "system" },
    cancelAnimation: () => {},
    interpolate: (v: number) => v,
    runOnJS:
      <Args extends ReadonlyArray<unknown>, R>(fn: (...args: Args) => R) =>
      (...args: Args) =>
        fn(...args),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: <T,>(initial: T) => {
      const ref = useRef<{ value: T; get: () => T; set: (next: T) => void } | null>(null);
      if (ref.current === null) {
        const sv = {
          value: initial,
          get: () => sv.value,
          set: (next: T) => {
            sv.value = next;
          },
        };
        ref.current = sv;
        mocks.sharedValues.push(sv);
      }
      return ref.current;
    },
    withSpring: <T,>(toValue: T, _config?: unknown, callback?: (finished?: boolean) => void) => {
      callback?.(true);
      return toValue;
    },
    withTiming: <T,>(toValue: T) => toValue,
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [],
}));

vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
}));

vi.mock("gt-react-native", () => ({
  useGT: () => (text: string) => text,
}));

vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/IconButton", () => ({ IconButton: () => null }));
vi.mock("../../components/ui/Pane", () => ({
  PaneContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/RuticoMobileBackdrop", () => ({
  RuticoMobileBackdrop: () => null,
}));
vi.mock("../../lib/appState", () => ({ useAppActive: () => true }));
vi.mock("../../lib/hapticChoreography", () => ({
  triggerSemanticHaptic: (...args: ReadonlyArray<unknown>) => mocks.triggerSemanticHaptic(...args),
}));
vi.mock("../../lib/mobileTheme", () => ({ themeColorWithAlpha: (c: string) => c }));
vi.mock("../../state/threads", () => ({ steadyNavigationThreadShellsAtom: { _tag: "threads" } }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({
    themeAppearance: "dark",
    themeVariables: {
      "--color-drawer": "#111",
      "--color-border": "#222",
      "--color-screen": "#000",
      "--color-header": "#111",
    },
  }),
}));
vi.mock("./workspace-inspector-sheet", async () => {
  const { createContext } = await import("react");
  return {
    InspectorSheetContext: createContext<((then?: () => void) => void) | null>(null),
  };
});
vi.mock("./inspector-host", () => ({ InspectorPanes: () => <div data-testid="workbench" /> }));
vi.mock("./workspace/WorkspaceThreadSidebar", () => ({
  WorkspaceThreadSidebar: () => <div data-testid="drawer-sidebar" />,
}));

import { AndroidPaseoPanels } from "./AndroidPaseoPanels.android";
import { AndroidPaseoPanelsContext } from "./android-paseo-panels-context";

function emitNativeBack(payload: RawPredictiveBackPayload) {
  for (const listener of mocks.nativeBackListeners) {
    listener(payload);
  }
}

const INSPECTOR_CONTENT: InspectorContent = {
  active: "git",
  panes: [{ key: "git", label: "Changes", render: () => <div>Changes</div> }],
};

const roots: Root[] = [];

function mountPanels(initial: {
  readonly inspectorOpen: boolean;
  readonly onCloseInspector: () => void;
}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let paseoContext: ContextType<typeof AndroidPaseoPanelsContext> = null;

  function ChildProbe() {
    paseoContext = use(AndroidPaseoPanelsContext);
    return <div data-testid="chat-center" />;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  const renderWith = (inspectorOpen: boolean) => {
    act(() => {
      root.render(
        <AndroidPaseoPanels
          enabled
          viewportWidth={400}
          inspectorContent={INSPECTOR_CONTENT}
          inspectorOpen={inspectorOpen}
          onCloseInspector={initial.onCloseInspector}
          onStartNewTask={() => {}}
        >
          <ChildProbe />
        </AndroidPaseoPanels>,
      );
    });
  };

  renderWith(initial.inspectorOpen);

  // AndroidPaseoPanels creates shared values: panelOffset (0), predictiveBackProgress (1), ...
  const predictiveBackProgress = mocks.sharedValues[1] as {
    value: number;
    get: () => number;
    set: (v: number) => void;
  };

  return {
    renderWith,
    get context() {
      return paseoContext!;
    },
    predictiveBackProgress,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  mocks.panelBackOwnerCounts.length = 0;
  mocks.nativeBackListeners.clear();
  mocks.backHandlerAddListener.mockClear();
  mocks.sharedValues.length = 0;
  mocks.triggerSemanticHaptic.mockReset();
});

describe("AndroidPaseoPanels (C111 Predictive Back verification)", () => {
  it("left drawer: half-swipe cancel returns cleanly (0 closes) and full commit closes exactly once", () => {
    const onCloseInspector = vi.fn();
    const panels = mountPanels({ inspectorOpen: false, onCloseInspector });

    expect(panels.context.activePanel).toBe(0);

    // Open left drawer (-1) -> registers panel owner with native bridge (count 1).
    act(() => {
      panels.context.openLeftDrawer();
    });
    expect(panels.context.activePanel).toBe(-1);
    expect(mocks.panelBackOwnerCounts.at(-1)).toBe(1);
    // Native C111 bridge is available, so fallback BackHandler must not double-register.
    expect(mocks.backHandlerAddListener).not.toHaveBeenCalled();

    // Half-swipe back and cancel -> retracts to 0.45, springs back to 0, drawer stays open.
    act(() => {
      emitNativeBack({ phase: "start", progress: 0.05, swipeEdge: 0, source: "native-panel" });
      emitNativeBack({ phase: "progress", progress: 0.45, swipeEdge: 0, source: "native-panel" });
    });
    expect(panels.predictiveBackProgress.get()).toBeCloseTo(0.45);
    expect(panels.context.activePanel).toBe(-1);

    act(() => {
      emitNativeBack({ phase: "cancel", swipeEdge: 0, source: "native-panel" });
    });
    expect(panels.predictiveBackProgress.get()).toBe(0);
    expect(panels.context.activePanel).toBe(-1);
    expect(onCloseInspector).toHaveBeenCalledTimes(0);
    expect(mocks.panelBackOwnerCounts.at(-1)).toBe(1);

    // Full predictive-back commit -> closes left drawer exactly once and unregisters owner.
    act(() => {
      emitNativeBack({ phase: "start", progress: 0.05, swipeEdge: 0, source: "native-panel" });
      emitNativeBack({ phase: "progress", progress: 0.72, swipeEdge: 0, source: "native-panel" });
      emitNativeBack({ phase: "commit", swipeEdge: 0, source: "native-panel" });
    });
    expect(panels.context.activePanel).toBe(0);
    expect(panels.predictiveBackProgress.get()).toBe(0);
    expect(mocks.panelBackOwnerCounts.at(-1)).toBe(0);

    // Subsequent stray commit after close has no panel owner and causes 0 extra closes.
    act(() => {
      emitNativeBack({ phase: "commit", swipeEdge: 0, source: "native-panel" });
    });
    expect(panels.context.activePanel).toBe(0);
    expect(onCloseInspector).toHaveBeenCalledTimes(0);
  });

  it("right workbench: half-swipe cancel returns cleanly (0 closes) and full commit closes inspector exactly once", () => {
    const onCloseInspector = vi.fn();
    const panels = mountPanels({ inspectorOpen: false, onCloseInspector });

    // Open right workbench (+1) via inspectorOpen transition.
    panels.renderWith(true);
    expect(panels.context.activePanel).toBe(1);
    expect(mocks.panelBackOwnerCounts.at(-1)).toBe(1);
    expect(mocks.backHandlerAddListener).not.toHaveBeenCalled();

    // Half-swipe back and cancel -> retracts to 0.5, returns cleanly to 0, 0 closes.
    act(() => {
      emitNativeBack({ phase: "start", progress: 0.08, swipeEdge: 1, source: "native-panel" });
      emitNativeBack({ phase: "progress", progress: 0.5, swipeEdge: 1, source: "native-panel" });
    });
    expect(panels.predictiveBackProgress.get()).toBeCloseTo(0.5);
    expect(panels.context.activePanel).toBe(1);

    act(() => {
      emitNativeBack({ phase: "cancel", swipeEdge: 1, source: "native-panel" });
    });
    expect(panels.predictiveBackProgress.get()).toBe(0);
    expect(panels.context.activePanel).toBe(1);
    expect(onCloseInspector).toHaveBeenCalledTimes(0);
    expect(mocks.panelBackOwnerCounts.at(-1)).toBe(1);

    // Full predictive-back commit -> calls onCloseInspector exactly once and closes panel.
    act(() => {
      emitNativeBack({ phase: "start", progress: 0.08, swipeEdge: 1, source: "native-panel" });
      emitNativeBack({ phase: "progress", progress: 0.8, swipeEdge: 1, source: "native-panel" });
      emitNativeBack({ phase: "commit", swipeEdge: 1, source: "native-panel" });
    });
    expect(onCloseInspector).toHaveBeenCalledTimes(1);
    expect(panels.context.activePanel).toBe(0);
    expect(panels.predictiveBackProgress.get()).toBe(0);
    expect(mocks.panelBackOwnerCounts.at(-1)).toBe(0);

    // Sync inspectorOpen=false from parent and verify stray commit does NOT fire a second close.
    panels.renderWith(false);
    act(() => {
      emitNativeBack({ phase: "commit", swipeEdge: 1, source: "native-panel" });
    });
    expect(onCloseInspector).toHaveBeenCalledTimes(1);
  });
});

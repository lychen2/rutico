import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

interface CapturedPanConfig {
  readonly enabled?: boolean;
  readonly onBegin?: (event: { translationY: number }) => void;
  readonly onUpdate?: (event: { translationY: number }) => void;
  readonly onDeactivate?: (event: { canceled: boolean; translationY?: number }) => void;
  readonly onFinalize?: (event: { canceled?: boolean }) => void;
}

const mocks = vi.hoisted(() => ({
  panConfig: null as CapturedPanConfig | null,
  onScroll: null as ((event: { nativeEvent: { contentOffset: { y: number } } }) => void) | null,
  pullDistanceSharedValue: null as {
    value: number;
    get: () => number;
    set: (v: number) => void;
  } | null,
  triggerSemanticHaptic: vi.fn(),
  sharedValues: [] as Array<{ value: unknown; get: () => unknown }>,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android", Version: 35 },
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useWindowDimensions: () => ({ width: 412, height: 915 }),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useNativeGesture: () => ({ _tag: "native" }),
  usePanGesture: (config: CapturedPanConfig) => {
    mocks.panConfig = config;
    return { _tag: "pan", config };
  },
  useSimultaneousGestures: (...gestures: ReadonlyArray<unknown>) => ({
    _tag: "simultaneous",
    gestures,
  }),
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    createAnimatedComponent: (Comp: unknown) => Comp,
  },
  Extrapolation: { CLAMP: "clamp" },
  interpolate: (v: number) => v,
  runOnJS:
    <Args extends ReadonlyArray<unknown>, R>(fn: (...args: Args) => R) =>
    (...args: Args) =>
      fn(...args),
  useAnimatedProps: () => ({}),
  useAnimatedStyle: () => ({}),
  useSharedValue: <T,>(initial: T) => {
    const sv = {
      value: initial,
      get: () => sv.value,
      set: (next: T) => {
        sv.value = next;
      },
    };
    mocks.sharedValues.push(sv);
    return sv;
  },
  withSpring: <T,>(toValue: T) => toValue,
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("react-native-svg", () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
}));

vi.mock("@legendapp/list/reanimated", () => ({
  AnimatedLegendList: (props: {
    readonly onScroll?: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
    readonly data: ReadonlyArray<unknown>;
  }) => {
    mocks.onScroll = props.onScroll ?? null;
    return <div data-testid="home-thread-list" data-count={props.data.length} />;
  },
}));

vi.mock("gt-react-native", () => ({
  useGT: () => (text: string) => text,
  useMessages: () => (message: unknown) =>
    typeof message === "string" ? message : String(message),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    providersByEnvironmentId: new Map(),
    machineByEnvironmentId: new Map(),
    settlementEnvironmentIds: new Set(),
    snoozeEnvironmentIds: new Set(),
    snoozePresetsByEnvironmentId: new Map(),
    pinningEnvironmentIds: new Set(),
    autoSettleOptOutEnvironmentIds: new Set(),
    pinReorderEnvironmentIds: new Set(),
    activeReorderEnvironmentIds: new Set(),
    titleRegenerationEnvironmentIds: new Set(),
  }),
}));

vi.mock("../../components/ui/useBarInset", () => ({ useContentTopInset: () => 0 }));
vi.mock("../../components/ui/Pane", () => ({ usePaneRole: () => "screen" }));
vi.mock("../../components/ui/ScreenContent", () => ({
  ScreenContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../state/active-new-task", () => ({ useActiveNewTask: () => null }));
vi.mock("../../components/ui/AppActivityIndicator", () => ({ AppActivityIndicator: () => null }));
vi.mock("../../components/ui/useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ fabClearance: 72 }),
}));
vi.mock("../threads/threadListAnimations", () => ({ THREAD_LIST_ROW_LAYOUT: {} }));
vi.mock("../../native/NativeScrollViewMarker", () => ({
  NativeScrollViewMarker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../lib/hapticChoreography", () => ({
  triggerSemanticHaptic: (...args: ReadonlyArray<unknown>) => mocks.triggerSemanticHaptic(...args),
}));
vi.mock("../../lib/mobileMotion", () => ({
  SPRING_SPATIAL_SNAPPY: {},
  rubberBandClamp: (
    value: number,
    min: number,
    max: number,
    dimension: number,
    coefficient = 0.55,
  ) => {
    if (value < min) return min;
    if (value <= max) return value;
    const distance = value - max;
    return max + (1 - 1 / ((distance * coefficient) / dimension + 1)) * dimension;
  },
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({
    themeVariables: { "--color-border": "#333", "--color-primary": "#3b82f6" },
  }),
}));
vi.mock("../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../../components/ui/FloatingActionButton", () => ({ FloatingActionButton: () => null }));
vi.mock("../../native/v5-workspace-context", async () => {
  const { createContext } = await import("react");
  return {
    NativePrimaryColumnContext: createContext<unknown>(null),
  };
});
vi.mock("../../native/scrollEdgeEffects", () => ({ nativeHeaderScrollEdgeEffects: () => ({}) }));
vi.mock("../../native/native-layout-metrics", () => ({
  useNativeColumnLayoutMetrics: () => null,
  useNativeLayoutMetrics: () => null,
}));
vi.mock("../layout/workspace/workspace-list-insets", () => ({
  useWorkspaceListEmptyTopInset: () => 0,
}));
vi.mock("../../native/NativeWorkspaceColumns", () => ({
  useNativeWorkspaceColumnsSupported: () => false,
}));
vi.mock("../../state/queries", () => ({
  useThreadSearch: () => ({ query: "", isPending: false, failed: false, matches: [] }),
}));
vi.mock("../threads/threadMessageJump", () => ({ requestThreadMessageJump: () => {} }));
vi.mock("../threads/useThreadListSearchMatches", () => ({
  useThreadListSearchMatches: () => new Map(),
}));
vi.mock("../threads/useThreadListV2", () => ({
  useThreadListV2: ({ threads }: { threads: ReadonlyArray<EnvironmentThreadShell> }) => ({
    layout: { settledCount: 0, hiddenSettledCount: 0 },
    items: threads.map((thread) => ({
      type: "v2-thread",
      key: `${thread.environmentId}:${thread.id}`,
      item: { thread, variant: "active", snoozed: false, pinned: false, wokeAt: null },
      hasQueuedMessages: false,
      timeLabel: "now",
      showTrailingDivider: false,
      canMoveUp: false,
      canMoveDown: false,
    })),
    contentOnlyThreadKeys: new Set(),
    olderSettledShelf: { loading: false, failed: false, retry: () => {} },
  }),
}));
vi.mock("../threads/useSidebarRowThreadKey", () => ({ useSidebarRowThreadKey: () => null }));
vi.mock("../threads/use-thread-list-now", () => ({ useThreadListNow: () => Date.now() }));
vi.mock("../layout/workspace/useSearchScrollRestoration", () => ({
  useSearchScrollRestoration: () => {},
}));
vi.mock("../keyboard/threadKeyboardShortcuts", () => ({ useThreadJumpShortcuts: () => {} }));
vi.mock("../../state/thread-order", () => ({ usePendingThreadOrder: () => [] }));
vi.mock("../../state/presentation", () => ({ threadListEnvironmentsAtom: { _tag: "env" } }));
vi.mock("../../state/use-thread-outbox", () => ({ useQueuedThreadKeys: () => new Set() }));
vi.mock("../threads/thread-list-v2-items", () => ({
  ThreadListV2PendingRow: () => null,
  ThreadListV2Row: () => null,
  ThreadListV2SettledShelfHeader: () => null,
  ThreadListV2ShowMoreRow: () => null,
  ThreadListV2SnoozedShelfHeader: () => null,
  ThreadListV2WorkingShelfHeader: () => null,
}));
vi.mock("../threads/thread-provider-instance", () => ({
  useThreadRowProviderInstanceResolver: () => () => null,
}));
vi.mock("../threads/use-open-thread-pull-requests", () => ({
  useOpenThreadPullRequests: () => () => {},
}));
vi.mock("../threads/use-thread-list-v2-shelf-preferences", () => ({
  useThreadListV2ShelfPreferences: () => ({
    loaded: true,
    settledShelfExpanded: false,
    snoozedShelfExpanded: false,
    workingShelfEnabled: false,
    workingShelfExpanded: false,
    toggleSettledShelf: () => {},
    toggleSnoozedShelf: () => {},
    toggleWorkingShelf: () => {},
  }),
}));
vi.mock("./swipe-row-activation", () => ({
  createSwipeRowActivation: () => ({ activate: () => {}, trackTouches: () => {} }),
}));
vi.mock("./thread-swipe-actions", () => ({
  SwipeableScrollGateProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useSwipeableScrollGate: (input: {
    readonly onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
    readonly onScrollBeginDrag: () => void;
  }) => ({
    swipeEnabled: true,
    scrollGateHandlers: {
      onScroll: input.onScroll,
      onScrollBeginDrag: input.onScrollBeginDrag,
    },
  }),
}));
vi.mock("./FabScrollContext", () => ({ useFabScroll: () => undefined }));
vi.mock("./home-launch-splash", () => ({
  holdLaunchSplashForHomeRows: () => () => {},
  settleLaunchSplashHomeRows: () => {},
}));
vi.mock("../layout/workspace/WorkspaceTabsContext", () => ({
  useWorkspaceTabs: () => null,
}));
vi.mock("./ThreadListFilters", () => ({ ThreadListFilters: () => null }));
vi.mock("./home-empty-state", () => ({
  deriveHomeEmptyState: () => ({
    title: "",
    detail: "",
    loading: false,
    showsAddEnvironment: false,
  }),
}));

import { HomeScreen } from "./HomeScreen";

const roots: Root[] = [];

function mountHomeScreen(onStartNewTask: () => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const environmentId = EnvironmentId.make("env-1");
  const projectId = ProjectId.make("proj-1");
  const thread = {
    environmentId,
    id: ThreadId.make("thread-1"),
    projectId,
    title: "Implement feature",
    archivedAt: null,
  } as unknown as EnvironmentThreadShell;
  const project = {
    environmentId,
    id: projectId,
    title: "Acme",
    workspaceRoot: "/repo",
  } as unknown as EnvironmentProject;

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <HomeScreen
        visible
        projects={[project]}
        threads={[thread]}
        pendingTasks={[]}
        catalogState={
          {
            hasConnections: true,
            environments: [],
            isInitialLoading: false,
          } as unknown as Parameters<typeof HomeScreen>[0]["catalogState"]
        }
        savedConnectionsById={{}}
        environments={[]}
        searchQuery=""
        selectedEnvironmentId={null}
        selectedProjectKey={null}
        projectSortOrder="updated_at"
        projectGroupingMode="repository"
        onSearchQueryChange={() => {}}
        onEnvironmentChange={() => {}}
        onProjectChange={() => {}}
        onAddConnection={() => {}}
        onOpenSettings={() => {}}
        onStartNewTask={onStartNewTask}
        onSelectThread={() => {}}
        onArchiveThread={() => {}}
        onDeleteThread={() => {}}
        onSettleThread={async () => true}
        onSnoozeThread={async () => true}
        onUnsnoozeThread={async () => true}
        onUnsettleThread={() => {}}
        onPinThread={async () => true}
        onUnpinThread={async () => true}
        onSetThreadAutoSettle={async () => true}
        onMoveThread={async () => true}
        onRenameThread={() => {}}
        onRegenerateThreadTitle={async () => true}
        onSelectPendingTask={() => {}}
        onDeletePendingTask={() => {}}
        onNewThreadOnBranch={() => {}}
        onNewThreadInProject={() => {}}
      />,
    );
  });

  // HomeScreen creates shared values in order: scrollOffsetY (0), overscrollOriginY (1), pullDistance (2), pullDetentStage (3).
  mocks.pullDistanceSharedValue = mocks.sharedValues[2] as {
    value: number;
    get: () => number;
    set: (v: number) => void;
  };
  return { container, root };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  mocks.panConfig = null;
  mocks.onScroll = null;
  mocks.pullDistanceSharedValue = null;
  mocks.sharedValues.length = 0;
  mocks.triggerSemanticHaptic.mockReset();
});

describe("HomeScreen (A18 pull-to-create true overscroll)", () => {
  it("does NOT open new task when starting 200dp down the list and pulling 210dp (only 10dp true overscroll)", () => {
    const onStartNewTask = vi.fn();
    mountHomeScreen(onStartNewTask);

    expect(mocks.onScroll).not.toBeNull();
    expect(mocks.panConfig?.enabled).toBe(true);

    // List is scrolled 200dp down.
    act(() => {
      mocks.onScroll!({ nativeEvent: { contentOffset: { y: 200 } } });
    });

    // User begins pulling downward from 200dp, scrolling list back to 0 and overscrolling by 10dp.
    act(() => {
      mocks.panConfig!.onBegin?.({ translationY: 0 });
      mocks.onScroll!({ nativeEvent: { contentOffset: { y: 100 } } });
      mocks.panConfig!.onUpdate?.({ translationY: 100 });
      expect(mocks.pullDistanceSharedValue!.get()).toBe(0);

      mocks.onScroll!({ nativeEvent: { contentOffset: { y: 0 } } });
      mocks.panConfig!.onUpdate?.({ translationY: 200 });
      expect(mocks.pullDistanceSharedValue!.get()).toBe(0);

      mocks.panConfig!.onUpdate?.({ translationY: 210 });
      expect(mocks.pullDistanceSharedValue!.get()).toBe(10);

      mocks.panConfig!.onDeactivate?.({ canceled: false, translationY: 210 });
      mocks.panConfig!.onFinalize?.({ canceled: false });
    });

    expect(onStartNewTask).toHaveBeenCalledTimes(0);
  });

  it("DOES open new task when starting at top (0dp) and pulling past the create threshold", () => {
    const onStartNewTask = vi.fn();
    mountHomeScreen(onStartNewTask);

    act(() => {
      mocks.onScroll!({ nativeEvent: { contentOffset: { y: 0 } } });
      mocks.panConfig!.onBegin?.({ translationY: 0 });
      mocks.panConfig!.onUpdate?.({ translationY: 210 });
      expect(mocks.pullDistanceSharedValue!.get()).toBeGreaterThanOrEqual(104);
      mocks.panConfig!.onDeactivate?.({ canceled: false, translationY: 210 });
      mocks.panConfig!.onFinalize?.({ canceled: false });
    });

    expect(onStartNewTask).toHaveBeenCalledTimes(1);
  });

  it("does NOT open new task when a top pull past threshold is canceled", () => {
    const onStartNewTask = vi.fn();
    mountHomeScreen(onStartNewTask);

    act(() => {
      mocks.onScroll!({ nativeEvent: { contentOffset: { y: 0 } } });
      mocks.panConfig!.onBegin?.({ translationY: 0 });
      mocks.panConfig!.onUpdate?.({ translationY: 210 });
      mocks.panConfig!.onDeactivate?.({ canceled: true, translationY: 210 });
      mocks.panConfig!.onFinalize?.({ canceled: true });
    });

    expect(onStartNewTask).toHaveBeenCalledTimes(0);
  });
});

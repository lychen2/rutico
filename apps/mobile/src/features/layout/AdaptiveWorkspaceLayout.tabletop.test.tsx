import { AsyncResult } from "effect/reactivity";
import { act, useLayoutEffect, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AndroidFoldPosture } from "../../native/window-hinge-context";
import type { InspectorContent } from "./inspector-panes";

const mocks = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  return {
    windowDimensions: { width: 900, height: 840 },
    onPostureChange: null as ((posture: AndroidFoldPosture | null) => void) | null,
    onCloseTabletopInspector: null as (() => void) | null,
    inspectorSheetOpen: false,
    workspaceInspectorPaneMounted: false,
    childMountCount: 0,
    childUnmountCount: 0,
    routeKey: "thread-route-1",
    navigation: {
      isFocused: () => true,
      addListener: () => () => {},
      getParent: () => undefined,
      getState: () => ({
        index: 1,
        routes: [
          { key: "home-route-0", name: "Home" },
          { key: "thread-route-1", name: "Thread" },
        ],
      }),
      dispatch: () => {},
      navigate: () => {},
    },
  };
});

vi.mock("expo-constants", () => ({
  default: { expoConfig: {} },
}));

vi.mock("expo", () => ({
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  requireNativeView: () => () => null,
}));

vi.mock("expo-linking", () => ({
  createURL: () => "",
  openURL: () => Promise.resolve(),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => "uuid-1",
  getRandomBytes: (count: number) => new Uint8Array(count),
}));

vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: { get: () => new Map() },
}));

vi.mock("../../state/threads", () => ({
  environmentThreadShells: { environmentThreadIndexAtom: () => ({}) },
}));

vi.mock("../../state/use-thread-pr", () => ({
  withKnownPullRequestSummary: (value: unknown) => value,
}));

vi.mock("../../state/use-remote-environment-registry", () => ({
  savedConnectionsByIdAtom: {},
}));

vi.mock("../../state/workspace", () => ({
  workspaceConnections: { environmentsAtom: {} },
}));

vi.mock("expo-haptics", () => ({
  AndroidHaptics: { Toggle_On: "toggle_on" },
  performAndroidHapticsAsync: () => Promise.resolve(),
}));

vi.mock("../../lib/uuid", () => ({
  uuidv4: () => "uuid-1",
}));

vi.mock("gt-react-native", () => ({
  msg: (text: string) => text,
  useGT: () => (text: string) => text,
  useMessages: () => (message: unknown) =>
    typeof message === "string" ? message : String(message),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success({}),
}));

vi.mock("@react-navigation/native", async () => {
  const { createContext } = await import("react");
  return {
    CommonActions: { navigate: (name: string) => ({ type: "NAVIGATE", payload: { name } }) },
    NavigationContext: createContext<unknown>(undefined),
    NavigationRouteContext: createContext<unknown>(undefined),
    useNavigation: () => mocks.navigation,
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { dismiss: () => {} },
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
  useWindowDimensions: () => mocks.windowDimensions,
  View: ({
    children,
    testID,
  }: {
    children?: ReactNode;
    testID?: string;
    style?: unknown;
    className?: string;
  }) => <div data-testid={testID}>{children}</div>,
}));

vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: {
      View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
        <div data-testid={testID}>{children}</div>
      ),
    },
    Easing: {
      inOut: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
      cubic: (v: number) => v,
    },
    ReduceMotion: { System: "system" },
    runOnJS:
      <Args extends ReadonlyArray<unknown>, R>(fn: (...args: Args) => R) =>
      (...args: Args) =>
        fn(...args),
    useAnimatedStyle: () => ({}),
    useDerivedValue: (fn: () => number) => ({ value: fn(), get: fn }),
    useReducedMotion: () => true,
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
      }
      return ref.current;
    },
    withSequence: () => 0,
    withSpring: <T,>(toValue: T) => toValue,
    withTiming: <T,>(toValue: T) => toValue,
  };
});

vi.mock("react-native-safe-area-context", async () => {
  const { createContext } = await import("react");
  return {
    SafeAreaInsetsContext: createContext({ top: 0, right: 0, bottom: 0, left: 0 }),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAndroidFloatingTabs: () => false,
}));

vi.mock("../../components/ui/useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ scale: 1, fabSize: 56 }),
}));

vi.mock("./workspace/navigation-tabs", () => ({
  useEnabledNavigationTabs: () => ["threads"],
}));

vi.mock("./workspace/AndroidWorkspaceNavigation", () => ({
  AndroidWorkspaceNavigation: () => null,
  FloatingWorkspaceTabs: () => null,
  ANDROID_WORKSPACE_RAIL_WIDTH: 72,
}));

vi.mock("./workspace/AndroidWorkspaceTabsProvider", () => ({
  useAndroidWorkspaceRoot: () => null,
}));

vi.mock("./workspace/WorkspaceTabsContext", () => ({
  useWorkspaceTabs: () => null,
}));

vi.mock("./workspace/WorkspaceThreadSidebar", () => ({
  WorkspaceThreadSidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("../home/home-list-options", () => ({
  HomeListOptionsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("../../state/entities", () => ({
  useProjects: () => [],
}));

vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: { _tag: "prefs" },
}));

vi.mock("../keyboard/hardwareKeyboardCommands", () => ({
  parseActiveThreadPath: () => null,
  useHardwareKeyboardCommand: () => {},
}));

vi.mock("../../native/native-layout-metrics", () => ({
  useNativeLayoutMetrics: () => null,
}));

vi.mock("../../native/AndroidHingeObserver", () => ({
  AndroidHingeObserver: (props: {
    readonly onPostureChange?: (posture: AndroidFoldPosture | null) => void;
  }) => {
    mocks.onPostureChange = props.onPostureChange ?? null;
    return null;
  },
}));

vi.mock("./inspector-host", () => ({
  InspectorPanes: (props: {
    readonly content: InspectorContent | undefined;
    readonly onClose: () => void;
  }) => {
    mocks.onCloseTabletopInspector = props.onClose;
    return (
      <div data-testid="tabletop-inspector-panes">
        <button type="button" data-testid="close-inspector-button" onClick={props.onClose}>
          Close inspector
        </button>
        {props.content?.panes[0]?.render()}
      </div>
    );
  },
}));

vi.mock("./workspace-inspector-pane", () => ({
  WorkspaceInspectorPane: () => {
    mocks.workspaceInspectorPaneMounted = true;
    return <div data-testid="side-inspector-pane" />;
  },
}));

vi.mock("./workspace-inspector-sheet", () => ({
  WorkspaceInspectorSheet: (props: { readonly open: boolean }) => {
    mocks.inspectorSheetOpen = props.open;
    return props.open ? <div data-testid="inspector-sheet" /> : null;
  },
}));

vi.mock("./AndroidPaseoPanels", () => ({
  AndroidPaseoPanels: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("../settings/SettingsWorkspaceLayout", () => ({
  SettingsWorkspaceLayout: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("../../components/RenderErrorBoundary", () => ({
  RenderErrorBoundary: ({ children }: { children?: ReactNode }) => <>{children}</>,
  RenderFailureView: () => null,
}));

import { NavigationContext, NavigationRouteContext } from "@react-navigation/native";
import {
  AdaptiveWorkspaceLayout,
  Inspector,
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "./AdaptiveWorkspaceLayout";

const TABLETOP_POSTURE: AndroidFoldPosture = {
  orientation: "horizontal",
  posture: "tabletop",
  x: 0,
  y: 400,
  width: 900,
  height: 12,
  windowX: 0,
  windowY: 400,
  angle: 105,
  hasAngleSensor: true,
};

const roots: Root[] = [];

function mountTabletopWorkspace(viewport: { width: number; height: number }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.windowDimensions = viewport;

  let controls: ReturnType<typeof useAdaptiveWorkspaceLayout>;
  let paneState: ReturnType<typeof useWorkspacePaneState>;

  function ThreadScreenWithInspector() {
    controls = useAdaptiveWorkspaceLayout();
    paneState = useWorkspacePaneState();
    const content = useMemo<InspectorContent>(
      () => ({
        active: "git",
        panes: [
          {
            key: "git",
            label: "Changes",
            render: () => <div data-testid="inspector-pane-body">Thread Changes</div>,
          },
        ],
      }),
      [],
    );

    useLayoutEffect(() => {
      mocks.childMountCount += 1;
      return () => {
        mocks.childUnmountCount += 1;
      };
    }, []);

    return (
      <div data-testid="thread-screen-body">
        <Inspector content={content} />
      </div>
    );
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <NavigationContext.Provider value={mocks.navigation as never}>
        <NavigationRouteContext.Provider value={{ key: mocks.routeKey, name: "Thread" } as never}>
          <AdaptiveWorkspaceLayout
            pathname="/threads/env-1/thread-1"
            workspaceRouteKey={mocks.routeKey}
            workspaceRouteName="Thread"
          >
            <ThreadScreenWithInspector />
          </AdaptiveWorkspaceLayout>
        </NavigationRouteContext.Provider>
      </NavigationContext.Provider>,
    );
  });

  // Enter foldable tabletop posture.
  expect(mocks.onPostureChange).not.toBeNull();
  act(() => {
    mocks.onPostureChange!(TABLETOP_POSTURE);
  });

  return {
    container,
    get controls() {
      return controls;
    },
    get paneState() {
      return paneState;
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  mocks.onPostureChange = null;
  mocks.onCloseTabletopInspector = null;
  mocks.inspectorSheetOpen = false;
  mocks.workspaceInspectorPaneMounted = false;
  mocks.childMountCount = 0;
  mocks.childUnmountCount = 0;
});

describe("AdaptiveWorkspaceLayout (A17 foldable tabletop inspector toggle)", () => {
  it("wide foldable tabletop: supports open -> close -> reopen on the same thread without remounting thread content", () => {
    const workspace = mountTabletopWorkspace({ width: 960, height: 840 });
    expect(workspace.paneState.fileInspector.supported).toBe(true);

    // 1. Open state (initially open via default fileInspectorPreferredVisible = true).
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).not.toBeNull();
    expect(workspace.container.querySelector('[data-testid="inspector-pane-body"]')).not.toBeNull();

    // 2. Close via InspectorPanes onClose callback (dismissInspectorSheet).
    const closeButton = workspace.container.querySelector<HTMLButtonElement>(
      '[data-testid="close-inspector-button"]',
    );
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton!.click();
    });

    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).toBeNull();
    expect(workspace.container.querySelector('[data-testid="inspector-pane-body"]')).toBeNull();

    // 3. Reopen via showInspector on the same thread and same tabletop posture.
    act(() => {
      workspace.controls.showInspector();
    });

    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).not.toBeNull();
    expect(workspace.container.querySelector('[data-testid="inspector-pane-body"]')).not.toBeNull();

    // Also verify toggleAuxiliaryPane closes and reopens cleanly.
    act(() => {
      workspace.controls.toggleAuxiliaryPane();
    });
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).toBeNull();

    act(() => {
      workspace.controls.toggleAuxiliaryPane();
    });
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).not.toBeNull();

    // Thread content never unmounted across open -> close -> reopen transitions.
    expect(mocks.childMountCount).toBe(1);
    expect(mocks.childUnmountCount).toBe(0);
  });

  it("compact foldable tabletop: registered inspector stays closed until opened, then open -> close -> reopen all work", () => {
    const workspace = mountTabletopWorkspace({ width: 420, height: 840 });
    expect(workspace.paneState.fileInspector.supported).toBe(false);

    // Registered only (not opened) -> tabletop split must NOT force open.
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).toBeNull();
    expect(mocks.inspectorSheetOpen).toBe(false);

    // 1. Open inspector.
    act(() => {
      workspace.controls.showInspector();
    });
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).not.toBeNull();
    expect(workspace.container.querySelector('[data-testid="inspector-pane-body"]')).not.toBeNull();
    expect(mocks.inspectorSheetOpen).toBe(false);

    // 2. Close inspector via tabletop InspectorPanes onClose.
    const closeButton = workspace.container.querySelector<HTMLButtonElement>(
      '[data-testid="close-inspector-button"]',
    );
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton!.click();
    });
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).toBeNull();
    expect(mocks.inspectorSheetOpen).toBe(false);

    // 3. Reopen inspector via toggleAuxiliaryPane on the same thread and posture.
    act(() => {
      workspace.controls.toggleAuxiliaryPane();
    });
    expect(
      workspace.container.querySelector('[data-testid="tabletop-split-container"]'),
    ).not.toBeNull();
    expect(workspace.container.querySelector('[data-testid="inspector-pane-body"]')).not.toBeNull();

    // Thread content stayed mounted throughout all transitions.
    expect(mocks.childMountCount).toBe(1);
    expect(mocks.childUnmountCount).toBe(0);
  });
});

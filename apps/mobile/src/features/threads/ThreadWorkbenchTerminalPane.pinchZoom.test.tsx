import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveAppearance, resolveAppearancePreferences } from "../../lib/appearancePreferences";
import type { TerminalFontSizeZoomEvent } from "../terminal/nativeTerminalModule";

const mocks = vi.hoisted(() => ({
  persistedTerminalFontSize: null as number | null,
  setPersistedCalls: [] as Array<number | null>,
  listeners: new Set<() => void>(),
  latestSurfaceProps: null as {
    readonly fontSize?: number;
    readonly onFontSizeZoom?: (event: TerminalFontSizeZoomEvent) => void;
  } | null,
}));

function notifyPreferenceListeners() {
  for (const listener of mocks.listeners) listener();
}

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  StyleSheet: { hairlineWidth: 1 },
  Pressable: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children }: { children?: ReactNode }) => (
      <div data-testid="terminal-zoom-hud">{children}</div>
    ),
  },
  FadeIn: { duration: () => ({ reduceMotion: () => ({}) }) },
  FadeOut: { duration: () => ({ reduceMotion: () => ({}) }) },
  ReduceMotion: { System: "system" },
}));

vi.mock("expo-clipboard", () => ({ getStringAsync: async () => "" }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "uuid-1" }));
vi.mock("expo-haptics", () => ({
  AndroidHaptics: { Toggle_On: "toggle_on", Clock_Tick: "clock_tick" },
  selectionAsync: () => Promise.resolve(),
  performAndroidHapticsAsync: () => Promise.resolve(),
}));

vi.mock("gt-react-native", () => ({
  useGT: () => (text: string, vars?: Record<string, unknown>) =>
    vars ? text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? "")) : text,
  useMessages: () => (message: unknown) =>
    typeof message === "string" ? message : String(message),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomMount: () => {},
}));

vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/IconButton", () => ({ IconButton: () => null }));
vi.mock("../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../../components/LoadingScreen", () => ({ LoadingScreen: () => null }));

vi.mock("../../state/entities", () => ({
  useServerConfigs: () => new Map(),
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: "connected" } },
  }),
}));
vi.mock("../../state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("../../state/terminal", () => ({
  terminalEnvironment: {
    write: { _tag: "write" },
    createSession: () => ({
      driver: () => ({ _tag: "driver" }),
      reportGridSize: () => {},
    }),
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success" }),
}));
vi.mock("../../state/use-terminal-session", () => ({
  useAttachedTerminalSession: () => ({
    status: "running",
    version: 1,
    buffer: "$ ",
    output: null,
    grid: { cols: 64, rows: 20 },
    error: null,
  }),
  useKnownTerminalSessions: () => ({ sessions: [], error: null }),
}));
vi.mock("../../state/workspace", () => ({
  useConnectionsReady: () => true,
}));

// Use the REAL resolveAppearancePreferences + resolveAppearance pipeline backed by persisted state.
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => {
    const [, setTick] = useState(0);
    // Subscribe synchronously for test updates.
    const listener = () => setTick((n) => n + 1);
    mocks.listeners.add(listener);
    const prefs = resolveAppearancePreferences({
      terminalFontSize: mocks.persistedTerminalFontSize,
    });
    const appearance = resolveAppearance(prefs);
    return {
      appearance,
      themeAppearance: "dark",
      themeId: "default",
      setTerminalFontSize: (value: number | null) => {
        mocks.setPersistedCalls.push(value);
        mocks.persistedTerminalFontSize = value;
        notifyPreferenceListeners();
      },
    };
  },
}));

vi.mock("../terminal/NativeTerminalSurface", () => ({
  TerminalSurface: (props: {
    readonly fontSize?: number;
    readonly onFontSizeZoom?: (event: TerminalFontSizeZoomEvent) => void;
  }) => {
    mocks.latestSurfaceProps = props;
    return <div data-testid="terminal-surface" data-font-size={String(props.fontSize ?? "")} />;
  },
}));

vi.mock("../terminal/nativeTerminalModule", () => ({
  supportsNativeTerminalOutput: () => false,
}));

vi.mock("../terminal/terminalTheme", () => ({
  getMobileTerminalTheme: () => ({
    background: "#111",
    border: "#222",
    foreground: "#fff",
    mutedForeground: "#888",
  }),
}));

import { ThreadWorkbenchTerminalPane } from "./ThreadWorkbenchTerminalPane";

const roots: Root[] = [];

function mountWorkbench() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  const element = (
    <ThreadWorkbenchTerminalPane
      environmentId={EnvironmentId.make("env-1")}
      threadId={ThreadId.make("thread-1")}
      workspaceRoot="/repo"
      worktreePath={null}
      onOpenFullTerminal={() => {}}
    />
  );

  act(() => {
    root.render(element);
  });

  return {
    container,
    root,
    unmount() {
      act(() => root.unmount());
      const index = roots.indexOf(root);
      if (index >= 0) roots.splice(index, 1);
      mocks.listeners.clear();
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  mocks.persistedTerminalFontSize = null;
  mocks.setPersistedCalls.length = 0;
  mocks.listeners.clear();
  mocks.latestSurfaceProps = null;
});

describe("ThreadWorkbenchTerminalPane (A19 pinch font-size writeback)", () => {
  it("keeps HUD 16sp, released workbench 16sp, reopened workbench 16sp, and fullscreen 17sp (+1sp delta)", () => {
    const firstOpen = mountWorkbench();

    // Live pinch to 16sp in workbench.
    act(() => {
      mocks.latestSurfaceProps?.onFontSizeZoom?.({
        fontSize: 16,
        cols: 72,
        rows: 22,
        final: false,
      });
    });

    const hud = firstOpen.container.querySelector('[data-testid="terminal-zoom-hud"]');
    expect(hud?.textContent).toBe("16 sp · 72×22");
    expect(mocks.setPersistedCalls).toHaveLength(0);

    // Release pinch at 16sp -> commits persisted preference 17sp (preserving -1sp workbench delta).
    act(() => {
      mocks.latestSurfaceProps?.onFontSizeZoom?.({
        fontSize: 16,
        cols: 72,
        rows: 22,
        final: true,
      });
    });

    expect(mocks.setPersistedCalls).toEqual([17]);
    expect(mocks.persistedTerminalFontSize).toBe(17);

    // Immediately after release, workbench renders 16sp (no 1sp snap-back to 15sp!).
    expect(mocks.latestSurfaceProps?.fontSize).toBe(16);
    expect(
      firstOpen.container
        .querySelector('[data-testid="terminal-surface"]')
        ?.getAttribute("data-font-size"),
    ).toBe("16");

    // Fullscreen mode resolves the persisted preference directly to 17sp (preserving the 1sp offset).
    const resolvedForFullscreen = resolveAppearance(
      resolveAppearancePreferences({ terminalFontSize: mocks.persistedTerminalFontSize }),
    );
    expect(resolvedForFullscreen.terminalFontSize).toBe(17);

    // Close and reopen workbench -> still renders 16sp!
    firstOpen.unmount();
    const reopened = mountWorkbench();
    expect(mocks.latestSurfaceProps?.fontSize).toBe(16);
    expect(
      reopened.container
        .querySelector('[data-testid="terminal-surface"]')
        ?.getAttribute("data-font-size"),
    ).toBe("16");
  });

  it("keeps HUD and persisted size aligned at workbench floor (10sp) and max bound (19sp workbench / 20sp fullscreen)", () => {
    const view = mountWorkbench();

    // Pinch below workbench 10sp floor (e.g. 8sp from native canvas) -> HUD reports achievable 10sp, commits 11sp.
    act(() => {
      mocks.latestSurfaceProps?.onFontSizeZoom?.({
        fontSize: 8,
        cols: 110,
        rows: 36,
        final: true,
      });
    });
    expect(view.container.querySelector('[data-testid="terminal-zoom-hud"]')?.textContent).toBe(
      "10 sp · 110×36",
    );
    expect(mocks.persistedTerminalFontSize).toBe(11);
    expect(mocks.latestSurfaceProps?.fontSize).toBe(10);

    // Pinch to native 20sp max -> HUD reports achievable 19sp, commits 20sp (fullscreen = 20sp, workbench = 19sp).
    act(() => {
      mocks.latestSurfaceProps?.onFontSizeZoom?.({
        fontSize: 20,
        cols: 48,
        rows: 16,
        final: true,
      });
    });
    expect(view.container.querySelector('[data-testid="terminal-zoom-hud"]')?.textContent).toBe(
      "19 sp · 48×16",
    );
    expect(mocks.persistedTerminalFontSize).toBe(20);
    expect(mocks.latestSurfaceProps?.fontSize).toBe(19);
  });
});

import type { PullRequestDetail, PullRequestStack } from "@t3tools/contracts";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

interface CapturedPanGesture {
  enabled: boolean;
  onBegin?: () => void;
  onUpdate?: (event: { translationX: number }) => void;
  onEnd?: (event: { translationX: number }, success: boolean) => void;
  onFinalize?: (event: { translationX: number }, success: boolean) => void;
}

const mocks = vi.hoisted(() => ({
  runAction: vi.fn<(...args: ReadonlyArray<unknown>) => Promise<unknown>>(),
  savePreferences: vi.fn<(...args: ReadonlyArray<unknown>) => Promise<unknown>>(),
  refreshDetail: vi.fn(),
  refreshActivity: vi.fn(),
  triggerSemanticHaptic: vi.fn(),
  dialogAlert: vi.fn(),
  latestPanGesture: null as CapturedPanGesture | null,
  trackOnLayout: null as ((event: { nativeEvent: { layout: { width: number } } }) => void) | null,
  sharedValues: [] as Array<{ value: unknown; get: () => unknown }>,
  lastSpringTargets: [] as Array<unknown>,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AccessibilityInfo: {
    isScreenReaderEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => {} }),
  },
  Animated: {
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    timing: () => ({ start: () => {}, stop: () => {} }),
  },
  Easing: { out: () => () => 0, cubic: () => 0 },
  useAnimatedValue: () => ({ setValue: () => {}, interpolate: () => 0 }),
  Pressable: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  View: ({
    children,
    onLayout,
    accessibilityRole,
  }: {
    children?: ReactNode;
    onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
    accessibilityRole?: string;
  }) => {
    if (accessibilityRole === "adjustable" && onLayout) {
      mocks.trackOnLayout = onLayout;
    }
    return <div>{children}</div>;
  },
}));

vi.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => {
      const state: CapturedPanGesture = { enabled: true };
      const builder = {
        enabled(value: boolean) {
          state.enabled = value;
          return builder;
        },
        activeOffsetX() {
          return builder;
        },
        failOffsetY() {
          return builder;
        },
        onBegin(cb: () => void) {
          state.onBegin = cb;
          return builder;
        },
        onUpdate(cb: (event: { translationX: number }) => void) {
          state.onUpdate = cb;
          return builder;
        },
        onEnd(cb: (event: { translationX: number }, success: boolean) => void) {
          state.onEnd = cb;
          return builder;
        },
        onFinalize(cb: (event: { translationX: number }, success: boolean) => void) {
          state.onFinalize = cb;
          return builder;
        },
        __state: state,
      };
      return builder;
    },
  },
  GestureDetector: ({
    gesture,
    children,
  }: {
    gesture: { __state?: CapturedPanGesture };
    children?: ReactNode;
  }) => {
    if (gesture?.__state) {
      mocks.latestPanGesture = gesture.__state;
    }
    return <div>{children}</div>;
  },
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
  Extrapolation: { CLAMP: "clamp" },
  FadeIn: { duration: () => ({ reduceMotion: () => ({}) }) },
  FadeOut: { duration: () => ({ reduceMotion: () => ({}) }) },
  ReduceMotion: { System: "system" },
  interpolate: (v: number) => v,
  runOnJS:
    <Args extends ReadonlyArray<unknown>, R>(fn: (...args: Args) => R) =>
    (...args: Args) =>
      fn(...args),
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: <T,>(initial: T) => {
    const sv = {
      value: initial,
      get() {
        return sv.value;
      },
      set(next: T) {
        sv.value = next;
      },
    };
    mocks.sharedValues.push(sv);
    return sv;
  },
  withSpring: <T,>(toValue: T) => {
    mocks.lastSpringTargets.push(toValue);
    return toValue;
  },
}));

vi.mock("gt-react-native", () => ({
  msg: (text: string) => text,
  useGT: () => (text: string, vars?: Record<string, unknown>) => {
    if (!vars) return text;
    if (text.includes("Squash and merge stack") && typeof vars.count === "number") {
      return `Squash and merge stack (${vars.count})`;
    }
    return text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
  },
  useMessages: () => (message: unknown) =>
    typeof message === "string" ? message : String(message),
}));

vi.mock("../../i18n/messages", () => ({
  m: (message: unknown) => (typeof message === "string" ? message : String(message)),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success({ pullRequestMergeMethod: "squash" }),
  useAtomRefresh: () => mocks.refreshDetail,
}));

vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => undefined,
}));

vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: { _tag: "preferences" },
  saveMobilePreferences: { _tag: "saveMobilePreferences" },
}));

vi.mock("../../state/pull-requests", () => ({
  composerPullRequests: {
    runAction: { _tag: "runAction" },
    detail: () => ({ _tag: "detail" }),
    activity: () => ({ _tag: "activity" }),
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { _tag?: string }) =>
    command._tag === "runAction" ? mocks.runAction : mocks.savePreferences,
}));

vi.mock("./usePullRequestPermissions", () => ({
  usePullRequestPermissions: () => ({ connected: true, canWrite: true }),
}));

vi.mock("./usePullRequestAction", () => ({
  usePullRequestAction: () => ({
    busy: false,
    available: () => false,
    perform: vi.fn(),
  }),
}));

vi.mock("../../components/ui/Dialog", () => ({
  alert: (...args: ReadonlyArray<unknown>) => mocks.dialogAlert(...args),
}));

vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <span>loading</span>,
}));

vi.mock("../../components/ui/AppSymbol", () => ({
  SymbolView: () => <span />,
}));

vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../components/ui/Button", () => ({
  Button: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

vi.mock("../../components/ui/Menu", () => ({
  Menu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/ui/SplitButton", () => ({
  SplitButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

vi.mock("../../lib/hapticChoreography", () => ({
  triggerSemanticHaptic: (...args: ReadonlyArray<unknown>) => mocks.triggerSemanticHaptic(...args),
}));

vi.mock("../../lib/mobileMotion", () => ({
  SPRING_DETENT_SNAP: {},
}));

import { PullRequestMergeControls } from "./PullRequestMergeControls";
import type { PullRequestParams } from "./usePullRequestDiff";
import type { PullRequestStackState } from "./usePullRequestStack";

function makePr(overrides?: Partial<PullRequestDetail>): PullRequestDetail {
  return {
    provider: "github",
    number: 42,
    title: "Fix slide-to-merge gesture cancel",
    url: "https://github.com/acme/repo/pull/42",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    autoMergeEnabled: false,
    headBranch: "feat/a01",
    baseBranch: "main",
    headSha: "sha-single-42",
    capabilities: {
      actions: ["merge", "enable-auto-merge", "disable-auto-merge"],
      mergeMethods: ["squash", "merge", "rebase"],
      stackAutoMerge: true,
    },
    viewerPermissions: {
      actions: ["merge", "enable-auto-merge", "disable-auto-merge"],
    },
    mergeCapabilities: {
      squash: true,
      merge: true,
      rebase: true,
      "fast-forward": false,
    },
    ...overrides,
  } as unknown as PullRequestDetail;
}

function makeParams(number = 42): PullRequestParams {
  return {
    environmentId: EnvironmentId.make("env-1"),
    projectId: ProjectId.make("proj-1"),
    repository: "acme/repo",
    number,
    host: "github.com",
  };
}

const TRACK_WIDTH = 300;
const MAX_TRAVEL = TRACK_WIDTH - 44 - 8; // 248dp

const roots: Root[] = [];

function mountControls(pr: PullRequestDetail, stack: PullRequestStackState) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<PullRequestMergeControls pr={pr} params={makeParams(pr.number)} stack={stack} />);
  });
  expect(mocks.trackOnLayout).not.toBeNull();
  act(() => {
    mocks.trackOnLayout!({ nativeEvent: { layout: { width: TRACK_WIDTH } } });
  });
  return { container, root };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  mocks.runAction.mockReset();
  mocks.savePreferences.mockReset();
  mocks.refreshDetail.mockReset();
  mocks.refreshActivity.mockReset();
  mocks.triggerSemanticHaptic.mockReset();
  mocks.dialogAlert.mockReset();
  mocks.latestPanGesture = null;
  mocks.trackOnLayout = null;
  mocks.sharedValues.length = 0;
  mocks.lastSpringTargets.length = 0;
});

describe("PullRequestMergeControls (A01 Android slide-to-merge)", () => {
  it("single PR: OS gesture cancel at 93% fires 0 merge calls; normal release fires exactly 1 call", async () => {
    mocks.runAction.mockResolvedValue(AsyncResult.success(undefined));
    const pr = makePr({ number: 42, headSha: "sha-single-42" });
    const stack: PullRequestStackState = {
      data: null,
      stack: null,
      successResult: AsyncResult.success(null),
      failure: null,
      isPending: false,
      isSuccess: true,
      supportsStackActions: true,
      isFresh: true,
      error: null,
      refresh: vi.fn(),
    };

    mountControls(pr, stack);
    const gesture = mocks.latestPanGesture!;
    expect(gesture).not.toBeNull();

    // Drag to 93% (> 92% threshold) and cancel via OS gesture interruption (`success = false`).
    const ninetyThreePercentX = MAX_TRAVEL * 0.93;
    await act(async () => {
      gesture.onBegin?.();
      gesture.onUpdate?.({ translationX: ninetyThreePercentX });
      gesture.onEnd?.({ translationX: ninetyThreePercentX }, false);
      gesture.onFinalize?.({ translationX: ninetyThreePercentX }, false);
    });

    expect(mocks.runAction).toHaveBeenCalledTimes(0);
    expect(mocks.lastSpringTargets.at(-1)).toBe(0);

    // Drag below threshold (50%) and release normally (`success = true`) -> still 0 calls.
    await act(async () => {
      gesture.onBegin?.();
      gesture.onUpdate?.({ translationX: MAX_TRAVEL * 0.5 });
      gesture.onEnd?.({ translationX: MAX_TRAVEL * 0.5 }, true);
      gesture.onFinalize?.({ translationX: MAX_TRAVEL * 0.5 }, true);
    });

    expect(mocks.runAction).toHaveBeenCalledTimes(0);

    // Drag to 93% and release normally (`success = true`) -> exactly 1 merge call.
    await act(async () => {
      gesture.onBegin?.();
      gesture.onUpdate?.({ translationX: ninetyThreePercentX });
      gesture.onEnd?.({ translationX: ninetyThreePercentX }, true);
      gesture.onFinalize?.({ translationX: ninetyThreePercentX }, true);
    });

    expect(mocks.runAction).toHaveBeenCalledTimes(1);
    expect(mocks.runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          action: "merge",
          expectedHeadSha: "sha-single-42",
        }),
      }),
    );
    const callArg = mocks.runAction.mock.calls[0]?.[0] as { input?: Record<string, unknown> };
    expect(callArg.input?.stackNumber).toBeUndefined();
  });

  it("stacked PR: OS gesture cancel at 93% fires 0 merge calls; normal release fires exactly 1 stack merge call", async () => {
    mocks.runAction.mockResolvedValue(AsyncResult.success(undefined));
    const pr = makePr({ number: 42, headSha: "sha-layer-42" });
    const stackModel: PullRequestStack = {
      id: "stack-7",
      number: 7,
      url: "https://github.com/acme/repo/pull/42",
      base: "main",
      layers: [
        {
          number: 41,
          headBranch: "stack/layer-1",
          headSha: "sha-layer-41",
          state: "open",
          isDraft: false,
        },
        {
          number: 42,
          headBranch: "stack/layer-2",
          headSha: "sha-layer-42",
          state: "open",
          isDraft: false,
        },
      ],
    };
    const stack: PullRequestStackState = {
      data: stackModel,
      stack: stackModel,
      successResult: AsyncResult.success(stackModel),
      failure: null,
      isPending: false,
      isSuccess: true,
      supportsStackActions: true,
      isFresh: true,
      error: null,
      refresh: vi.fn(),
    };

    const { container } = mountControls(pr, stack);
    expect(container.textContent).toContain("Squash and merge stack (2)");

    const gesture = mocks.latestPanGesture!;
    expect(gesture).not.toBeNull();

    // Drag to 93% and cancel (`success = false`) -> 0 stack merge calls.
    const ninetyThreePercentX = MAX_TRAVEL * 0.93;
    await act(async () => {
      gesture.onBegin?.();
      gesture.onUpdate?.({ translationX: ninetyThreePercentX });
      gesture.onEnd?.({ translationX: ninetyThreePercentX }, false);
      gesture.onFinalize?.({ translationX: ninetyThreePercentX }, false);
    });

    expect(mocks.runAction).toHaveBeenCalledTimes(0);
    expect(mocks.lastSpringTargets.at(-1)).toBe(0);

    // Drag to 93% and release normally (`success = true`) -> exactly 1 stack merge call.
    await act(async () => {
      gesture.onBegin?.();
      gesture.onUpdate?.({ translationX: ninetyThreePercentX });
      gesture.onEnd?.({ translationX: ninetyThreePercentX }, true);
      gesture.onFinalize?.({ translationX: ninetyThreePercentX }, true);
    });

    expect(mocks.runAction).toHaveBeenCalledTimes(1);
    expect(mocks.runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          action: "merge",
          expectedHeadSha: "sha-layer-42",
          stackNumber: 7,
          mergeMethod: "squash",
          expectedStackHeads: [
            { number: 41, headSha: "sha-layer-41" },
            { number: 42, headSha: "sha-layer-42" },
          ],
        }),
      }),
    );
  });
});

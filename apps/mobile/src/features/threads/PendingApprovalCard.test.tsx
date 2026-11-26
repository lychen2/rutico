import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  RuntimeRequestId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { PendingApproval } from "../../lib/threadActivity";

const mocks = vi.hoisted(() => ({
  triggerSemanticHaptic: vi.fn(),
}));

interface MockViewProps {
  readonly children?: ReactNode;
  readonly testID?: string;
  readonly className?: string;
  readonly style?: Record<string, unknown> | ReadonlyArray<unknown>;
  readonly accessibilityRole?: string;
  readonly accessibilityLiveRegion?: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityState?: { readonly busy?: boolean; readonly disabled?: boolean };
}

function serializeStyle(style: MockViewProps["style"]): string {
  if (!style) return "";
  try {
    return JSON.stringify(style);
  } catch {
    return "";
  }
}

function MockView(props: MockViewProps) {
  return (
    <div
      data-testid={props.testID}
      data-classname={props.className}
      data-style={serializeStyle(props.style)}
      role={props.accessibilityRole}
      aria-live={
        props.accessibilityLiveRegion === "assertive"
          ? "assertive"
          : props.accessibilityLiveRegion === "polite"
            ? "polite"
            : undefined
      }
      aria-label={props.accessibilityLabel}
      aria-busy={props.accessibilityState?.busy}
      aria-disabled={props.accessibilityState?.disabled}
    >
      {props.children}
    </div>
  );
}

vi.mock("react-native", () => ({
  View: MockView,
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityState,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityState?: { readonly busy?: boolean; readonly disabled?: boolean };
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={accessibilityLabel}
      aria-busy={accessibilityState?.busy}
      onClick={disabled ? undefined : onPress}
    >
      {children}
    </button>
  ),
}));

vi.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => {
      const builder = {
        activeOffsetY: () => builder,
        failOffsetX: () => builder,
        onUpdate: () => builder,
        onEnd: () => builder,
        onFinalize: () => builder,
      };
      return builder;
    },
  },
  GestureDetector: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: MockView,
  },
  FadeIn: { duration: () => ({ reduceMotion: () => ({}) }) },
  FadeOut: { duration: () => ({ reduceMotion: () => ({}) }) },
  LinearTransition: {
    springify: () => ({
      damping: () => ({
        stiffness: () => ({
          mass: () => ({
            reduceMotion: () => ({}),
          }),
        }),
      }),
    }),
  },
  ReduceMotion: { System: "system" },
  runOnJS:
    <Args extends ReadonlyArray<unknown>, R>(fn: (...args: Args) => R) =>
    (...args: Args) =>
      fn(...args),
  useAnimatedStyle: () => ({}),
  useSharedValue: <T,>(initial: T) => {
    const sv = {
      value: initial,
      get: () => sv.value,
      set: (next: T) => {
        sv.value = next;
      },
    };
    return sv;
  },
  withSpring: <T,>(toValue: T) => toValue,
}));

vi.mock("gt-react-native", () => ({
  T: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useGT: () => (text: string, vars?: Record<string, unknown>) =>
    vars ? text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? "")) : text,
  useMessages: () => (message: unknown) =>
    typeof message === "string" ? message : String(message),
}));

vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <span data-testid="approval-spinner">spinner</span>,
}));

vi.mock("../../components/ui/AppSymbol", () => ({
  SymbolView: ({ name, tintColorClassName }: { name: string; tintColorClassName?: string }) => (
    <span data-symbol={name} data-tint={tintColorClassName} />
  ),
}));

vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <span data-text-classname={className}>{children}</span>
  ),
}));

vi.mock("../../components/ui/ThreadDisclosureChevron", () => ({
  ThreadDisclosureChevron: () => <span />,
}));

vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    loading,
    onPress,
    tone,
  }: {
    label: string;
    disabled?: boolean;
    loading?: boolean;
    onPress: () => void;
    tone?: string;
  }) => {
    const isDisabled = Boolean(disabled || loading);
    return (
      <button
        type="button"
        data-button-label={label}
        data-tone={tone}
        data-loading={loading ? "true" : "false"}
        disabled={isDisabled}
        aria-busy={Boolean(loading)}
        onClick={isDisabled ? undefined : onPress}
      >
        {label}
      </button>
    );
  },
}));

vi.mock("../../lib/hapticChoreography", () => ({
  triggerSemanticHaptic: (...args: ReadonlyArray<unknown>) => mocks.triggerSemanticHaptic(...args),
}));

vi.mock("../../lib/mobileMotion", () => ({
  SPRING_SPATIAL_SNAPPY: {},
}));

import { PendingApprovalCard } from "./PendingApprovalCard";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MCP_ELICITATION_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "acceptAlways", label: "Always allow" },
  { decision: "accept", label: "Approve" },
];

function makeApproval(overrides?: Partial<PendingApproval>): PendingApproval {
  return {
    requestId: "req-mcp-1" as RuntimeRequestId,
    requestKind: "mcp-elicitation",
    appName: "GitHub MCP",
    detail: "Allow GitHub MCP to inspect repository settings?",
    responseCapability: "live",
    options: MCP_ELICITATION_OPTIONS,
    ...overrides,
  } as unknown as PendingApproval;
}

const roots: Root[] = [];

function mountCard(input: {
  readonly approval?: PendingApproval;
  readonly respondingApprovalId?: RuntimeRequestId | null;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const approval = input.approval ?? makeApproval();
  act(() => {
    root.render(
      <PendingApprovalCard
        canOperateThread
        approval={approval}
        respondingApprovalId={input.respondingApprovalId ?? null}
        onRespond={input.onRespond}
      />,
    );
  });
  return {
    container,
    root,
    rerender(respondingApprovalId: RuntimeRequestId | null) {
      act(() => {
        root.render(
          <PendingApprovalCard
            canOperateThread
            approval={approval}
            respondingApprovalId={respondingApprovalId}
            onRespond={input.onRespond}
          />,
        );
      });
    },
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[data-button-label="${label}"]`);
  if (!button) {
    throw new Error(`Button "${label}" not found in ${container.innerHTML}`);
  }
  return button;
}

function findBanner(container: HTMLElement): HTMLElement {
  const banner = container.querySelector<HTMLElement>('[data-testid="approval-status-banner"]');
  if (!banner) {
    throw new Error(`Status banner not found in ${container.innerHTML}`);
  }
  return banner;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  mocks.triggerSemanticHaptic.mockReset();
});

describe("PendingApprovalCard (A04-mobile honest states & cancel handling)", () => {
  it("shows neutral submitting state while in-flight, then transitions to green Approved on resolution", async () => {
    const deferred = createDeferred<unknown>();
    const onRespond = vi.fn(() => deferred.promise);
    const { container } = mountCard({ onRespond });

    // Tap Approve -> enters in_flight (Submitting), NOT Approved.
    act(() => {
      findButton(container, "Approve").click();
    });

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("req-mcp-1", "accept");

    const inFlightBanner = findBanner(container);
    expect(inFlightBanner.textContent).toContain("Submitting approval");
    expect(inFlightBanner.textContent).not.toContain("Approved");
    expect(inFlightBanner.getAttribute("aria-busy")).toBe("true");
    expect(inFlightBanner.getAttribute("aria-live")).toBe("polite");
    expect(inFlightBanner.getAttribute("data-style")).not.toContain("16, 185, 129");
    expect(findButton(container, "Approve").disabled).toBe(true);
    expect(findButton(container, "Approve").getAttribute("data-loading")).toBe("true");
    expect(findButton(container, "Decline").disabled).toBe(true);

    // Duplicate tap while in-flight is ignored.
    act(() => {
      findButton(container, "Approve").click();
    });
    expect(onRespond).toHaveBeenCalledTimes(1);

    // Resolve request -> transitions to confirmed green Approved.
    await act(async () => {
      deferred.resolve(AsyncResult.success(undefined));
      await deferred.promise;
    });

    const settledBanner = findBanner(container);
    expect(settledBanner.textContent).toContain("Approved");
    expect(settledBanner.getAttribute("aria-label")).toBe("Approved");
    expect(settledBanner.getAttribute("aria-busy")).toBe("false");
    expect(settledBanner.getAttribute("aria-live")).toBe("polite");
    expect(settledBanner.getAttribute("data-style")).toContain("16, 185, 129");
    expect(settledBanner.querySelector('[data-symbol="checkmark.circle.fill"]')).not.toBeNull();
    expect(container.querySelectorAll("button[data-button-label]")).toHaveLength(0);
    expect(mocks.triggerSemanticHaptic).toHaveBeenLastCalledWith("confirm");
  });

  it("shows honest submitting state then red Declined on decline resolution", async () => {
    const deferred = createDeferred<unknown>();
    const onRespond = vi.fn(() => deferred.promise);
    const { container } = mountCard({ onRespond });

    act(() => {
      findButton(container, "Decline").click();
    });

    expect(onRespond).toHaveBeenCalledWith("req-mcp-1", "decline");
    const inFlightBanner = findBanner(container);
    expect(inFlightBanner.textContent).toContain("Submitting decline");
    expect(inFlightBanner.textContent).not.toContain("Declined");
    expect(inFlightBanner.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      deferred.resolve(AsyncResult.success(undefined));
      await deferred.promise;
    });

    const settledBanner = findBanner(container);
    expect(settledBanner.textContent).toContain("Declined");
    expect(settledBanner.getAttribute("aria-label")).toBe("Declined");
    expect(settledBanner.getAttribute("aria-live")).toBe("polite");
    expect(settledBanner.getAttribute("data-style")).toContain("239, 68, 68");
    expect(settledBanner.querySelector('[data-symbol="xmark.circle.fill"]')).not.toBeNull();
    expect(mocks.triggerSemanticHaptic).toHaveBeenLastCalledWith("reject");
  });

  it("sends exact 'cancel' decision and renders neutral Cancelled — NEVER green Approved", async () => {
    const deferred = createDeferred<unknown>();
    const onRespond = vi.fn(() => deferred.promise);
    const { container } = mountCard({ onRespond });

    act(() => {
      findButton(container, "Cancel").click();
    });

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("req-mcp-1", "cancel");

    const inFlightBanner = findBanner(container);
    expect(inFlightBanner.textContent).toContain("Cancelling request");
    expect(inFlightBanner.textContent).not.toContain("Approved");
    expect(inFlightBanner.getAttribute("aria-label")).not.toContain("Approved");
    expect(inFlightBanner.getAttribute("data-style")).not.toContain("16, 185, 129");
    expect(mocks.triggerSemanticHaptic).not.toHaveBeenCalledWith("confirm");

    await act(async () => {
      deferred.resolve(AsyncResult.success(undefined));
      await deferred.promise;
    });

    const settledBanner = findBanner(container);
    expect(settledBanner.textContent).toBe("Cancelled");
    expect(settledBanner.textContent).not.toContain("Approved");
    expect(settledBanner.getAttribute("aria-label")).toBe("Cancelled");
    expect(settledBanner.getAttribute("aria-live")).toBe("polite");
    expect(settledBanner.getAttribute("data-style")).not.toContain("16, 185, 129");
    expect(settledBanner.getAttribute("data-classname")).not.toContain("emerald");
    expect(settledBanner.querySelector('[data-symbol="slash.circle"]')).not.toBeNull();
    expect(settledBanner.querySelector('[data-symbol="checkmark.circle.fill"]')).toBeNull();
    expect(mocks.triggerSemanticHaptic).not.toHaveBeenCalledWith("confirm");
    expect(mocks.triggerSemanticHaptic).toHaveBeenLastCalledWith("toggleOff");
  });

  it("surfaces retryable failure on rejected Promise and allows retrying to completion", async () => {
    const firstAttempt = createDeferred<unknown>();
    const secondAttempt = createDeferred<unknown>();
    const onRespond = vi
      .fn<(requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>>()
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(secondAttempt.promise);

    const { container } = mountCard({ onRespond });

    // Attempt 1: Approve -> rejects.
    act(() => {
      findButton(container, "Approve").click();
    });
    expect(findBanner(container).textContent).toContain("Submitting approval");

    await act(async () => {
      firstAttempt.reject(new Error("Connection dropped"));
      await firstAttempt.promise.catch(() => undefined);
    });

    const failedBanner = findBanner(container);
    expect(failedBanner.getAttribute("role")).toBe("alert");
    expect(failedBanner.getAttribute("aria-live")).toBe("assertive");
    expect(failedBanner.textContent).toContain("Connection dropped");
    expect(failedBanner.textContent).toContain("Try again.");
    expect(failedBanner.textContent).not.toContain("Approved");
    expect(failedBanner.querySelector('[data-symbol="exclamationmark.triangle"]')).not.toBeNull();

    // Buttons are re-enabled for retry.
    expect(findButton(container, "Approve").disabled).toBe(false);
    expect(findButton(container, "Cancel").disabled).toBe(false);

    // Attempt 2: retry with Cancel -> in-flight clears error, then resolves to Cancelled.
    act(() => {
      findButton(container, "Cancel").click();
    });
    expect(onRespond).toHaveBeenCalledTimes(2);
    expect(onRespond).toHaveBeenNthCalledWith(2, "req-mcp-1", "cancel");
    expect(findBanner(container).textContent).toContain("Cancelling request");
    expect(findBanner(container).textContent).not.toContain("Connection dropped");

    await act(async () => {
      secondAttempt.resolve(AsyncResult.success(undefined));
      await secondAttempt.promise;
    });

    const settledBanner = findBanner(container);
    expect(settledBanner.textContent).toBe("Cancelled");
    expect(settledBanner.getAttribute("aria-label")).toBe("Cancelled");
  });

  it("treats AsyncResult.Failure as retryable failure rather than Approved", async () => {
    const attempt = createDeferred<unknown>();
    const retry = createDeferred<unknown>();
    const onRespond = vi
      .fn<(requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>>()
      .mockReturnValueOnce(attempt.promise)
      .mockReturnValueOnce(retry.promise);

    const { container } = mountCard({ onRespond });

    act(() => {
      findButton(container, "Always allow this session").click();
    });

    await act(async () => {
      attempt.resolve(AsyncResult.failure(Cause.fail(new Error("RPC timeout"))));
      await attempt.promise;
    });

    const failedBanner = findBanner(container);
    expect(failedBanner.getAttribute("role")).toBe("alert");
    expect(failedBanner.textContent).toContain("RPC timeout");
    expect(failedBanner.textContent).not.toContain("Approved");
    expect(findButton(container, "Always allow this session").disabled).toBe(false);

    act(() => {
      findButton(container, "Always allow this session").click();
    });
    await act(async () => {
      retry.resolve(AsyncResult.success(undefined));
      await retry.promise;
    });

    expect(findBanner(container).textContent).toBe("Approved for session");
  });
});

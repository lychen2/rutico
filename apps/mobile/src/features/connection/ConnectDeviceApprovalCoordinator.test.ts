import { EnvironmentId, type AuthPairingLink } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => {
  const queryListeners = new Set<() => void>();
  return {
    environments: [] as Array<{
      readonly environmentId: EnvironmentId;
      readonly label: string;
      readonly connection: { readonly phase: string };
      readonly serverConfig?: {
        readonly settings: { readonly requireConnectDeviceApproval: boolean };
      };
    }>,
    managedIds: new Set<EnvironmentId>(),
    pairingLinksByEnv: new Map<EnvironmentId, ReadonlyArray<AuthPairingLink>>(),
    subscribeQuery: (listener: () => void) => {
      queryListeners.add(listener);
      return () => {
        queryListeners.delete(listener);
      };
    },
    setPairingLinks: (environmentId: EnvironmentId, links: ReadonlyArray<AuthPairingLink>) => {
      harness.pairingLinksByEnv.set(environmentId, links);
      for (const listener of queryListeners) listener();
    },
    approveCommand: vi.fn(),
    denyCommand: vi.fn(),
  };
});

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  const Box = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return {
    Animated: {
      View: Box,
      loop: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({}),
      timing: () => ({}),
    },
    Easing: { inOut: () => () => 0, out: () => () => 0, quad: () => 0, sin: () => 0 },
    Platform: { OS: "android" },
    StyleSheet: {
      absoluteFill: {},
      create: <T extends Record<string, unknown>>(styles: T) => styles,
    },
    useAnimatedValue: () => ({
      setValue: () => {},
      interpolate: () => 0,
    }),
    View: Box,
  };
});
vi.mock("react-native-reanimated", async () => {
  const { createElement: h } = await import("react");
  return {
    default: { View: ({ children }: { children?: ReactNode }) => h("div", null, children) },
    ReduceMotion: { System: "system" },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: (initial: number) => ({
      get: () => initial,
      set: () => {},
    }),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-haptics", () => ({
  AndroidHaptics: {
    Confirm: "confirm",
    Reject: "reject",
    Gesture_Start: "gesture-start",
    Gesture_End: "gesture-end",
    Segment_Tick: "segment-tick",
    Segment_Frequent_Tick: "segment-frequent-tick",
    Clock_Tick: "clock-tick",
    Toggle_On: "toggle-on",
    Toggle_Off: "toggle-off",
    Context_Click: "context-click",
    Drag_Start: "drag-start",
    Long_Press: "long-press",
  },
  performAndroidHapticsAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Soft: "soft" },
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress?: () => void;
  }) => createElement("button", { type: "button", disabled, onClick: onPress }, label),
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../components/ui/OverlayPortal", () => ({
  OverlayPortal: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-testid": "overlay-portal" }, children),
}));
vi.mock("../../lib/appState", () => ({ useAppActive: () => true }));
vi.mock("../../persistence/imperative", () => ({
  loadPreferences: vi.fn(async () => null),
  updatePreferences: vi.fn(async () => {}),
}));
vi.mock("../../state/auth", () => ({
  authEnvironment: {
    accessChanges: ({ environmentId }: { environmentId: EnvironmentId }) => ({ environmentId }),
    approveConnectDevice: { _tag: "approveConnectDevice" },
    revokePairingLink: { _tag: "revokePairingLink" },
  },
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: harness.environments }),
}));
vi.mock("../../state/query", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEnvironmentQuery: (query: { environmentId: EnvironmentId }) => {
      const links = useSyncExternalStore(
        harness.subscribeQuery,
        () => harness.pairingLinksByEnv.get(query.environmentId),
        () => harness.pairingLinksByEnv.get(query.environmentId),
      );
      if (links === undefined) return { data: null };
      return {
        data: {
          type: "snapshot",
          payload: {
            pairingLinks: links,
            connectDevices: [],
          },
        },
      };
    },
  };
});
vi.mock("../../state/session", () => ({
  useEnvironmentsWithScope: () => harness.managedIds,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (cmd: { _tag: string }) =>
    cmd._tag === "approveConnectDevice" ? harness.approveCommand : harness.denyCommand,
}));

import {
  ConnectDeviceApprovalCoordinator,
  formatVerificationCodeGroups,
  getActiveApprovalHandshakeForTesting,
  offerApprovalPromptsForTesting,
  type QueuedApprovalPrompt,
} from "./ConnectDeviceApprovalCoordinator";

function makePairingLink(input: {
  readonly id: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly verificationCode: string;
  readonly deviceLabel: string;
}): AuthPairingLink {
  return {
    id: input.id,
    scopes: [],
    subject: "cloud-connect",
    createdAt: DateTime.makeUnsafe(input.createdAtMs),
    expiresAt: DateTime.makeUnsafe(input.expiresAtMs),
    connectDeviceRequest: {
      verificationCode: input.verificationCode,
      client: {
        label: input.deviceLabel,
        deviceType: "desktop",
      },
    },
  } as unknown as AuthPairingLink;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === label);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  harness.environments = [];
  harness.managedIds = new Set();
  harness.pairingLinksByEnv = new Map();
  harness.approveCommand.mockReset();
  harness.denyCommand.mockReset();
});

describe("ConnectDeviceApprovalCoordinator handshake card bridge", () => {
  it("groups 6-digit, 8-char, and hyphenated verification codes cleanly", () => {
    expect(formatVerificationCodeGroups("842917")).toBe("842 · 917");
    expect(formatVerificationCodeGroups("ABCD-EFGH")).toBe("ABCD · EFGH");
    expect(formatVerificationCodeGroups("WXYZ2345")).toBe("WXYZ · 2345");
    expect(formatVerificationCodeGroups("  ")).toBe("");
  });

  it("presents queued approval prompts one at a time via the handshake sheet store instead of raw Dialog.alert", () => {
    const envId = EnvironmentId.make("linux-workstation");
    const first: QueuedApprovalPrompt = {
      pairingLinkId: "req-1",
      title: "Approve this device?",
      message: "Pixel 9 wants to connect.",
      environmentId: envId,
      environmentLabel: "Linux Workstation",
      deviceLabel: "Pixel 9 · Android",
      deviceType: "mobile",
      verificationCode: "842917",
      createdAtMs: 1_000,
      expiresAtMs: 601_000,
      approve: vi.fn(async () => "done" as const),
      deny: vi.fn(async () => "done" as const),
    };
    const second: QueuedApprovalPrompt = {
      ...first,
      pairingLinkId: "req-2",
      deviceLabel: "ThinkPad · Linux",
      verificationCode: "ABCD-EFGH",
    };

    const cleanup = offerApprovalPromptsForTesting(envId, [first, second]);
    try {
      const current = getActiveApprovalHandshakeForTesting();
      expect(current?.prompt.pairingLinkId).toBe("req-1");
      expect(current?.prompt.verificationCode).toBe("842917");

      // Retrying re-queues the same prompt at the front.
      current?.answer("retry");
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("req-1");

      // Completing advances to the next queued prompt.
      getActiveApprovalHandshakeForTesting()?.answer("done");
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("req-2");
    } finally {
      cleanup();
    }

    expect(getActiveApprovalHandshakeForTesting()).toBeNull();
  });

  it("auto-dismisses an expired waiting prompt and immediately advances to the next queued prompt", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const startMs = 1_700_000_000_000;
    vi.setSystemTime(startMs);

    const envId = EnvironmentId.make("host-expiry");
    harness.environments = [
      {
        environmentId: envId,
        label: "Studio Mac",
        connection: { phase: "connected" },
        serverConfig: { settings: { requireConnectDeviceApproval: true } },
      },
    ];
    harness.managedIds = new Set([envId]);
    harness.pairingLinksByEnv = new Map([
      [
        envId,
        [
          makePairingLink({
            id: "expiry-a",
            createdAtMs: startMs,
            expiresAtMs: startMs + 5_000,
            verificationCode: "111222",
            deviceLabel: "Device A",
          }),
          makePairingLink({
            id: "expiry-b",
            createdAtMs: startMs + 100,
            expiresAtMs: startMs + 60_000,
            verificationCode: "333444",
            deviceLabel: "Device B",
          }),
        ],
      ],
    ]);

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(ConnectDeviceApprovalCoordinator)));
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("expiry-a");
      expect(container.textContent).toContain("Device A");
      expect(container.textContent).toContain("111 · 222");

      // Advance past A's deadline without tapping Approve or Deny.
      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("expiry-b");
      expect(container.textContent).toContain("Device B");
      expect(container.textContent).toContain("333 · 444");
      expect(harness.approveCommand).not.toHaveBeenCalled();
      expect(harness.denyCommand).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it("auto-dismisses a remotely withdrawn waiting prompt and advances to the queued prompt", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const startMs = 1_700_000_000_000;
    vi.setSystemTime(startMs);

    const envId = EnvironmentId.make("host-withdraw");
    harness.environments = [
      {
        environmentId: envId,
        label: "Studio Mac",
        connection: { phase: "connected" },
        serverConfig: { settings: { requireConnectDeviceApproval: true } },
      },
    ];
    harness.managedIds = new Set([envId]);
    const linkA = makePairingLink({
      id: "withdraw-a",
      createdAtMs: startMs,
      expiresAtMs: startMs + 60_000,
      verificationCode: "111222",
      deviceLabel: "Device A",
    });
    const linkB = makePairingLink({
      id: "withdraw-b",
      createdAtMs: startMs + 100,
      expiresAtMs: startMs + 60_000,
      verificationCode: "333444",
      deviceLabel: "Device B",
    });
    harness.pairingLinksByEnv = new Map([[envId, [linkA, linkB]]]);

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(ConnectDeviceApprovalCoordinator)));
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("withdraw-a");
      expect(container.textContent).toContain("Device A");

      // Another client answers A, so A disappears from the server snapshot while B remains queued.
      act(() => {
        harness.setPairingLinks(envId, [linkB]);
      });

      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("withdraw-b");
      expect(container.textContent).toContain("Device B");
      expect(container.textContent).toContain("333 · 444");
    } finally {
      act(() => root.unmount());
    }
  });

  it("preserves the confirmation stamp when a submitted request disappears from the snapshot mid-flight", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const startMs = 1_700_000_000_000;
    vi.setSystemTime(startMs);

    let resolveApprove!: (value: { _tag: "Success"; value: { approved: boolean } }) => void;
    harness.approveCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprove = resolve;
        }),
    );

    const envId = EnvironmentId.make("host-inflight");
    harness.environments = [
      {
        environmentId: envId,
        label: "Studio Mac",
        connection: { phase: "connected" },
        serverConfig: { settings: { requireConnectDeviceApproval: true } },
      },
    ];
    harness.managedIds = new Set([envId]);
    const linkA = makePairingLink({
      id: "inflight-a",
      createdAtMs: startMs,
      expiresAtMs: startMs + 60_000,
      verificationCode: "111222",
      deviceLabel: "Device A",
    });
    const linkB = makePairingLink({
      id: "inflight-b",
      createdAtMs: startMs + 100,
      expiresAtMs: startMs + 60_000,
      verificationCode: "333444",
      deviceLabel: "Device B",
    });
    harness.pairingLinksByEnv = new Map([[envId, [linkA, linkB]]]);

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(ConnectDeviceApprovalCoordinator)));
      // Wait for the 700ms arming delay.
      act(() => {
        vi.advanceTimersByTime(700);
      });
      const approveButton = findButton(container, "Approve");
      expect(approveButton?.disabled).toBe(false);

      act(() => {
        approveButton?.click();
      });
      expect(harness.approveCommand).toHaveBeenCalledTimes(1);

      // Server broadcasts snapshot without A while A's approval RPC is still resolving.
      act(() => {
        harness.setPairingLinks(envId, [linkB]);
      });
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("inflight-a");

      await act(async () => {
        resolveApprove({ _tag: "Success", value: { approved: true } });
      });
      expect(container.textContent).toContain("Device approved");
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("inflight-a");

      // After the 520ms confirmation stamp hold, the queue advances cleanly to B.
      act(() => {
        vi.advanceTimersByTime(520);
      });
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("inflight-b");
      expect(container.textContent).toContain("Device B");
    } finally {
      act(() => root.unmount());
    }
  });

  it("blocks runDecision when the deadline has already elapsed even before the timer callback fires", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const startMs = 1_700_000_000_000;
    vi.setSystemTime(startMs);

    const envId = EnvironmentId.make("host-race-expiry");
    harness.environments = [
      {
        environmentId: envId,
        label: "Studio Mac",
        connection: { phase: "connected" },
        serverConfig: { settings: { requireConnectDeviceApproval: true } },
      },
    ];
    harness.managedIds = new Set([envId]);
    harness.pairingLinksByEnv = new Map([
      [
        envId,
        [
          makePairingLink({
            id: "race-a",
            createdAtMs: startMs,
            expiresAtMs: startMs + 5_000,
            verificationCode: "111222",
            deviceLabel: "Device A",
          }),
          makePairingLink({
            id: "race-b",
            createdAtMs: startMs + 100,
            expiresAtMs: startMs + 60_000,
            verificationCode: "333444",
            deviceLabel: "Device B",
          }),
        ],
      ],
    ]);

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(ConnectDeviceApprovalCoordinator)));
      act(() => {
        vi.advanceTimersByTime(700);
      });
      const approveButton = findButton(container, "Approve");
      expect(approveButton?.disabled).toBe(false);

      // Simulate clock crossing the deadline just before the expiry timer runs.
      vi.spyOn(Date, "now").mockReturnValue(startMs + 5_001);
      await act(async () => {
        approveButton?.click();
      });

      expect(harness.approveCommand).not.toHaveBeenCalled();
      expect(getActiveApprovalHandshakeForTesting()?.prompt.pairingLinkId).toBe("race-b");
    } finally {
      act(() => root.unmount());
    }
  });
});

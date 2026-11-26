import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Animated: {
    View: () => null,
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
  View: () => null,
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: () => null },
  ReduceMotion: { System: "system" },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (initial: number) => ({
    get: () => initial,
    set: () => {},
  }),
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
}));
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
vi.mock("../../components/ui/AppText", () => ({ AppText: () => null }));
vi.mock("../../components/ui/Button", () => ({ Button: () => null }));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../components/ui/OverlayPortal", () => ({ OverlayPortal: () => null }));
vi.mock("../../lib/appState", () => ({ useAppActive: () => true }));
vi.mock("../../persistence/imperative", () => ({
  loadPreferences: vi.fn(async () => null),
  updatePreferences: vi.fn(async () => {}),
}));
vi.mock("../../state/auth", () => ({ authEnvironment: {} }));
vi.mock("../../state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("../../state/session", () => ({ useEnvironmentsWithScope: () => new Set() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

import {
  formatVerificationCodeGroups,
  getActiveApprovalHandshakeForTesting,
  offerApprovalPromptsForTesting,
  type QueuedApprovalPrompt,
} from "./ConnectDeviceApprovalCoordinator";

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
});

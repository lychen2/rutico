import { EnvironmentId, GuestShareId, ThreadId, type ThreadGuestShare } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const { Slot, sharing, created } = vi.hoisted(() => ({
  Slot: ({ children }: { children?: ReactNode }) => children,
  created: {
    share: undefined as ThreadGuestShare | null | undefined,
    updatedAt: "1970-01-01T00:00:00.000Z",
    command: vi.fn(),
  },
  sharing: { messages: [] as Array<{ status: "pending" | "dismissed" }> },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ScrollView: Slot,
  View: Slot,
  Share: {},
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: Slot },
  ReduceMotion: { System: "system" },
  useAnimatedStyle: () => ({}),
  useSharedValue: (initial: number) => ({
    get: () => initial,
    set: () => {},
  }),
  withSpring: (value: number) => value,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <svg data-testid="guest-pass-qr" {...props}>
      {children}
    </svg>
  ),
  G: ({ children }: { children?: ReactNode }) => <g>{children}</g>,
  Path: ({ d }: { d?: string }) => <path d={d} />,
  Rect: () => <rect />,
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
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: () => {} }),
  usePreventRemove: () => {},
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: { value: unknown }, select?: (value: unknown) => unknown) =>
    select
      ? select(atom.value)
      : atom.value === "thread"
        ? { projection: { thread: { updatedAt: DateTime.makeUnsafe(created.updatedAt) } } }
        : atom.value,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { createGuestShare: { permissionAtom: () => ({ value: true }) } },
  environmentServerConfigsAtom: {},
}));
vi.mock("../../state/threads", () => ({
  environmentThreadDetails: {
    threadAtom: () => ({ value: "thread" }),
    statusAtom: () => ({ value: "ready" }),
    errorAtom: () => ({ value: null }),
  },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => created.command }));
vi.mock("./ThreadGuestShareBar", () => ({
  useThreadGuestShare: () =>
    created.share !== undefined
      ? created.share
      : {
          guestName: null,
          expiresAt: "1970-01-01T00:00:01.000Z",
          messages: sharing.messages,
        },
}));
vi.mock("../../components/ui/AppText", () => ({ AppText: Slot }));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppBar", () => ({ AppBar: () => null }));
vi.mock("../../components/ui/SheetHeader", () => ({ SheetHeader: () => null }));
vi.mock("../../components/ui/ScreenContent", () => ({ ScreenContent: Slot }));
vi.mock("../../components/ui/Dialog", () => ({}));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
vi.mock("../../lib/copyTextWithHaptic", () => ({ tryCopyTextWithHaptic: () => true }));

import * as hapticChoreography from "../../lib/hapticChoreography";
import {
  buildGuestPassQrSvg,
  formatGuestPassCountdown,
  ThreadGuestShareSheet,
} from "./ThreadGuestShareSheet";

it("stops treating a retained guest link as active when it expires", async () => {
  sharing.messages = [];
  created.share = undefined;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const renderSheet = () =>
    root.render(
      <ThreadGuestShareSheet
        route={{
          params: {
            environmentId: EnvironmentId.make("test"),
            threadId: ThreadId.make("thread"),
          },
        }}
      />,
    );
  try {
    await act(renderSheet);
    expect(container.textContent).toContain("A guest link is active.");
    expect(container.querySelector("button")?.textContent).toBe("Create new link");

    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(container.textContent).not.toContain("A guest link is active.");
    expect(container.querySelector("button")?.textContent).toBe("Create link");
    sharing.messages = [{ status: "pending" }];
    await act(renderSheet);
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.textContent).toContain("Send or dismiss pending guest messages");

    sharing.messages = [{ status: "dismissed" }];
    await act(renderSheet);
    expect(container.querySelector("button")?.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it.each(["expired", "stopped", "replaced", "redeemed"] as const)(
  "hides a created link after it is %s, while keeping it through projection catch-up",
  async (change) => {
    created.share = undefined;
    created.updatedAt = "1970-01-01T00:00:00.000Z";
    sharing.messages = [];
    const share: ThreadGuestShare = {
      id: GuestShareId.make("created"),
      host: "env.t3.test",
      createdAt: "1970-01-01T00:00:00.100Z",
      expiresAt: "1970-01-01T00:00:01.000Z",
      guestName: null,
      messages: [],
    };
    const url = "https://env.t3.test/guest#invite";
    created.command.mockResolvedValue({ _tag: "Success", value: { url, share } });
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const renderSheet = () =>
      root.render(
        <ThreadGuestShareSheet
          route={{
            params: {
              environmentId: EnvironmentId.make("test"),
              threadId: ThreadId.make("thread"),
            },
          }}
        />,
      );
    try {
      await act(renderSheet);
      await act(async () => container.querySelector("button")!.click());
      expect(container.textContent).toContain(url);
      created.share = share;
      created.updatedAt = share.createdAt;
      await act(renderSheet);
      expect(container.textContent).toContain(url);
      expect(container.textContent).toContain("Copy");
      if (change === "expired") {
        await act(() => vi.advanceTimersByTimeAsync(1000));
      } else {
        created.updatedAt = "1970-01-01T00:00:00.200Z";
        created.share =
          change === "redeemed"
            ? { ...share, guestName: "Sam" }
            : { ...share, id: GuestShareId.make("other") };
        if (change === "stopped") created.share = null;
        await act(renderSheet);
      }
      expect(container.textContent).not.toContain(url);
      expect(container.textContent).not.toContain("Copy");
      expect(container.textContent).not.toContain("Share");
    } finally {
      act(() => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
      created.command.mockReset();
      created.share = undefined;
    }
  },
);

it("renders an instant in-sheet Guest Live Pass QR with role badge, 24h countdown, and Confirm haptic on copy", async () => {
  created.share = null;
  created.updatedAt = "1970-01-01T00:00:00.000Z";
  sharing.messages = [];
  const share: ThreadGuestShare = {
    id: GuestShareId.make("guest-pass-1"),
    host: "linux.t3.test",
    createdAt: "1970-01-01T00:00:00.100Z",
    expiresAt: "1970-01-02T00:00:00.000Z",
    guestName: null,
    messages: [],
  };
  const url = "https://linux.t3.test/guest#invite-token-42";
  created.command.mockResolvedValue({ _tag: "Success", value: { url, share } });
  const hapticSpy = vi.spyOn(hapticChoreography, "triggerSemanticHaptic");

  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(() =>
      root.render(
        <ThreadGuestShareSheet
          route={{
            params: {
              environmentId: EnvironmentId.make("test"),
              threadId: ThreadId.make("thread"),
            },
          }}
        />,
      ),
    );
    await act(async () => container.querySelector("button")!.click());

    expect(container.querySelector('[data-testid="guest-pass-qr"]')).not.toBeNull();
    expect(container.textContent).toContain("Guest pass");
    expect(container.textContent).toContain("24h left");
    expect(container.textContent).toContain(url);

    const copyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy",
    );
    expect(copyButton).toBeDefined();
    await act(async () => copyButton?.click());
    expect(hapticSpy).toHaveBeenCalledWith("confirm");

    const qrData = buildGuestPassQrSvg(url);
    expect(qrData.finderEyes).toHaveLength(3);
    expect(qrData.moduleCount).toBeGreaterThan(50);
    expect(formatGuestPassCountdown(share.expiresAt, 30 * 60_000)).toBe("23h 30m");
  } finally {
    hapticSpy.mockRestore();
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    created.command.mockReset();
    created.share = undefined;
  }
});

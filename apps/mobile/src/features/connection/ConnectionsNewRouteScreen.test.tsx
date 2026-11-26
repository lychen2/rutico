import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const { Children, harness } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => <>{children}</>,
  harness: {
    // The app-wide error slot other features (composer sends, branch refreshes) write to.
    pendingConnectionError: null as string | null,
    connectPress: vi.fn(),
    cameraPermissionGranted: false,
    lastOnBarcodeScanned: null as ((result: unknown) => void) | null,
    lastFrostedCutoutProps: null as Record<string, unknown> | null,
    performAndroidHapticsAsync: vi.fn(async () => {}),
    notificationAsync: vi.fn(async () => {}),
  },
}));

vi.mock("react-native", () => ({
  Animated: {
    View: Children,
    loop: () => ({ start: () => {}, stop: () => {} }),
    sequence: () => ({}),
    timing: () => ({}),
  },
  Easing: { inOut: () => () => 0, out: () => () => 0, quad: () => 0, sin: () => 0 },
  Platform: { OS: "android" },
  useAnimatedValue: () => ({
    setValue: () => {},
    interpolate: () => 0,
  }),
  View: Children,
  Pressable: Children,
  Linking: { openSettings: vi.fn() },
  StyleSheet: { absoluteFill: {} },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: Children },
  ReduceMotion: { System: "system" },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (initial: number) => ({
    get: () => initial,
    set: () => {},
  }),
  withSpring: (value: number) => value,
}));
vi.mock("../../lib/appState", () => ({
  useAppActive: () => true,
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
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("react-native-svg", () => ({
  default: Children,
  Defs: Children,
  RadialGradient: Children,
  Rect: () => null,
  Stop: () => null,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@react-navigation/native", () => ({
  StackActions: { replace: vi.fn() },
  useIsFocused: () => true,
  useNavigation: () => ({ canGoBack: () => true, goBack: vi.fn(), dispatch: vi.fn() }),
  useRoute: () => ({ name: "ConnectionsNew" }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ isLoaded: false, isSignedIn: false }) }));
vi.mock("expo-camera", () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (result: unknown) => void }) => {
    harness.lastOnBarcodeScanned = onBarcodeScanned ?? null;
    return null;
  },
  useCameraPermissions: () => [
    harness.cameraPermissionGranted ? { granted: true, canAskAgain: true } : null,
    vi.fn(async () => ({ granted: true, canAskAgain: true })),
  ],
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
  performAndroidHapticsAsync: harness.performAndroidHapticsAsync,
  notificationAsync: harness.notificationAsync,
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Soft: "soft" },
}));
vi.mock("../../components/ui/ListRow", () => ({ ListRow: () => null }));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: Children }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
}));
vi.mock("../../components/ui/FrostedCutout", () => ({
  FrostedCutout: (props: Record<string, unknown>) => {
    harness.lastFrostedCutoutProps = props;
    return null;
  },
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../lib/useUniwindTheme", () => ({ useUniwindTheme: () => ({}) }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "dark" }),
}));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: Children }));
vi.mock("../settings/settings-navigation", () => ({
  leaveSettingsPage: vi.fn(),
  openSettings: vi.fn(),
}));
vi.mock("../layout/workspace/workspace-selection-store", () => ({
  workspaceHasColumns: () => false,
}));
vi.mock("../cloud/publicConfig", () => ({ hasCloudPublicConfig: () => false }));
vi.mock("./CloudEnvironmentRows", () => ({ CloudEnvironmentRows: () => null }));
vi.mock("./environmentSections", () => ({
  splitEnvironmentSections: () => ({ connectedCloudEnvironments: [] }),
}));
vi.mock("./devAutoConnect", () => ({
  autoConnectReport: () => ({ connecting: false, error: null }),
  devAutoConnectAttemptAtom: {},
  pairingLinksAllowed: () => __DEV__,
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  setPendingConnectionError: (message: string | null) => {
    harness.pendingConnectionError = message;
  },
  useRemoteConnections: () => ({
    connectionPairingUrl: "",
    connectedEnvironments: [],
    pairingConnectionError: harness.pendingConnectionError,
    onChangeConnectionPairingUrl: vi.fn(),
    onConnectPress: harness.connectPress,
    onSetEnvironmentEnabled: vi.fn(),
    onRemoveEnvironmentPress: vi.fn(),
  }),
}));

import * as hapticChoreography from "../../lib/hapticChoreography";
import { ConnectionsNewRouteScreen, extractBarcodeLockRect } from "./ConnectionsNewRouteScreen";

it("does not show another feature's error as a pairing failure", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("__DEV__", false);
  harness.cameraPermissionGranted = false;
  harness.pendingConnectionError = "Could not send the message.";
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ConnectionsNewRouteScreen route={{ params: undefined }} />));

  expect(container.textContent).not.toContain("Could not send the message.");
  expect(container.textContent).toContain("For machines on your local network or tailnet.");

  act(() => root.unmount());
  // Leaving the form must not wipe an error that belongs to another screen.
  expect(harness.pendingConnectionError).toBe("Could not send the message.");
});

it("splits a pasted pairing link and preserves the code during address edits", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("__DEV__", false);
  harness.cameraPermissionGranted = false;
  harness.pendingConnectionError = null;
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    act(() => root.render(<ConnectionsNewRouteScreen route={{ params: undefined }} />));
    const address = container.querySelector<HTMLInputElement>('input[aria-label="Address"]')!;
    const code = container.querySelector<HTMLInputElement>('input[aria-label="Code"]')!;
    const enter = (input: HTMLInputElement, value: string) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    enter(code, "manual-code");
    enter(address, "  http://100.82.53.91:3773/pair#token=test-pairing-code\n");
    expect(address.value).toBe("http://100.82.53.91:3773");
    expect(code.value).toBe("test-pairing-code");

    enter(code, "replacement-code");
    for (const value of ["", "100.82.53.92:3773", "http://100.82.53.92:3773/"]) {
      enter(address, value);
      expect(address.value).toBe(value);
      expect(code.value).toBe("replacement-code");
    }

    const connectButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    expect(connectButton).toBeDefined();
    expect(connectButton?.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});

it("prefills the confirmation form from system links in production without auto-pairing", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("__DEV__", false);
  harness.cameraPermissionGranted = false;
  harness.pendingConnectionError = null;
  harness.connectPress.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    act(() =>
      root.render(
        <ConnectionsNewRouteScreen
          route={{
            params: {
              pairingUrl: "https://desktop.tailnet.ts.net/pair#token=confirm-me",
              autoConnect: "1",
            },
          }}
        />,
      ),
    );
    const address = container.querySelector<HTMLInputElement>('input[aria-label="Address"]')!;
    const code = container.querySelector<HTMLInputElement>('input[aria-label="Code"]')!;
    expect(address.value).toBe("https://desktop.tailnet.ts.net");
    expect(code.value).toBe("confirm-me");
    expect(harness.connectPress).not.toHaveBeenCalled();

    const connectButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    expect(connectButton?.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});

it("locks reticle onto bounds, fires semantic Confirm haptic, shows in-place handshake card, and requires explicit confirmation", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("__DEV__", false);
  harness.cameraPermissionGranted = true;
  harness.pendingConnectionError = null;
  harness.lastOnBarcodeScanned = null;
  harness.lastFrostedCutoutProps = null;
  harness.connectPress.mockReset();
  const hapticSpy = vi.spyOn(hapticChoreography, "triggerSemanticHaptic");

  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    act(() => root.render(<ConnectionsNewRouteScreen route={{ params: undefined }} />));
    expect(harness.lastOnBarcodeScanned).not.toBeNull();

    act(() => {
      harness.lastOnBarcodeScanned?.({
        data: "http://192.168.1.42:3773/pair#token=scanned-secret",
        bounds: { origin: { x: 88, y: 42 }, size: { width: 120, height: 118 } },
      });
    });

    expect(hapticSpy).toHaveBeenCalledWith("confirm");
    expect(hapticChoreography.resolveAndroidHapticConstant("confirm")).toBe("confirm");
    // B12 hard rule: scanning MUST NEVER auto-pair without explicit user confirmation.
    expect(harness.connectPress).not.toHaveBeenCalled();
    const cutoutProps = harness.lastFrostedCutoutProps as Record<string, unknown> | null;
    expect(cutoutProps?.locked).toBe(true);
    expect(cutoutProps?.lockRect).toEqual({
      x: 88,
      y: 42,
      width: 120,
      height: 118,
    });
    expect(container.textContent).toContain("Ready to pair");
    expect(container.textContent).toContain("http://192.168.1.42:3773");

    // Failed handshake surfaces Retry button in-place.
    harness.connectPress.mockResolvedValueOnce({ ok: false, error: "Host unreachable" });
    const confirmButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Confirm & connect",
    );
    expect(confirmButton).toBeDefined();
    await act(async () => {
      confirmButton?.click();
    });

    expect(harness.connectPress).toHaveBeenCalledTimes(1);
    expect(hapticSpy).toHaveBeenCalledWith("reject");
    expect(container.textContent).toContain("Host unreachable");
    expect(container.textContent).toContain("Retry handshake");
  } finally {
    hapticSpy.mockRestore();
    act(() => root.unmount());
    harness.cameraPermissionGranted = false;
  }
});

it("returns null lockRect when Android CameraX omits or zeros barcode bounds", () => {
  expect(
    extractBarcodeLockRect({
      data: "http://192.168.1.42:3773/pair#token=abc",
      bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
    }),
  ).toBeNull();
  expect(
    extractBarcodeLockRect({
      data: "http://192.168.1.42:3773/pair#token=abc",
      cornerPoints: [
        { x: 40, y: 30 },
        { x: 160, y: 30 },
        { x: 160, y: 150 },
        { x: 40, y: 150 },
      ],
    }),
  ).toEqual({ x: 40, y: 30, width: 120, height: 120 });
});

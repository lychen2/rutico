import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, fakeTimers, render } from "../../test/render";
import { authEnvironment } from "../state/auth";
import {
  CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS,
  ConnectDeviceApprovalCoordinator,
} from "./ConnectDeviceApprovalCoordinator";
import { ToastProvider } from "./ui/toast";

const environmentId = EnvironmentId.make("env-1");

interface MockPairingLink {
  readonly id: string;
  readonly expiresAt: DateTime.Utc;
  readonly connectDeviceRequest?: {
    readonly verificationCode: string;
    readonly client: {
      readonly label?: string;
      readonly deviceType: "mobile" | "desktop" | "web" | "unknown";
      readonly os?: string;
      readonly browser?: string;
    };
  };
}

const mockState = vi.hoisted(() => ({
  pairingLinks: [] as ReadonlyArray<MockPairingLink>,
  approve: vi.fn(async () => ({ _tag: "Success" as const, value: undefined })),
  deny: vi.fn(async () => ({ _tag: "Success" as const, value: undefined })),
}));

vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [
      {
        environmentId,
        label: "Work Mac",
        connection: { phase: "connected" as const },
        serverConfig: { settings: { requireConnectDeviceApproval: true } },
      },
    ],
  })) as never,
}));

vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));

vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: {
      type: "snapshot" as const,
      payload: {
        pairingLinks: mockState.pairingLinks,
        connectDevices: [],
      },
    },
  })) as never,
}));

vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) => {
    if (command === authEnvironment.approveConnectDevice) return mockState.approve;
    if (command === authEnvironment.revokePairingLink) return mockState.deny;
    return vi.fn(async () => ({ _tag: "Success" as const, value: undefined }));
  }) as never,
}));

describe("ConnectDeviceApprovalCoordinator device-request toast arming", () => {
  it("gates Approve for 700ms in both button state and click handler, approves once after 700ms, and keeps Deny immediately available", async () => {
    const startMs = Date.parse("2026-11-27T10:00:00.000Z");
    using _timers = fakeTimers({ now: startMs });
    mockState.approve.mockClear();
    mockState.deny.mockClear();
    mockState.pairingLinks = [
      {
        id: "link-approve",
        expiresAt: DateTime.makeUnsafe(startMs + 60_000),
        connectDeviceRequest: {
          verificationCode: "123456",
          client: {
            label: "Pixel 9",
            deviceType: "mobile",
            os: "Android",
          },
        },
      },
    ];

    await using screen = await render(
      <ToastProvider>
        <ConnectDeviceApprovalCoordinator />
      </ToastProvider>,
    );

    const approveButton = page.getByRole("button", { name: "Approve" });
    const denyButton = page.getByRole("button", { name: "Deny" });
    await expect.element(page.getByText("123 · 456")).toBeVisible();
    await expect.element(approveButton).toBeDisabled();
    await expect.element(denyButton).toBeEnabled();

    // Advance to 699ms (< 700ms): still disarmed, and even a programmatic/raced click is ignored.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS - 1);
    });
    await expect.element(approveButton).toBeDisabled();

    const approveEl = approveButton.element() as HTMLButtonElement;
    approveEl.disabled = false;
    approveEl.click();
    approveEl.disabled = true;

    expect(mockState.approve).toHaveBeenCalledTimes(0);
    await expect.element(page.getByText("123 · 456")).toBeVisible();

    // Advance across the 700ms threshold: Approve becomes enabled and submits once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await expect.element(approveButton).toBeEnabled();
    await userEvent.click(approveButton);

    expect(mockState.approve).toHaveBeenCalledTimes(1);
    expect(mockState.approve).toHaveBeenCalledWith({
      environmentId,
      input: { pairingLinkId: "link-approve" },
    });

    // A second request can be denied immediately (< 700ms) while Approve is still disarmed.
    mockState.pairingLinks = [
      {
        id: "link-deny",
        expiresAt: DateTime.makeUnsafe(startMs + 120_000),
        connectDeviceRequest: {
          verificationCode: "654321",
          client: {
            label: "Unknown Tablet",
            deviceType: "mobile",
            os: "iOS",
          },
        },
      },
    ];
    await screen.rerender(
      <ToastProvider>
        <ConnectDeviceApprovalCoordinator />
      </ToastProvider>,
    );

    await expect.element(page.getByText("654 · 321")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Deny" })).toBeEnabled();

    await userEvent.click(page.getByRole("button", { name: "Deny" }));
    expect(mockState.deny).toHaveBeenCalledTimes(1);
    expect(mockState.deny).toHaveBeenCalledWith({
      environmentId,
      input: { id: "link-deny" },
    });
  });

  it("re-arms Approve for 700ms when the same pairing link updates its request identity", async () => {
    const startMs = Date.parse("2026-11-27T10:05:00.000Z");
    using _timers = fakeTimers({ now: startMs });
    mockState.approve.mockClear();
    mockState.pairingLinks = [
      {
        id: "link-rearm",
        expiresAt: DateTime.makeUnsafe(startMs + 60_000),
        connectDeviceRequest: {
          verificationCode: "111222",
          client: {
            label: "Phone A",
            deviceType: "mobile",
          },
        },
      },
    ];

    await using screen = await render(
      <ToastProvider>
        <ConnectDeviceApprovalCoordinator />
      </ToastProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS);
    });
    await expect.element(page.getByRole("button", { name: "Approve" })).toBeEnabled();

    // Verification code changes on the same link id -> must immediately disarm for a fresh 700ms.
    mockState.pairingLinks = [
      {
        id: "link-rearm",
        expiresAt: DateTime.makeUnsafe(startMs + 60_000),
        connectDeviceRequest: {
          verificationCode: "333444",
          client: {
            label: "Phone B",
            deviceType: "mobile",
          },
        },
      },
    ];
    await screen.rerender(
      <ToastProvider>
        <ConnectDeviceApprovalCoordinator />
      </ToastProvider>,
    );

    await expect.element(page.getByText("333 · 444")).toBeVisible();
    const approveButton = page.getByRole("button", { name: "Approve" });
    await expect.element(approveButton).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS - 1);
    });
    await expect.element(approveButton).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await expect.element(approveButton).toBeEnabled();
  });
});

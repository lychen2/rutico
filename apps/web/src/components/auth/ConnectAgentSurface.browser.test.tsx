import type { AuthMcpApprovalDetails, AuthMcpAuthorizationRequest } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, fakeTimers, render } from "../../../test/render";
import { McpConsent, type McpApprovalTransport } from "./ConnectAgentSurface";

const AUTHORIZATION: AuthMcpAuthorizationRequest = {
  client_id: "agent-client-1",
  redirect_uri: "http://127.0.0.1:41234/callback",
  response_type: "code",
  code_challenge: "challenge-value",
  code_challenge_method: "S256",
  state: Redacted.make("state-123"),
};

const DETAILS: AuthMcpApprovalDetails = {
  clientName: "Claude Desktop",
  environmentHost: "linux-workstation.local",
  redirectHost: "127.0.0.1:41234",
  csrfToken: "csrf-test-token",
  oneClickAccess: ["read-only", "approval-required", "auto"],
};

describe("McpConsent 700ms arming sweep and blur/focus rearm guard", () => {
  it("renders the 700ms GPU scaleX arming sweep, keeps Approve disabled until armed, and rearms on blur/focus", async () => {
    using _timers = fakeTimers();
    const decide = vi.fn(async () => ({ kind: "error" as const, message: "stopped" }));
    const transport: McpApprovalTransport = {
      load: vi.fn(async () => ({ kind: "ok" as const, value: DETAILS })),
      decide,
    };

    await using screen = await render(
      <McpConsent authorization={AUTHORIZATION} transport={transport} />,
    );

    const approveButton = screen.getByRole("button", { name: /Approve/ });
    await expect.element(approveButton).toBeVisible();
    await expect.element(approveButton).toBeDisabled();

    const sweep = screen.container.querySelector<HTMLElement>('[data-slot="arming-sweep"]');
    expect(sweep).not.toBeNull();
    expect(sweep?.dataset.armed).toBe("false");

    // Advancing 699ms must still keep Approve disarmed against clickjacking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(699);
    });
    await expect.element(approveButton).toBeDisabled();
    expect(decide).not.toHaveBeenCalled();

    // Reaching 700ms arms the button.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await expect.element(approveButton).toBeEnabled();
    expect(
      screen.container.querySelector<HTMLElement>('[data-slot="arming-sweep"]')?.dataset.armed,
    ).toBe("true");

    // Window blur immediately disarms; focus restarts a fresh 700ms arming sweep.
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await expect.element(approveButton).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await expect.element(approveButton).toBeDisabled();
    expect(
      screen.container.querySelector<HTMLElement>('[data-slot="arming-sweep"]')?.dataset.armed,
    ).toBe("false");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(699);
    });
    await expect.element(approveButton).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await expect.element(approveButton).toBeEnabled();

    // Clicking once armed submits the approval decision.
    await approveButton.click();
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  });
});

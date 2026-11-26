import {
  RuntimeRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
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
  { decision: "accept", label: "Approve" },
];

function ApprovalHarness({
  requestId = RuntimeRequestId.make("req-approval-1"),
  options = MCP_ELICITATION_OPTIONS,
  onRespond,
}: {
  readonly requestId?: RuntimeRequestId;
  readonly options?: ReadonlyArray<ProviderApprovalOption>;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}) {
  const [responding, setResponding] = useState(false);
  return (
    <div className="flex items-center gap-2 p-6">
      <ComposerPendingApprovalActions
        requestId={requestId}
        isResponding={responding}
        canRespond
        options={options}
        onRespondToApproval={async (id, decision) => {
          setResponding(true);
          try {
            return await onRespond(id, decision);
          } finally {
            setResponding(false);
          }
        }}
      />
    </div>
  );
}

describe("ComposerPendingApprovalActions submission lifecycle and live announcements", () => {
  it("announces Submitting while in flight and transitions to Approved only after confirmation", async () => {
    const requestId = RuntimeRequestId.make("req-approve");
    const deferred = createDeferred<AsyncResult.AsyncResult<void, Error>>();
    const onRespond = vi.fn(() => deferred.promise);

    await using screen = await render(
      <ApprovalHarness requestId={requestId} onRespond={onRespond} />,
    );

    const status = screen.getByRole("status").element();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("data-approval-state")).toBe("pending");
    expect(status.textContent).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(requestId, "accept");

    // While in flight: must announce Submitting and NEVER Approved/Declined/Cancelled.
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("in_flight");
    });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("data-approval-stamp")).toBeNull();
    expect(status.textContent).toContain("Submitting");
    expect(status.textContent).not.toMatch(/Approved|Declined|Cancelled/);
    expect(status.querySelector('[data-approval-stamp-check="true"]')).toBeNull();
    expect(screen.container.querySelectorAll("button")).toHaveLength(0);

    // Resolve with confirmation -> transitions visually and audibly to Approved.
    deferred.resolve(AsyncResult.success(undefined));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("confirmed");
    });
    expect(status.getAttribute("aria-busy")).toBeNull();
    expect(status.getAttribute("data-approval-stamp")).toBe("approved");
    expect(status.textContent).toBe("Approved");
    expect(status.querySelector('[data-approval-stamp-check="true"]')).not.toBeNull();
  });

  it("announces Submitting while in flight and transitions to Declined only after confirmation", async () => {
    const requestId = RuntimeRequestId.make("req-decline");
    const deferred = createDeferred<AsyncResult.AsyncResult<void, Error>>();
    const onRespond = vi.fn(() => deferred.promise);

    await using screen = await render(
      <ApprovalHarness requestId={requestId} onRespond={onRespond} />,
    );

    const status = screen.getByRole("status").element();
    await userEvent.click(screen.getByRole("button", { name: "Decline", exact: true }));
    expect(onRespond).toHaveBeenCalledWith(requestId, "decline");

    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("in_flight");
    });
    expect(status.textContent).toContain("Submitting");
    expect(status.textContent).not.toMatch(/Approved|Declined|Cancelled/);

    deferred.resolve(AsyncResult.success(undefined));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("confirmed");
    });
    expect(status.getAttribute("data-approval-stamp")).toBe("declined");
    expect(status.textContent).toBe("Declined");
    expect(status.querySelector('[data-approval-stamp-check="true"]')).toBeNull();
  });

  it("sends cancel payload, announces Submitting in flight, and transitions to Cancelled (never Approved)", async () => {
    const requestId = RuntimeRequestId.make("req-cancel");
    const deferred = createDeferred<AsyncResult.AsyncResult<void, Error>>();
    const onRespond = vi.fn(() => deferred.promise);

    await using screen = await render(
      <ApprovalHarness requestId={requestId} onRespond={onRespond} />,
    );

    const status = screen.getByRole("status").element();
    await userEvent.click(screen.getByRole("button", { name: "More approval options" }));
    await expect.element(page.getByRole("menuitem", { name: "Cancel", exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("menuitem", { name: "Cancel", exact: true }));

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(requestId, "cancel");

    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("in_flight");
    });
    expect(status.textContent).toContain("Submitting");
    expect(status.textContent).not.toMatch(/Approved|Declined|Cancelled/);

    deferred.resolve(AsyncResult.success(undefined));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("confirmed");
    });
    expect(status.getAttribute("data-approval-stamp")).toBe("cancelled");
    expect(status.textContent).toBe("Cancelled");
    expect(status.textContent).not.toContain("Approved");
    expect(status.className).not.toContain("bg-success");
    expect(status.querySelector('[data-approval-stamp-check="true"]')).toBeNull();
  });

  it("transitions in_flight -> failed (retryable) on rejection and Failure result, then retries to confirmed", async () => {
    const requestId = RuntimeRequestId.make("req-retry");
    const firstAttempt = createDeferred<AsyncResult.AsyncResult<void, Error>>();
    const secondAttempt = createDeferred<AsyncResult.AsyncResult<void, Error>>();
    const thirdAttempt = createDeferred<AsyncResult.AsyncResult<void, Error>>();
    const onRespond = vi
      .fn<
        (
          requestId: RuntimeRequestId,
          decision: ProviderApprovalDecision,
        ) => Promise<AsyncResult.AsyncResult<void, Error>>
      >()
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(secondAttempt.promise)
      .mockReturnValueOnce(thirdAttempt.promise);

    await using screen = await render(
      <ApprovalHarness requestId={requestId} onRespond={onRespond} />,
    );

    const status = screen.getByRole("status").element();

    // Attempt 1: rejects with network error.
    await userEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("in_flight");
    });
    expect(status.textContent).not.toContain("Approved");

    firstAttempt.reject(new Error("Socket disconnected"));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("failed");
    });
    expect(status.getAttribute("data-approval-stamp")).toBeNull();
    expect(status.textContent).toMatch(/Failed/i);
    expect(status.textContent).not.toMatch(/Approved|Declined|Cancelled/);
    await expect
      .element(screen.getByRole("button", { name: "Approve", exact: true }))
      .toBeEnabled();

    // Attempt 2: resolves with Effect AsyncResult Failure.
    await userEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("in_flight");
    });

    secondAttempt.resolve(AsyncResult.failure(Cause.fail(new Error("Timeout"))));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("failed");
    });
    expect(status.textContent).toMatch(/Failed/i);
    await expect
      .element(screen.getByRole("button", { name: "Approve", exact: true }))
      .toBeEnabled();

    // Attempt 3: succeeds -> transitions in_flight -> confirmed Approved.
    await userEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("in_flight");
    });
    expect(status.textContent).toContain("Submitting");

    thirdAttempt.resolve(AsyncResult.success(undefined));
    await vi.waitFor(() => {
      expect(status.getAttribute("data-approval-state")).toBe("confirmed");
    });
    expect(status.getAttribute("data-approval-stamp")).toBe("approved");
    expect(status.textContent).toBe("Approved");
    expect(onRespond).toHaveBeenCalledTimes(3);
  });
});

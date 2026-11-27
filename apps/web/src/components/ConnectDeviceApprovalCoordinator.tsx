import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useNavigate } from "@tanstack/react-router";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { unseenConnectDevices } from "@t3tools/client-runtime/connect-device-notices";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { ShieldCheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { msg, T, Var } from "gt-react";

import { readLocalStorageValue, writeLocalStorageValue } from "../hooks/useLocalStorage";
import { m } from "../i18n/messages";
import { authEnvironment } from "../state/auth";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { describeConnectDeviceClient } from "./settings/ConnectionsSettings.logic";
import { toastManager } from "./ui/toast";
import { stackedThreadToast } from "./ui/toastHelpers";

function formatGroupedVerificationCode(code: string): string {
  const trimmed = code.trim();
  if (trimmed.includes("-")) {
    return trimmed
      .split("-")
      .filter((part) => part.length > 0)
      .join(" · ");
  }
  if (/^\d{6}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)} · ${trimmed.slice(3)}`;
  }
  return trimmed;
}

/**
 * Asks whoever can approve to look at T3 Connect devices waiting on an environment, and tells
 * them about devices that got in without approval.
 */
export function ConnectDeviceApprovalCoordinator() {
  const { environments } = useEnvironments();
  return environments.map((environment) =>
    environment.connection.phase === "connected" && environment.serverConfig ? (
      <EnvironmentConnectDevices
        key={environment.environmentId}
        environmentId={environment.environmentId}
        environmentLabel={environment.label}
        approvalRequired={environment.serverConfig.settings.requireConnectDeviceApproval}
      />
    ) : null,
  );
}

function EnvironmentConnectDevices({
  approvalRequired,
  ...props
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly approvalRequired: boolean;
}) {
  const canApprove = useEnvironmentScope(props.environmentId, AuthAccessWriteScope);
  if (!canApprove) return null;
  return (
    <>
      {approvalRequired ? <ConnectDeviceRequestToasts {...props} /> : null}
      <NewConnectDeviceToast {...props} announce={!approvalRequired} />
    </>
  );
}

const CONNECT_DEVICES_SEEN_KEY = "t3code:connect-devices-seen-through";
const ConnectDevicesSeenThrough = Schema.Record(Schema.String, Schema.Number);

/** Devices approved by hand are already known, so only `announce` hosts that skip approval. */
function NewConnectDeviceToast({
  environmentId,
  environmentLabel,
  announce,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly announce: boolean;
}) {
  const navigate = useNavigate();
  const access = useEnvironmentQuery(authEnvironment.accessChanges({ environmentId, input: null }));
  // Older servers omit the list.
  const devices =
    access.data?.type === "snapshot" ? (access.data.payload.connectDevices ?? null) : null;
  const shown = useRef<{ toastId: string; renderedKey: string } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens, updates and closes an imperative toastManager toast to match devices this client has not announced
  useEffect(() => {
    if (devices === null) return;
    const seenThrough = readLocalStorageValue(
      CONNECT_DEVICES_SEEN_KEY,
      {},
      ConnectDevicesSeenThrough,
    )[environmentId];
    const { unseen, newest } = unseenConnectDevices(devices, seenThrough);
    const markSeen = () =>
      writeLocalStorageValue(
        CONNECT_DEVICES_SEEN_KEY,
        (current) => ({
          ...current,
          [environmentId]: Math.max(current[environmentId] ?? 0, newest),
        }),
        {},
        ConnectDevicesSeenThrough,
      );
    const close = () => {
      if (shown.current) toastManager.close(shown.current.toastId);
      shown.current = null;
    };
    if (!announce || unseen.length === 0) {
      close();
      if (seenThrough !== newest) markSeen();
      return;
    }
    const renderedKey = unseen.map((device) => device.proofKeyThumbprint).join(",");
    if (shown.current?.renderedKey === renderedKey) return;
    const [first] = unseen;
    const options = stackedThreadToast({
      type: "warning",
      title: m(msg("New device signed in to {environmentLabel}", { environmentLabel })),
      description:
        unseen.length === 1 && first
          ? m(
              msg("{device} connected through {product}. Not you? Review it.", {
                device: describeConnectDeviceClient(first),
                product: "T3 Connect",
              }),
            )
          : m(
              msg(
                "{count, plural, one {{count} device} other {{count} devices}} connected through {product}. Not you? Review them.",
                { count: unseen.length, product: "T3 Connect" },
              ),
            ),
      timeout: 0,
      actionProps: {
        children: m(msg("Review", { $context: "verb, opens the device in settings" })),
        onClick: () => {
          markSeen();
          close();
          void navigate({ to: "/settings/access", search: { machine: environmentId } });
        },
      },
      data: {
        hideCopyButton: true,
        onClose: () => {
          markSeen();
          // A dismissed toast is gone, so the next unseen device needs a new one.
          if (shown.current?.renderedKey === renderedKey) shown.current = null;
        },
      },
    });
    if (shown.current) {
      toastManager.update(shown.current.toastId, options);
      shown.current = { toastId: shown.current.toastId, renderedKey };
    } else {
      shown.current = { toastId: toastManager.add(options), renderedKey };
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes this environment's imperative toast when it goes away
  useEffect(
    () => () => {
      if (shown.current) toastManager.close(shown.current.toastId);
    },
    [],
  );

  return null;
}

/** Reports a failed command and says whether it failed, so its request can be offered again. */
async function reportFailure(
  title: string,
  action: () => Promise<AtomCommandResult<unknown, unknown>>,
): Promise<boolean> {
  const result = await action();
  if (result._tag !== "Failure") return false;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: thrownErrorMessage(error, m) ?? m(msg("An error occurred.")),
      }),
    );
  }
  return true;
}

export const CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS = 700;

interface TrackedDeviceRequestToast {
  readonly toastId: string;
  readonly renderedKey: string;
  readonly presentedAt: number;
  armed: boolean;
  decided: boolean;
  armTimer: number | null;
}

function clearTrackedArmTimer(tracked: TrackedDeviceRequestToast) {
  if (tracked.armTimer !== null) {
    window.clearTimeout(tracked.armTimer);
    tracked.armTimer = null;
  }
}

function ConnectDeviceRequestToasts({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const navigate = useNavigate();
  const access = useEnvironmentQuery(authEnvironment.accessChanges({ environmentId, input: null }));
  const approve = useAtomCommand(authEnvironment.approveConnectDevice, { reportFailure: false });
  const deny = useAtomCommand(authEnvironment.revokePairingLink, { reportFailure: false });
  const toasts = useRef(new Map<string, TrackedDeviceRequestToast>());
  const [, setRetryGeneration] = useState(0);
  // A failed approve or deny forgets its toast and re-renders, so the request is offered again.
  const settle = async (id: string, failed: Promise<boolean>) => {
    if (!(await failed)) return;
    const current = toasts.current.get(id);
    if (current) clearTrackedArmTimer(current);
    toasts.current.delete(id);
    setRetryGeneration((generation) => generation + 1);
  };

  const requests =
    access.data?.type === "snapshot"
      ? access.data.payload.pairingLinks.flatMap((link) =>
          link.connectDeviceRequest
            ? [{ id: link.id, request: link.connectDeviceRequest, expiresAt: link.expiresAt }]
            : [],
        )
      : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens, updates and closes imperative toastManager toasts to match the pending requests
  useEffect(() => {
    if (requests === null) return;
    // The server publishes no event when a request expires, so the toast ends itself then.
    const now = Date.now();
    const live = requests.flatMap((entry) => {
      const expiresAtMs = DateTime.toEpochMillis(entry.expiresAt);
      const remainingMs = expiresAtMs - now;
      return remainingMs > 0 ? [{ ...entry, expiresAtMs, remainingMs }] : [];
    });
    const pendingIds = new Set(live.map(({ id }) => id));
    for (const [id, tracked] of toasts.current) {
      if (pendingIds.has(id)) continue;
      clearTrackedArmTimer(tracked);
      toastManager.close(tracked.toastId);
      toasts.current.delete(id);
    }
    for (const { id, request, expiresAtMs, remainingMs } of live) {
      const device = describeConnectDeviceClient(request);
      const renderedKey = `${request.verificationCode}:${device}`;
      const tracked = toasts.current.get(id);
      if (tracked?.renderedKey === renderedKey) continue;
      if (tracked) clearTrackedArmTimer(tracked);
      const close = () => {
        const current = toasts.current.get(id);
        if (!current) return;
        clearTrackedArmTimer(current);
        toastManager.close(current.toastId);
      };
      const handleApprove = () => {
        const current = toasts.current.get(id);
        if (
          !current ||
          current.renderedKey !== renderedKey ||
          current.decided ||
          !current.armed ||
          Date.now() - current.presentedAt < CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS
        ) {
          return;
        }
        current.decided = true;
        close();
        void settle(
          id,
          reportFailure(m(msg("Could not approve the device")), () =>
            approve({ environmentId, input: { pairingLinkId: id } }),
          ),
        );
      };
      const handleDeny = () => {
        const current = toasts.current.get(id);
        if (!current || current.renderedKey !== renderedKey || current.decided) {
          return;
        }
        current.decided = true;
        close();
        void settle(
          id,
          reportFailure(m(msg("Could not deny the device")), () =>
            deny({ environmentId, input: { id } }),
          ),
        );
      };
      const groupedCode = formatGroupedVerificationCode(request.verificationCode);
      const buildOptions = (armed: boolean, timeoutMs: number) =>
        stackedThreadToast({
          type: "info",
          title: m(msg("A device wants to connect to {environmentLabel}", { environmentLabel })),
          description: (
            <div className="mt-1 space-y-2">
              <p className="text-xs text-muted-foreground">
                <T>
                  <Var>{device}</Var>. Approve only if it shows this code:
                </T>
              </p>
              <div className="inline-flex items-center rounded-md border border-border/75 bg-muted/45 px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-foreground tabular-nums">
                {groupedCode}
              </div>
            </div>
          ),
          timeout: timeoutMs,
          actionProps: {
            children: m(msg("Approve")),
            disabled: !armed,
            onClick: handleApprove,
          },
          data: {
            leadingIcon: <ShieldCheckIcon className="size-4 text-primary" aria-hidden />,
            hideCopyButton: true,
            onClose: () => {
              const current = toasts.current.get(id);
              if (current?.renderedKey === renderedKey) clearTrackedArmTimer(current);
            },
            secondaryActionProps: {
              children: m(msg("Deny")),
              onClick: handleDeny,
            },
            additionalActions: [
              {
                id: "review",
                props: {
                  children: m(msg("Review", { $context: "verb, opens the device in settings" })),
                  onClick: () =>
                    void navigate({ to: "/settings/access", search: { machine: environmentId } }),
                },
              },
            ],
          },
        });
      const initialOptions = buildOptions(false, remainingMs);
      const toastId = tracked ? tracked.toastId : toastManager.add(initialOptions);
      if (tracked) {
        toastManager.update(toastId, initialOptions);
      }
      const nextTracked: TrackedDeviceRequestToast = {
        toastId,
        renderedKey,
        presentedAt: now,
        armed: false,
        decided: false,
        armTimer: null,
      };
      nextTracked.armTimer = window.setTimeout(() => {
        const current = toasts.current.get(id);
        if (current !== nextTracked || current.decided) return;
        current.armTimer = null;
        const remainingAfterArmMs = expiresAtMs - Date.now();
        if (remainingAfterArmMs <= 0) {
          toastManager.close(current.toastId);
          toasts.current.delete(id);
          return;
        }
        current.armed = true;
        toastManager.update(current.toastId, buildOptions(true, remainingAfterArmMs));
      }, CONNECT_DEVICE_APPROVAL_ARM_DELAY_MS);
      toasts.current.set(id, nextTracked);
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes this environment's imperative toasts when it stops needing approval
  useEffect(() => {
    const tracked = toasts.current;
    return () => {
      for (const entry of tracked.values()) {
        clearTrackedArmTimer(entry);
        toastManager.close(entry.toastId);
      }
      tracked.clear();
    };
  }, []);

  return null;
}

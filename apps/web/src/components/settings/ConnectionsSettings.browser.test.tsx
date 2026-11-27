import {
  AuthAccessReadScope,
  AuthSessionId,
  EnvironmentId,
  type AuthClientSession,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../../test/render";
import { ConnectionsSettings, selectNewestArrivedNonCurrentSession } from "./ConnectionsSettings";
import { toDesktopClientSessionRecord } from "./ConnectionsSettings.logic";

const environmentId = EnvironmentId.make("env-access");

const mockState = vi.hoisted(() => {
  let clientSessions: ReadonlyArray<AuthClientSession> = [];
  const listeners = new Set<() => void>();
  return {
    getClientSessions: () => clientSessions,
    setClientSessions(next: ReadonlyArray<AuthClientSession>) {
      clientSessions = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [
      {
        environmentId,
        label: "Desk Mac",
        entry: {
          enabled: true,
          target: { _tag: "PrimaryConnectionTarget" },
        },
        connection: { phase: "connected" as const },
        serverConfig: null,
      },
    ],
  })) as never,
  usePrimaryEnvironment: (() => ({
    environmentId,
    label: "Desk Mac",
    entry: {
      enabled: true,
      target: { _tag: "PrimaryConnectionTarget" },
    },
    connection: { phase: "connected" as const },
    serverConfig: null,
  })) as never,
  useEnvironment: (() => ({
    environmentId,
    label: "Desk Mac",
    entry: {
      enabled: true,
      target: { _tag: "PrimaryConnectionTarget" },
    },
    connection: { phase: "connected" as const },
    serverConfig: null,
  })) as never,
  usePrimaryEnvironmentId: (() => environmentId) as never,
}));

vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: ((_id: unknown, scope: string) => scope === AuthAccessReadScope) as never,
  useEnvironmentSessionState: (() => ({
    data: {
      authenticated: true,
      scopes: [AuthAccessReadScope],
      permissions: [AuthAccessReadScope],
      auth: { policy: "remote-reachable" as const },
    },
  })) as never,
}));

vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: unknown) => {
    const clientSessions = useSyncExternalStore(mockState.subscribe, mockState.getClientSessions);
    return query === null
      ? { data: null, error: null, isPending: false }
      : {
          data: {
            type: "snapshot" as const,
            payload: {
              pairingLinks: [],
              clientSessions,
              connectDevices: [],
            },
          },
          error: null,
          isPending: false,
        };
  }) as never,
}));

vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() =>
    vi.fn(async () => ({ _tag: "Success" as const, value: undefined }))) as never,
}));

vi.mock(import("~/state/peerLinks"), async (original) => ({
  ...(await original()),
  usePeerLinkHosts: (() => []) as never,
}));

function makeSession(input: {
  readonly id: string;
  readonly label: string;
  readonly issuedAt: string;
  readonly current?: boolean;
  readonly connected?: boolean;
}): AuthClientSession {
  return {
    sessionId: AuthSessionId.make(input.id),
    subject: input.id,
    scopes: [],
    method: "bearer-access-token",
    client: {
      label: input.label,
      deviceType: "mobile",
      os: "iOS",
      browser: "Rutico",
    },
    issuedAt: DateTime.makeUnsafe(input.issuedAt),
    expiresAt: DateTime.makeUnsafe("2026-11-28T10:00:00.000Z"),
    lastConnectedAt: DateTime.makeUnsafe(input.issuedAt),
    connected: input.connected ?? true,
    current: input.current ?? false,
  };
}

describe("ConnectionsSettings pairing arrival banner", () => {
  it("shows the newer device label when a snapshot introduces two connected non-current sessions at different issuedAt timestamps", async () => {
    const currentSession = makeSession({
      id: "sess-current",
      label: "This Mac",
      issuedAt: "2026-11-27T09:00:00.000Z",
      current: true,
    });
    const olderArrived = makeSession({
      id: "sess-older",
      label: "Older Pixel 8",
      issuedAt: "2026-11-27T10:01:00.000Z",
    });
    const newerArrived = makeSession({
      id: "sess-newer",
      label: "Newer iPhone 17",
      issuedAt: "2026-11-27T10:05:00.000Z",
    });

    mockState.setClientSessions([currentSession]);
    await using screen = await render(<ConnectionsSettings view="access" />);

    expect(screen.container.querySelector('[data-slot="pairing-emerald-bloom"]')).toBeNull();

    // Deliver a snapshot introducing both connected non-current sessions together.
    // `sortDesktopClientSessions` orders newest-first (Newer iPhone 17 before Older Pixel 8).
    await act(() => {
      mockState.setClientSessions([currentSession, olderArrived, newerArrived]);
    });

    const bloom = screen.container.querySelector<HTMLElement>(
      '[data-slot="pairing-emerald-bloom"]',
    );
    expect(bloom).not.toBeNull();
    expect(bloom?.textContent).toContain("Device paired");
    expect(bloom?.textContent).toContain("Newer iPhone 17");
    expect(bloom?.textContent).not.toContain("Older Pixel 8");
  });

  it("selects the arrived non-current session with the greatest issuedAt regardless of list order", () => {
    const current = toDesktopClientSessionRecord(
      makeSession({
        id: "sess-cur",
        label: "Current Host",
        issuedAt: "2026-11-27T12:00:00.000Z",
        current: true,
      }),
    );
    const older = toDesktopClientSessionRecord(
      makeSession({
        id: "sess-old",
        label: "Older Device",
        issuedAt: "2026-11-27T10:01:00.000Z",
      }),
    );
    const newer = toDesktopClientSessionRecord(
      makeSession({
        id: "sess-new",
        label: "Newer Device",
        issuedAt: "2026-11-27T10:05:00.000Z",
      }),
    );

    expect(selectNewestArrivedNonCurrentSession([current, newer, older], null)?.sessionId).toBe(
      newer.sessionId,
    );
    expect(selectNewestArrivedNonCurrentSession([older, newer, current], null)?.sessionId).toBe(
      newer.sessionId,
    );
    // An older late arrival must not overwrite an already-newer recent paired session.
    expect(selectNewestArrivedNonCurrentSession([older], newer)?.sessionId).toBe(newer.sessionId);
  });
});

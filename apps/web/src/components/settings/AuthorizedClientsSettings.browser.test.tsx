import {
  AuthSessionId,
  EnvironmentId,
  managedCapabilityDenial,
  type ManagedPolicySummary,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { fakeTimers, render } from "../../../test/render";
import { AuthorizedClientsHeaderAction, PairingClientsList } from "./AuthorizedClientsSettings";

const localId = EnvironmentId.make("local");
const serviceId = EnvironmentId.make("service");

const state = vi.hoisted(() => ({
  primaryEnvironmentId: null as string | null,
  policies: new Map<string, unknown>(),
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => state.primaryEnvironmentId) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useServerConfigs: (() =>
    new Map(
      [...state.policies].map(([environmentId, managedPolicy]) => [
        environmentId,
        { managedPolicy },
      ]),
    )) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));

const remoteClientsOff: ManagedPolicySummary = {
  organization: "Example Corp",
  lockedSettings: [],
  limits: { clients: ["desktop"] },
};

function setup(policies: ReadonlyArray<readonly [EnvironmentId, ManagedPolicySummary]>) {
  state.primaryEnvironmentId = localId;
  state.policies = new Map(policies);
}

const renderHeader = (environmentId: EnvironmentId) =>
  render(
    <AuthorizedClientsHeaderAction
      environmentId={environmentId}
      onPairingLinkCreated={() => {}}
      clientSessions={null}
      isRevokingOtherClients={false}
      onRevokeOtherClients={() => {}}
      delegatableScopes={[]}
    />,
  );

describe("AuthorizedClientsHeaderAction", () => {
  const denial = managedCapabilityDenial(remoteClientsOff, "remoteClients")!;

  it("follows the selected service's policy, not the primary's", async () => {
    setup([[serviceId, remoteClientsOff]]);
    await using screen = await renderHeader(serviceId);

    await expect.element(screen.getByRole("group", { name: denial })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
  });

  it("leaves pairing open on an unmanaged service when the primary is managed", async () => {
    setup([[localId, remoteClientsOff]]);
    await using screen = await renderHeader(serviceId);

    await expect.element(screen.getByRole("button", { name: "Create link" })).toBeEnabled();
    expect(screen.getByRole("group", { name: denial }).query()).toBeNull();
  });
});

describe("PairingClientsList QR expiry ring and emerald paired bloom", () => {
  it("renders a branded QR with radial expiry ring shifting amber under 30s and emerald bloom on arrival", async () => {
    const fixedNowMs = Date.parse("2026-10-23T10:05:00.000Z");
    using _timers = fakeTimers({ now: fixedNowMs });
    const createdAt = new Date(fixedNowMs - 280_000).toISOString();
    const expiresAt = new Date(fixedNowMs + 20_000).toISOString();
    const session = {
      sessionId: AuthSessionId.make("sess-android-1"),
      subject: "pixel-9",
      scopes: [],
      method: "bearer-access-token" as const,
      client: {
        label: "Pixel 9",
        deviceType: "mobile" as const,
        os: "Android",
        browser: "Rutico",
      },
      issuedAt: new Date(fixedNowMs).toISOString(),
      expiresAt: new Date(fixedNowMs + 86_400_000).toISOString(),
      lastConnectedAt: new Date(fixedNowMs).toISOString(),
      connected: true,
      current: false,
    };

    await using screen = await render(
      <PairingClientsList
        servedByEnvironment
        endpointUrl="http://192.168.1.42:3773"
        endpoints={[]}
        defaultEndpointKey={null}
        isLoading={false}
        pairingLinks={[
          {
            id: "link-1",
            subject: "pairing",
            scopes: [],
            label: "Pixel 9",
            createdAt,
            expiresAt,
          },
        ]}
        createdPairingCredentials={new Map([["link-1", "secret-token-123"]])}
        sharedPairingLinkId="link-1"
        clientSessions={[session]}
        recentPairedSession={session}
        newlyPairedSessionIds={new Set([session.sessionId])}
        revokingPairingLinkId={null}
        revokingClientSessionId={null}
        onRevokePairingLink={() => {}}
        onRevokeClientSession={() => {}}
        canRevoke
      />,
    );

    const qrSvg = screen.container.querySelector<SVGSVGElement>('svg[data-qr-variant="branded"]');
    expect(qrSvg).not.toBeNull();
    expect(qrSvg?.querySelector('[data-slot="qr-finder-eyes"]')).not.toBeNull();

    const expiryRing = screen.container.querySelector<SVGRectElement>(
      '[data-slot="pairing-expiry-ring-arc"]',
    );
    expect(expiryRing).not.toBeNull();
    expect(expiryRing?.dataset.urgent).toBe("true");
    expect(Number(expiryRing?.getAttribute("stroke-dashoffset"))).toBeGreaterThan(0);

    const bloom = screen.container.querySelector('[data-slot="pairing-emerald-bloom"]');
    expect(bloom).not.toBeNull();
    await expect.element(screen.getByText("Device paired")).toBeVisible();

    const clientRow = screen.container.querySelector<HTMLElement>(
      '[data-slot="pairing-client-row"][data-newly-paired="true"]',
    );
    expect(clientRow).not.toBeNull();
  });
});

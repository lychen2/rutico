import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";
import "~/styles/pairing-motion.css";

export const Route = createFileRoute("/pair")({
  beforeLoad: async ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status === "hosted-pairing") {
      return {
        authGateState,
      };
    }

    if (
      authGateState.status === "authenticated" ||
      authGateState.status === "hosted-static" ||
      authGateState.status === "guest"
    ) {
      throw redirect({ to: "/", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const router = useRouter();
  const { authGateState } = Route.useRouteContext();

  if (!authGateState) {
    return null;
  }

  if (authGateState.status === "hosted-pairing") {
    return (
      <div data-slot="pairing-route-stage" className="h-full">
        <HostedPairingRouteSurface />
      </div>
    );
  }

  return (
    <div data-slot="pairing-route-stage" className="h-full">
      <PairingRouteSurface
        auth={authGateState.auth}
        onAuthenticated={() => {
          // Recreate the connection so WebSocket and cached scopes use the new pairing cookie.
          router.history.replace("/");
          router.history.flush();
          window.location.reload();
        }}
        {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
      />
    </div>
  );
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}

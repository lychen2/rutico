import { createFileRoute } from "@tanstack/react-router";

import { ConnectAgentSurface } from "../components/auth/ConnectAgentSurface";
import "~/styles/pairing-motion.css";

function ConnectAgentRouteView() {
  return (
    <div data-slot="pairing-route-stage" className="h-full">
      <ConnectAgentSurface />
    </div>
  );
}

export const Route = createFileRoute("/connect-agent")({
  component: ConnectAgentRouteView,
});

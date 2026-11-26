import { createFileRoute, redirect } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { ApproveAgentSurface } from "../components/auth/ApproveAgentSurface";
import { isHostedStaticApp } from "../hostedPairing";
import "~/styles/pairing-motion.css";

function ApproveAgentRouteView() {
  return (
    <div data-slot="pairing-route-stage" className="h-full">
      <ApproveAgentSurface />
    </div>
  );
}

export const Route = createFileRoute("/approve-agent")({
  beforeLoad: () => {
    if (!isHostedStaticApp() || !hasCloudPublicConfig()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ApproveAgentRouteView,
});

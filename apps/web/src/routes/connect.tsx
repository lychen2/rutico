import { createFileRoute, redirect } from "@tanstack/react-router";

import { connectCliAuthRoutesEnabled } from "../cloud/connectCliAuth";
import { ConnectCliAuthorizeSurface } from "../components/cloud/ConnectCliAuthSurface";
import "~/styles/pairing-motion.css";

function ConnectCliRouteView() {
  return (
    <div data-slot="pairing-route-stage" className="h-full">
      <ConnectCliAuthorizeSurface />
    </div>
  );
}

export const Route = createFileRoute("/connect")({
  beforeLoad: () => {
    if (!connectCliAuthRoutesEnabled()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ConnectCliRouteView,
});

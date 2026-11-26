import { createFileRoute } from "@tanstack/react-router";

import { GuestPage } from "../components/guest/GuestPage";
import "~/styles/pairing-motion.css";

function GuestRouteView() {
  return (
    <div data-slot="pairing-route-stage" className="h-dvh">
      <GuestPage />
    </div>
  );
}

export const Route = createFileRoute("/guest")({
  component: GuestRouteView,
});

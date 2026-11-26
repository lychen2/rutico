import { requireOptionalNativeModule } from "expo";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import type { SubscriptionUsageSnapshot } from "./subscriptionUsageSnapshot";

let tapUrl: string | undefined;
let listening = false;

export async function publishSubscriptionUsage(snapshot: SubscriptionUsageSnapshot) {
  if (!requireOptionalNativeModule("ExpoWidgets")) return;
  const [{ default: widget }, { addUserInteractionListener }] = await Promise.all([
    import("./SubscriptionUsage"),
    import("expo-widgets"),
  ]);
  tapUrl = snapshot.url;
  if (!listening) {
    // expo-widgets lacks Android widgetURL. Button events need a live JS runtime to open the app.
    listening = true;
    addUserInteractionListener((event) => {
      if (event.source === "SubscriptionUsage" && tapUrl) void tryOpenExternalUrl(tapUrl);
    });
  }
  const widgetExpiry = requireOptionalNativeModule<{
    schedule: (name: string, deadlines: number[]) => void;
    setLaunchUrl?: (name: string, url: string | null) => void;
  }>("T3WidgetExpiry");
  // Persist the active Usage deep link so the native Glance provider opens Rutico from cold start.
  widgetExpiry?.setLaunchUrl?.("SubscriptionUsage", snapshot.url ?? null);
  widget.updateSnapshot(snapshot);
  // Android lacks timelines; alarms re-render snapshots at expiry to mark readings stale.
  widgetExpiry?.schedule(
    "SubscriptionUsage",
    snapshot.providers.map((provider) => provider.expiresAt).filter((at) => at > 0),
  );
}

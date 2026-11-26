import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const plugin = require("./withAndroidWidgetDeepLink.cjs") as {
  patchSubscriptionUsageProvider: (
    source: string,
    androidPackage: string,
    primaryScheme: string,
  ) => string;
  resolvePrimaryScheme: (scheme: string | string[] | undefined) => string;
  MARKER: string;
};

const GENERATED_PROVIDER = `package com.t3tools.t3code.dev

import expo.modules.widgets.ExpoWidgetsAppWidgetProvider

class SubscriptionUsageProvider : ExpoWidgetsAppWidgetProvider("SubscriptionUsage")
`;

describe("withAndroidWidgetDeepLink", () => {
  it("resolves primary scheme from array, string, or fallback", () => {
    expect(plugin.resolvePrimaryScheme(["rutico-dev", "t3code-dev"])).toBe("rutico-dev");
    expect(plugin.resolvePrimaryScheme("rutico")).toBe("rutico");
    expect(plugin.resolvePrimaryScheme(undefined)).toBe("rutico");
  });

  it("upgrades generated SubscriptionUsageProvider with BAL-compliant actionStartActivity idempotently", () => {
    const first = plugin.patchSubscriptionUsageProvider(
      GENERATED_PROVIDER,
      "com.t3tools.t3code.dev",
      "rutico-dev",
    );
    expect(first).toContain(plugin.MARKER);
    expect(first).toContain("import androidx.glance.appwidget.action.actionStartActivity");
    expect(first).toContain('fallbackUrl = "rutico-dev://settings/usage?tab=limits"');
    expect(first).toContain('getSharedPreferences("expo.modules.t3widgetexpiry.LAUNCH_URLS"');
    expect(first).toContain("replaceActionModifiers(root, launchAction)");
    // Must never launch an Activity from a BroadcastReceiver trampoline (BAL violation).
    expect(first).not.toContain("startActivity(");

    const second = plugin.patchSubscriptionUsageProvider(
      first,
      "com.t3tools.t3code.dev",
      "rutico-dev",
    );
    expect(second).toBe(first);
  });
});

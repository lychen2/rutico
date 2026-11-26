import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { compileModsAsync } from "expo/config-plugins";
import { afterEach, describe, expect, it } from "vite-plus/test";

import withAndroidPredictiveBackCompat from "./withAndroidPredictiveBackCompat.cjs";

const MAIN_ACTIVITY = `package com.t3tools.t3code

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
    super.invokeDefaultOnBackPressed()
  }
}
`;

const projectRoots: string[] = [];

afterEach(() => {
  for (const root of projectRoots.splice(0)) {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

async function prebuild(mainActivity = MAIN_ACTIVITY, predictiveBackGestureEnabled = true) {
  const projectRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "predictive-back-compat-"));
  projectRoots.push(projectRoot);
  const activityPath = NodePath.join(
    projectRoot,
    "android/app/src/main/java/com/t3tools/t3code/MainActivity.kt",
  );
  NodeFS.mkdirSync(NodePath.dirname(activityPath), { recursive: true });
  NodeFS.writeFileSync(activityPath, mainActivity);

  const config = withAndroidPredictiveBackCompat({
    name: "Rutico",
    slug: "t3-code",
    android: { predictiveBackGestureEnabled },
  });
  await compileModsAsync(config, {
    projectRoot,
    platforms: ["android"],
  });
  return NodeFS.readFileSync(activityPath, "utf8");
}

describe("withAndroidPredictiveBackCompat", () => {
  it("bridges BackEventCompat start/progress/cancel/commit exclusively on API 33-35 and stays idempotent", async () => {
    const once = await prebuild();

    expect(once).toContain("import androidx.activity.BackEventCompat");
    expect(once).toContain("import androidx.activity.OnBackPressedCallback");
    expect(once).toContain("override fun handleOnBackStarted(backEvent: BackEventCompat)");
    expect(once).toContain("override fun handleOnBackProgressed(backEvent: BackEventCompat)");
    expect(once).toContain("override fun handleOnBackCancelled()");
    expect(once).toContain("override fun handleOnBackPressed()");
    expect(once).toContain(
      "Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA",
    );
    expect(once).toContain('emit("t3PredictiveBack", payload)');
    expect(once).toContain("invokeDefaultOnBackPressedLegacy()");

    // Repeated prebuild must remain identical.
    expect(await prebuild(once)).toBe(once);
  });

  it("is a no-op when predictiveBackGestureEnabled is disabled", async () => {
    expect(await prebuild(MAIN_ACTIVITY, false)).toBe(MAIN_ACTIVITY);
  });
});

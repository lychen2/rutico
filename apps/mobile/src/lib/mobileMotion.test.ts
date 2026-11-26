// @effect-diagnostics nodeBuiltinImport:off - Node unit test asserting Wave 2 Reanimated/ReduceMotion source invariants.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

const rnAnimatedHarness = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setValue: vi.fn(),
}));

vi.mock("react-native", () => ({
  Animated: {
    Value: class MockValue {
      setValue = rnAnimatedHarness.setValue;
    },
    loop: () => ({ start: rnAnimatedHarness.start, stop: rnAnimatedHarness.stop }),
    sequence: (items: unknown[]) => items,
    timing: () => ({}),
  },
  Easing: {
    inOut: (fn: unknown) => fn,
    out: (fn: unknown) => fn,
    quad: (v: number) => v,
    sin: (v: number) => v,
  },
}));

vi.mock("react-native-reanimated", () => ({
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
}));

import { Animated as RNAnimated } from "react-native";
import { ReduceMotion } from "react-native-reanimated";
import {
  SPRING_DETENT_SNAP,
  SPRING_EFFECTS_FAST,
  SPRING_SPATIAL_GENTLE,
  SPRING_SPATIAL_SNAPPY,
  TIMING_QUICK_FADE,
  TIMING_STANDARD_ENTER,
  concentricRadius,
  projectOffset,
  rubberBandClamp,
  snapToNearestDetent,
  startNativePulseLoop,
  withVelocitySpringConfig,
} from "./mobileMotion";

describe("mobileMotion presets", () => {
  it("binds ReduceMotion.System inside every Material 3 spring and timing preset", () => {
    for (const preset of [
      SPRING_SPATIAL_SNAPPY,
      SPRING_SPATIAL_GENTLE,
      SPRING_EFFECTS_FAST,
      SPRING_DETENT_SNAP,
    ]) {
      expect(preset.reduceMotion).toBe(ReduceMotion.System);
      expect(preset.damping).toBeGreaterThan(0);
      expect(preset.stiffness).toBeGreaterThan(0);
      expect(preset.mass).toBeGreaterThan(0);
    }

    for (const timing of [TIMING_QUICK_FADE, TIMING_STANDARD_ENTER]) {
      expect(timing.reduceMotion).toBe(ReduceMotion.System);
      expect(timing.duration).toBeGreaterThan(0);
    }
  });

  it("injects velocity while preserving ReduceMotion.System", () => {
    const config = withVelocitySpringConfig(SPRING_SPATIAL_SNAPPY, 1250);
    expect(config.velocity).toBe(1250);
    expect(config.reduceMotion).toBe(ReduceMotion.System);
    expect(config.stiffness).toBe(SPRING_SPATIAL_SNAPPY.stiffness);
  });
});

describe("rubberBandClamp", () => {
  it("returns exact identity values inside [min, max]", () => {
    expect(rubberBandClamp(0, -100, 100)).toBe(0);
    expect(rubberBandClamp(-100, -100, 100)).toBe(-100);
    expect(rubberBandClamp(100, -100, 100)).toBe(100);
    expect(rubberBandClamp(42.5, -100, 100)).toBe(42.5);
  });

  it("applies monotonic asymptotic damping beyond upper and lower bounds", () => {
    const overSmall = rubberBandClamp(120, 0, 100, 320, 0.22);
    const overLarge = rubberBandClamp(500, 0, 100, 320, 0.22);
    expect(overSmall).toBeGreaterThan(100);
    expect(overSmall).toBeLessThan(120);
    expect(overLarge).toBeGreaterThan(overSmall);
    expect(overLarge).toBeLessThan(100 + 320);

    const underSmall = rubberBandClamp(-20, 0, 100, 320, 0.22);
    const underLarge = rubberBandClamp(-400, 0, 100, 320, 0.22);
    expect(underSmall).toBeLessThan(0);
    expect(underSmall).toBeGreaterThan(-20);
    expect(underLarge).toBeLessThan(underSmall);
    expect(underLarge).toBeGreaterThan(-320);
  });
});

describe("projectOffset and detents", () => {
  it("projects resting offset using 0.998 exponential deceleration", () => {
    expect(projectOffset(100, 0)).toBe(100);
    // (1000 / 1000) * 0.998 / 0.002 = 499
    expect(projectOffset(100, 1000, 0.998)).toBeCloseTo(599, 2);
    expect(projectOffset(100, -1000, 0.998)).toBeCloseTo(-399, 2);
  });

  it("snaps projected offsets to the nearest detent", () => {
    expect(snapToNearestDetent(130, [0, 160, 320])).toBe(160);
    expect(snapToNearestDetent(45, [0, 160, 320])).toBe(0);
    expect(snapToNearestDetent(290, [0, 160, 320])).toBe(320);
  });

  it("computes concentric inner corner radius with a safe floor", () => {
    expect(concentricRadius(16, 6)).toBe(10);
    expect(concentricRadius(10, 12)).toBe(4);
  });
});

describe("startNativePulseLoop", () => {
  it("starts and stops RN Animated loop only when active", () => {
    rnAnimatedHarness.start.mockClear();
    rnAnimatedHarness.stop.mockClear();
    rnAnimatedHarness.setValue.mockClear();

    const value = new RNAnimated.Value(0);
    const stopInactive = startNativePulseLoop(value, { active: false });
    expect(rnAnimatedHarness.start).not.toHaveBeenCalled();
    stopInactive();

    const stopActive = startNativePulseLoop(value, { active: true, mode: "breathe" });
    expect(rnAnimatedHarness.start).toHaveBeenCalledTimes(1);
    stopActive();
    expect(rnAnimatedHarness.stop).toHaveBeenCalledTimes(1);
  });
});

const MOBILE_ROOT = NodePath.resolve(import.meta.dirname, "../..");

const WAVE2_TOUCHED_MOBILE_MOTION_FILES = [
  "src/components/ComposerSurface.tsx",
  "src/components/ScrollComposeButton.android.tsx",
  "src/components/ui/AndroidAnchoredMenu.android.tsx",
  "src/components/ui/Dialog.android.tsx",
  "src/components/ui/FloatingActionButton.android.tsx",
  "src/components/ui/FrostedCutout.android.tsx",
  "src/components/ui/GlassSurface.tsx",
  "src/components/ui/MenuPopup.android.tsx",
  "src/components/ui/PaneSheet.android.tsx",
  "src/components/ui/RowPressable.tsx",
  "src/components/ui/Sheet.android.tsx",
  "src/components/ui/SheetHeader.android.tsx",
  "src/components/ui/SliderRow.android.tsx",
  "src/components/ui/Toast.tsx",
  "src/features/browser/ThreadBrowserFloat.tsx",
  "src/features/cloud/ConnectOnboardingRouteScreen.tsx",
  "src/features/connection/ConnectDeviceApprovalCoordinator.tsx",
  "src/features/connection/ConnectionsNewRouteScreen.tsx",
  "src/features/connection/ConnectionsRouteScreen.tsx",
  "src/features/home/AndroidHomeFab.android.tsx",
  "src/features/home/HomeRouteScreen.tsx",
  "src/features/home/HomeScreen.tsx",
  "src/features/home/thread-swipe-actions.tsx",
  "src/features/home/ThreadUndoNotice.tsx",
  "src/features/layout/AdaptiveWorkspaceLayout.tsx",
  "src/features/layout/AndroidPaseoPanels.android.tsx",
  "src/features/layout/workspace/AndroidWorkspaceNavigation.android.tsx",
  "src/features/layout/workspace/AndroidWorkspaceSidebar.android.tsx",
  "src/features/layout/workspace/ListSearchToolbar.android.tsx",
  "src/features/pull-requests/PullRequestMergeControls.tsx",
  "src/features/pull-requests/PullRequestRouteScreen.tsx",
  "src/features/review/ReviewCommentComposerSheet.tsx",
  "src/features/review/ReviewSheet.tsx",
  "src/features/threads/ComposerCommandPopover.tsx",
  "src/features/threads/CustomSnoozeSheet.android.tsx",
  "src/features/threads/floating-working-control.tsx",
  "src/features/threads/NewTaskDraftScreen.tsx",
  "src/features/threads/PendingApprovalCard.tsx",
  "src/features/threads/PendingUserInputCard.tsx",
  "src/features/threads/ProposedPlanCard.tsx",
  "src/features/threads/ThreadComposer.tsx",
  "src/features/threads/ThreadDetailScreen.tsx",
  "src/features/threads/ThreadFeed.tsx",
  "src/features/threads/ThreadGuestShareBar.tsx",
  "src/features/threads/ThreadGuestShareSheet.tsx",
  "src/features/threads/threadListAnimations.ts",
  "src/features/threads/thread-list-v2-items.tsx",
  "src/features/threads/ThreadQueueControl.tsx",
  "src/features/threads/thread-work-log.tsx",
  "src/features/usage/UsageDailyChart.tsx",
  "src/features/usage/UsageRouteScreen.tsx",
  "src/features/voice-input/ComposerDictationControl.tsx",
  "src/features/voice-input/GlobalVoiceInputControl.tsx",
  "src/lib/mobileMotion.ts",
  "src/native/androidPredictiveBack.ts",
] as const;

const WAVE2_REDUCE_MOTION_REQUIRED_FILES = [
  "src/components/ui/Toast.tsx",
  "src/components/ui/FrostedCutout.android.tsx",
  "src/features/browser/ThreadBrowserFloat.tsx",
  "src/features/connection/ConnectDeviceApprovalCoordinator.tsx",
  "src/features/home/thread-swipe-actions.tsx",
  "src/features/layout/AndroidPaseoPanels.android.tsx",
  "src/features/layout/workspace/ListSearchToolbar.android.tsx",
  "src/features/pull-requests/PullRequestMergeControls.tsx",
  "src/features/threads/ThreadFeed.tsx",
  "src/features/threads/floating-working-control.tsx",
  "src/features/usage/UsageDailyChart.tsx",
  "src/lib/mobileMotion.ts",
] as const;

describe("Wave 5 Android motion regression gate (C137)", () => {
  it("preserves DISABLE_COMMIT_PAUSING_MECHANISM and forbids Reanimated withRepeat in all Wave 2 mobile files", () => {
    const pkg = JSON.parse(
      NodeFS.readFileSync(NodePath.join(MOBILE_ROOT, "package.json"), "utf8"),
    ) as { reanimated?: { staticFeatureFlags?: Record<string, unknown> } };
    expect(pkg.reanimated?.staticFeatureFlags?.DISABLE_COMMIT_PAUSING_MECHANISM).toBe(true);

    for (const relPath of WAVE2_TOUCHED_MOBILE_MOTION_FILES) {
      const fullPath = NodePath.join(MOBILE_ROOT, relPath);
      expect(NodeFS.existsSync(fullPath), `Missing Wave 2 mobile file ${relPath}`).toBe(true);
      const source = NodeFS.readFileSync(fullPath, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, `Disallowed Reanimated withRepeat in ${relPath}`).not.toMatch(
        /\bwithRepeat\s*\(/,
      );
      // Astra P1-10: never pass ReduceMotion as a 3rd callback argument to withSpring/withTiming.
      expect(
        source,
        `ReduceMotion must be inside the config object, not the 3rd callback argument (${relPath})`,
      ).not.toMatch(/\bwith(?:Spring|Timing)\s*\([^,]+,\s*\{[^}]*\}\s*,\s*ReduceMotion/);
    }
  });

  it("ensures ReduceMotion.System or mobileMotion presets are wired across Wave 2 Reanimated surfaces", () => {
    for (const relPath of WAVE2_REDUCE_MOTION_REQUIRED_FILES) {
      const source = NodeFS.readFileSync(NodePath.join(MOBILE_ROOT, relPath), "utf8");
      const usesReduceMotion =
        source.includes("ReduceMotion.System") ||
        source.includes("SPRING_SPATIAL_") ||
        source.includes("SPRING_EFFECTS_") ||
        source.includes("SPRING_DETENT_") ||
        source.includes("TIMING_QUICK_FADE") ||
        source.includes("TIMING_STANDARD_ENTER");
      expect(usesReduceMotion, `Expected ReduceMotion.System coverage in ${relPath}`).toBe(true);
    }
  });
});

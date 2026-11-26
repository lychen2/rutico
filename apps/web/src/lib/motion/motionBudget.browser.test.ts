import "~/index.css";
import "~/styles/pairing-motion.css";
import "~/styles/workspace-hubs.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import browserDeviceToolbarSource from "~/browser/BrowserDeviceToolbar.tsx?raw";
import hostedBrowserWebviewSource from "~/browser/HostedBrowserWebview.tsx?raw";
import chatViewSource from "~/components/ChatView.tsx?raw";
import composerBannerSource from "~/components/chat/ComposerBanner.tsx?raw";
import composerSurfaceSource from "~/components/chat/ComposerSurface.tsx?raw";
import timelineOverlaysSource from "~/components/chat/TimelineOverlays.tsx?raw";
import virtualTablePreviewSource from "~/components/files/VirtualTablePreview.tsx?raw";
import threadPreviewMiniPlayerSource from "~/components/preview/ThreadPreviewMiniPlayer.tsx?raw";
import zoomIndicatorSource from "~/components/preview/ZoomIndicator.tsx?raw";
import projectContentSearchDialogSource from "~/components/search/ProjectContentSearchDialog.tsx?raw";
import keybindingsSettingsSource from "~/components/settings/KeybindingsSettings.tsx?raw";
import sidebarFolderDropSource from "~/components/sidebar/SidebarFolderDrop.tsx?raw";
import sidebarSource from "~/components/ui/sidebar.tsx?raw";
import toastSource from "~/components/ui/toast.tsx?raw";
import chatMotionCssSource from "~/styles/chat-motion.css?raw";
import desktopLinuxCssSource from "~/styles/desktop-linux.css?raw";
import motionFoundationCssSource from "~/styles/motion-foundation.css?raw";
import pairingMotionCssSource from "~/styles/pairing-motion.css?raw";
import shellMotionCssSource from "~/styles/shell-motion.css?raw";
import workspaceHubsCssSource from "~/styles/workspace-hubs.css?raw";
import workspaceMotionCssSource from "~/styles/workspace-motion.css?raw";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { render } from "../../../test/render";
import {
  SPRING_PRESETS,
  type SpringPresetName,
  getSpringWaapiTiming,
  prefersReducedMotion,
} from "./springs";

// Scope boundary (Astra P2-4): headless Chromium proves deterministic CSS tokens, WAAPI acceptance,
// zero hot-path backdrop-filter, reduced-motion collapse, and visibility gating — not 120Hz hardware refresh.

const AUDITED_HOT_PATH_SOURCES = [
  { path: "apps/web/src/components/ui/sidebar.tsx", source: sidebarSource },
  { path: "apps/web/src/components/ui/toast.tsx", source: toastSource },
  {
    path: "apps/web/src/components/sidebar/SidebarFolderDrop.tsx",
    source: sidebarFolderDropSource,
  },
  { path: "apps/web/src/components/ChatView.tsx", source: chatViewSource },
  { path: "apps/web/src/components/chat/ComposerSurface.tsx", source: composerSurfaceSource },
  { path: "apps/web/src/components/chat/ComposerBanner.tsx", source: composerBannerSource },
  { path: "apps/web/src/components/chat/TimelineOverlays.tsx", source: timelineOverlaysSource },
  {
    path: "apps/web/src/components/search/ProjectContentSearchDialog.tsx",
    source: projectContentSearchDialogSource,
  },
  { path: "apps/web/src/browser/BrowserDeviceToolbar.tsx", source: browserDeviceToolbarSource },
  { path: "apps/web/src/browser/HostedBrowserWebview.tsx", source: hostedBrowserWebviewSource },
  { path: "apps/web/src/components/preview/ZoomIndicator.tsx", source: zoomIndicatorSource },
  {
    path: "apps/web/src/components/preview/ThreadPreviewMiniPlayer.tsx",
    source: threadPreviewMiniPlayerSource,
  },
  {
    path: "apps/web/src/components/files/VirtualTablePreview.tsx",
    source: virtualTablePreviewSource,
  },
  {
    path: "apps/web/src/components/settings/KeybindingsSettings.tsx",
    source: keybindingsSettingsSource,
  },
] as const;

const WAVE2_MODULAR_STYLESHEETS = [
  { path: "apps/web/src/styles/motion-foundation.css", source: motionFoundationCssSource },
  { path: "apps/web/src/styles/chat-motion.css", source: chatMotionCssSource },
  { path: "apps/web/src/styles/workspace-motion.css", source: workspaceMotionCssSource },
  { path: "apps/web/src/styles/workspace-hubs.css", source: workspaceHubsCssSource },
  { path: "apps/web/src/styles/desktop-linux.css", source: desktopLinuxCssSource },
  { path: "apps/web/src/styles/shell-motion.css", source: shellMotionCssSource },
  { path: "apps/web/src/styles/pairing-motion.css", source: pairingMotionCssSource },
] as const;

const SPRING_TOKEN_NAMES: ReadonlyArray<SpringPresetName> = [
  "micro",
  "snappy",
  "fluid",
  "spatial",
  "bouncy",
  "gentle",
];

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findActiveBackdropBlurMatches(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const matches: string[] = [];
  const utilityPattern = /\bbackdrop-blur-(?!none\b)[a-z0-9[\]()._-]+/g;
  const cssPattern = /(?:-webkit-)?backdrop-filter\s*:\s*[^;}\n]*blur\(/gi;
  const inlinePattern = /\b(?:WebkitB|b)ackdropFilter\s*:\s*["'`][^"'`]*blur\(/g;
  for (const pattern of [utilityPattern, cssPattern, inlinePattern]) {
    for (const match of withoutComments.matchAll(pattern)) {
      matches.push(match[0]);
    }
  }
  return matches;
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    dataset?: Record<string, string>;
    cssText?: string;
    textContent?: string;
  },
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.className) el.className = options.className;
  if (options?.cssText) el.style.cssText = options.cssText;
  if (options?.textContent) el.textContent = options.textContent;
  if (options?.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      el.dataset[key] = value;
    }
  }
  return el;
}

describe("Wave 5 motion budget & zero hot-path backdrop-filter gate (C137)", () => {
  it("keeps all 14 audited hot-path Web source files and 7 Wave 2 stylesheets free of backdrop-blur regressions", () => {
    expect(AUDITED_HOT_PATH_SOURCES).toHaveLength(14);
    for (const entry of AUDITED_HOT_PATH_SOURCES) {
      const hits = findActiveBackdropBlurMatches(entry.source);
      expect(hits, `Unexpected backdrop-blur regression in ${entry.path}`).toEqual([]);
    }

    for (const sheet of WAVE2_MODULAR_STYLESHEETS) {
      const stripped = stripCssComments(sheet.source);
      const blurRules = Array.from(
        stripped.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*[^;}\n]*blur\(/gi),
        (match) => match[0],
      );
      expect(blurRules, `Unexpected backdrop-filter blur rule in ${sheet.path}`).toEqual([]);
    }
  });

  it("computes backdrop-filter: none across rendered optical-chrome hot-path elements and pseudo-elements", async () => {
    await using screen = await render(null, { router: false });
    const sidebar = createEl("aside", {
      className: "surface-optical-chrome",
      dataset: { slot: "sidebar-container" },
      textContent: "Sidebar chrome",
    });
    const banner = createEl("div", {
      className: "surface-optical-chrome surface-elevated-rim",
      dataset: { slot: "composer-banner" },
      textContent: "Banner chrome",
    });
    const toast = createEl("div", {
      className: "surface-optical-chrome",
      dataset: { slot: "toast" },
      textContent: "Toast chrome",
    });
    screen.container.append(sidebar, banner, toast);

    for (const el of [sidebar, banner, toast]) {
      expect(getComputedStyle(el).backdropFilter).toBe("none");
      expect(getComputedStyle(el, "::before").backdropFilter).toBe("none");
      expect(getComputedStyle(el, "::after").backdropFilter).toBe("none");
    }
  });

  it("preserves all 6 --spring-* linear() CSS tokens, WAAPI acceptance, and superellipse(1.25) with pill round guard", async () => {
    const rootStyle = getComputedStyle(document.documentElement);
    for (const name of SPRING_TOKEN_NAMES) {
      const tokenValue = rootStyle.getPropertyValue(`--spring-${name}`).trim();
      expect(
        tokenValue.startsWith("linear("),
        `--spring-${name} should resolve to linear(...)`,
      ).toBe(true);
      expect(tokenValue.includes("var(")).toBe(false);
    }

    await using screen = await render(null, { router: false });
    const dialogEl = createEl("div", {
      dataset: { slot: "dialog-popup" },
      cssText: "width: 80px; height: 48px;",
    });
    const buttonEl = createEl("button", {
      dataset: { slot: "button" },
      textContent: "Action",
    });
    const pillButtonEl = createEl("div", {
      className: "rounded-full",
      dataset: { slot: "button" },
      cssText: "width: 64px; height: 32px;",
    });
    const switchEl = createEl("div", {
      dataset: { slot: "switch" },
      cssText: "width: 40px; height: 24px;",
    });
    const switchThumbEl = createEl("div", {
      dataset: { slot: "switch-thumb" },
      cssText: "width: 20px; height: 20px;",
    });
    switchEl.append(switchThumbEl);
    const radioEl = createEl("div", {
      dataset: { slot: "radio" },
      cssText: "width: 18px; height: 18px;",
    });
    screen.container.append(dialogEl, buttonEl, pillButtonEl, switchEl, radioEl);

    // Verify expanded WAAPI linear(...) strings execute cleanly in Chromium without var(--spring-*).
    for (const name of SPRING_TOKEN_NAMES) {
      const timing = getSpringWaapiTiming(name);
      expect(timing.easing).toBe(SPRING_PRESETS[name].linearEasing);
      expect(timing.easing.startsWith("linear(")).toBe(true);
      expect(timing.easing.includes("var(")).toBe(false);

      const anim = dialogEl.animate(
        [
          { transform: "translate3d(0px, 0px, 0px)" },
          { transform: "translate3d(100px, 0px, 0px)" },
        ],
        { duration: timing.duration, easing: timing.easing, fill: "both" },
      );
      anim.pause();
      anim.currentTime = 0;
      expect(getComputedStyle(dialogEl).transform).toContain("matrix(1, 0, 0, 1, 0, 0)");

      anim.currentTime = timing.duration;
      expect(getComputedStyle(dialogEl).transform).toContain("matrix(1, 0, 0, 1, 100, 0)");
      anim.cancel();
    }

    // Verify stylesheet declarations + live Chromium corner-shape evaluation when supported.
    expect(motionFoundationCssSource).toContain("corner-shape: superellipse(1.25)");
    expect(motionFoundationCssSource).toContain("corner-shape: round");

    if (CSS.supports("corner-shape", "superellipse(1.25)")) {
      expect(getComputedStyle(dialogEl).getPropertyValue("corner-shape")).toBe(
        "superellipse(1.25)",
      );
      expect(getComputedStyle(buttonEl).getPropertyValue("corner-shape")).toBe(
        "superellipse(1.25)",
      );
      // CSS Borders 4 canonicalizes `round` as `round` or `superellipse(1)`.
      const roundCanonical = /^(round|superellipse\(1\))$/;
      expect(getComputedStyle(pillButtonEl).getPropertyValue("corner-shape")).toMatch(
        roundCanonical,
      );
      expect(getComputedStyle(switchEl).getPropertyValue("corner-shape")).toMatch(roundCanonical);
      expect(getComputedStyle(switchThumbEl).getPropertyValue("corner-shape")).toMatch(
        roundCanonical,
      );
      expect(getComputedStyle(radioEl).getPropertyValue("corner-shape")).toMatch(roundCanonical);
    }
  });

  it("collapses displacement/transform motion under prefers-reduced-motion: reduce while preserving visible state transitions", async () => {
    await using screen = await render(null, { router: false });
    const recessEl = createEl("div", {
      dataset: { slot: "sidebar-wrapper", spatialRecess: "true" },
      cssText: "width: 200px; height: 120px;",
    });
    const activeEl = createEl("span", {
      dataset: { slot: "contextual-icon-swap-item", active: "true" },
      textContent: "Active",
    });
    const inactiveEl = createEl("span", {
      dataset: { slot: "contextual-icon-swap-item", active: "false" },
      textContent: "Inactive",
    });
    const skeletonEl = createEl("div", {
      className: "surface-skeleton-sweep",
      cssText: "width: 120px; height: 16px;",
    });
    screen.container.append(recessEl, activeEl, inactiveEl, skeletonEl);

    document.documentElement.dataset.spatialModalDepth = "1";
    const session = cdp();
    try {
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });

      expect(prefersReducedMotion()).toBe(true);
      const rootStyle = getComputedStyle(document.documentElement);
      for (const token of [
        "--duration-spring-micro",
        "--duration-spring-snappy",
        "--duration-spring-fluid",
        "--duration-spring-spatial",
        "--duration-spring-bouncy",
        "--duration-spring-gentle",
        "--duration-micro",
        "--duration-snappy",
        "--duration-fluid",
        "--duration-spatial",
        "--duration-gentle",
      ]) {
        expect(rootStyle.getPropertyValue(token).trim()).toBe("0ms");
      }

      // Spatial depth recess collapses transform & transition cleanly.
      expect(getComputedStyle(recessEl).transform).toBe("none");
      expect(getComputedStyle(recessEl).transitionDuration).toBe("0s");

      // Contextual icon swap collapses scale/blur displacement while preserving active/inactive opacity state.
      expect(getComputedStyle(inactiveEl).transform).toBe("none");
      expect(getComputedStyle(inactiveEl).filter).toBe("none");
      expect(getComputedStyle(inactiveEl).opacity).toBe("0");
      expect(getComputedStyle(activeEl).opacity).toBe("1");

      // State toggle remains immediately visible without waiting on a transform transition.
      activeEl.dataset.active = "false";
      inactiveEl.dataset.active = "true";
      expect(getComputedStyle(activeEl).opacity).toBe("0");
      expect(getComputedStyle(inactiveEl).opacity).toBe("1");

      // Ambient skeleton shimmer hides its pseudo-element under reduced motion.
      expect(getComputedStyle(skeletonEl, "::after").display).toBe("none");
    } finally {
      delete document.documentElement.dataset.spatialModalDepth;
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  it("gates continuous animation playback via observeVisibleAnimation on viewport visibility and reduced motion", async () => {
    await using screen = await render(null, { router: false });
    const scroller = createEl("div", {
      cssText: "height: 140px; overflow-y: auto;",
    });
    const box = createEl("div", {
      className: "surface-skeleton-sweep",
      cssText: "width: 80px; height: 40px;",
    });
    const spacer = createEl("div", { cssText: "height: 900px;" });
    scroller.append(box, spacer);
    screen.container.append(scroller);

    const cleanup = observeVisibleAnimation(box);
    expect(cleanup).toBeTypeOf("function");

    // Once intersecting in a visible document under no-preference, playback runs with transform promotion.
    await vi.waitFor(() => {
      expect(box.style.getPropertyValue("--visible-animation-state")).toBe("running");
      expect(box.style.getPropertyValue("--visible-animation-will-change")).toBe("transform");
    });

    // Under prefers-reduced-motion: reduce, observeVisibleAnimation immediately pauses & clears will-change.
    const session = cdp();
    try {
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await vi.waitFor(() => {
        expect(box.style.getPropertyValue("--visible-animation-state")).toBe("paused");
        expect(box.style.getPropertyValue("--visible-animation-will-change")).toBe("auto");
      });
    } finally {
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }

    await vi.waitFor(() => {
      expect(box.style.getPropertyValue("--visible-animation-state")).toBe("running");
    });

    // Scrolling the element off-screen pauses the animation and drops will-change promotion.
    scroller.scrollTop = 700;
    await vi.waitFor(() => {
      expect(box.style.getPropertyValue("--visible-animation-state")).toBe("paused");
      expect(box.style.getPropertyValue("--visible-animation-will-change")).toBe("auto");
    });

    // Scrolling back into view resumes; cleanup resets to paused/auto.
    scroller.scrollTop = 0;
    await vi.waitFor(() => {
      expect(box.style.getPropertyValue("--visible-animation-state")).toBe("running");
    });

    cleanup?.();
    expect(box.style.getPropertyValue("--visible-animation-state")).toBe("paused");
    expect(box.style.getPropertyValue("--visible-animation-will-change")).toBe("auto");
  });
});

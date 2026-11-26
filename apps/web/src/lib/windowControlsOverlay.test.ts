import { describe, expect, it } from "vite-plus/test";

import { shouldShowFallbackLinuxWindowControls } from "./windowControlsOverlay";

describe("shouldShowFallbackLinuxWindowControls", () => {
  it("never shows fallback DOM controls when native titleBarOverlay or DOM WCO is active", () => {
    expect(
      shouldShowFallbackLinuxWindowControls(
        {
          maximized: false,
          fullscreen: false,
          linuxDesktop: "gnome",
          isTilingWm: false,
          hasNativeWco: true,
          overlayHeight: 40,
        },
        false,
      ),
    ).toBe(false);

    expect(
      shouldShowFallbackLinuxWindowControls(
        {
          maximized: false,
          fullscreen: false,
          linuxDesktop: "kde",
          isTilingWm: false,
          hasNativeWco: false,
          overlayHeight: 40,
        },
        true,
      ),
    ).toBe(false);
  });

  it("hides fallback controls on tiling WMs unless explicitly forced", () => {
    const tilingState = {
      maximized: false,
      fullscreen: false,
      linuxDesktop: "hyprland",
      isTilingWm: true,
      hasNativeWco: false,
      overlayHeight: 40,
    } as const;
    expect(shouldShowFallbackLinuxWindowControls(tilingState, false)).toBe(false);
    expect(shouldShowFallbackLinuxWindowControls(tilingState, false, "force")).toBe(true);
    expect(
      shouldShowFallbackLinuxWindowControls({ ...tilingState, fullscreen: true }, false, "force"),
    ).toBe(false);
  });

  it("shows fallback controls on stacking Linux desktops only when native WCO is absent", () => {
    const stackingFallback = {
      maximized: false,
      fullscreen: false,
      linuxDesktop: "xfce",
      isTilingWm: false,
      hasNativeWco: false,
      overlayHeight: 40,
    } as const;
    expect(shouldShowFallbackLinuxWindowControls(stackingFallback, false)).toBe(true);
    expect(shouldShowFallbackLinuxWindowControls(stackingFallback, false, "hide")).toBe(false);
  });

  it("reaches fallback controls when main IPC leaves hasNativeWco unconfirmed and DOM WCO is inactive", () => {
    const unconfirmedStacking = {
      maximized: false,
      fullscreen: false,
      linuxDesktop: "xfce",
      isTilingWm: false,
      overlayHeight: 40,
    } as const;
    expect(shouldShowFallbackLinuxWindowControls(unconfirmedStacking, false)).toBe(true);
    expect(shouldShowFallbackLinuxWindowControls(unconfirmedStacking, true)).toBe(false);
  });
});

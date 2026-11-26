import type { LinuxWindowControlAction, LinuxWindowState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { act, render, stubGlobal } from "../../test/render";

function setupLinuxWindowBridge(initialState: LinuxWindowState) {
  let currentState = initialState;
  const listeners = new Set<(state: LinuxWindowState) => void>();
  const performLinuxWindowControlAction = vi.fn(
    async (_action: LinuxWindowControlAction) => undefined,
  );
  const bridge = {
    getClientPlatform: () => "linux",
    getLinuxWindowState: vi.fn(() => currentState),
    onLinuxWindowStateChange: vi.fn((listener: (state: LinuxWindowState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    performLinuxWindowControlAction,
  };
  return {
    bridge,
    performLinuxWindowControlAction,
    pushState: (next: LinuxWindowState) => {
      currentState = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

describe("WorkspacePageHeader Linux window controls via real IPC capability", () => {
  it("hides fallback buttons when IPC reports hasNativeWco=true and renders working fallback buttons when hasNativeWco=false", async () => {
    const nativeBridge = setupLinuxWindowBridge({
      maximized: false,
      fullscreen: false,
      linuxDesktop: "gnome",
      isTilingWm: false,
      hasNativeWco: true,
      overlayHeight: 40,
    });
    {
      using _bridge = stubGlobal("desktopBridge", nativeBridge.bridge);
      await using screen = await render(<WorkspacePageHeader electron />, { router: false });
      expect(screen.container.querySelector('[data-slot="linux-window-controls"]')).toBeNull();
    }

    const fallbackBridge = setupLinuxWindowBridge({
      maximized: false,
      fullscreen: false,
      linuxDesktop: "xfce",
      isTilingWm: false,
      hasNativeWco: false,
      overlayHeight: 40,
    });
    {
      using _bridge = stubGlobal("desktopBridge", fallbackBridge.bridge);
      await using screen = await render(<WorkspacePageHeader electron />, { router: false });

      expect(screen.container.querySelector('[data-slot="linux-window-controls"]')).not.toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Minimize window" }));
      await userEvent.click(screen.getByRole("button", { name: "Maximize window" }));
      await userEvent.click(screen.getByRole("button", { name: "Close window" }));
      expect(fallbackBridge.performLinuxWindowControlAction.mock.calls).toEqual([
        ["minimize"],
        ["maximize-toggle"],
        ["close"],
      ]);

      // Live IPC update to maximized toggles button label to Restore window; fullscreen hides fallback controls.
      await act(() => {
        fallbackBridge.pushState({
          maximized: true,
          fullscreen: false,
          linuxDesktop: "xfce",
          isTilingWm: false,
          hasNativeWco: false,
          overlayHeight: 40,
        });
      });
      await expect.element(screen.getByRole("button", { name: "Restore window" })).toBeVisible();

      await act(() => {
        fallbackBridge.pushState({
          maximized: true,
          fullscreen: true,
          linuxDesktop: "xfce",
          isTilingWm: false,
          hasNativeWco: false,
          overlayHeight: 40,
        });
      });
      expect(screen.container.querySelector('[data-slot="linux-window-controls"]')).toBeNull();

      // Transitioning back from fullscreen with hasNativeWco=true keeps fallback controls hidden.
      await act(() => {
        fallbackBridge.pushState({
          maximized: false,
          fullscreen: false,
          linuxDesktop: "gnome",
          isTilingWm: false,
          hasNativeWco: true,
          overlayHeight: 40,
        });
      });
      expect(screen.container.querySelector('[data-slot="linux-window-controls"]')).toBeNull();
    }
  });
});

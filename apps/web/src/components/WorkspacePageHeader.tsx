import { useGT } from "gt-react";
import type { ComponentPropsWithoutRef } from "react";

import { MorphingIcon } from "./ui/morphing-icon";
import { cn } from "../lib/utils";
import {
  hasVisibleWindowControlsOverlay,
  readLinuxCsdOverride,
  shouldShowFallbackLinuxWindowControls,
  useLinuxWindowState,
} from "../lib/windowControlsOverlay";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

function LinuxWindowControls() {
  const gt = useGT();
  const state = useLinuxWindowState();
  const showControls = shouldShowFallbackLinuxWindowControls(
    state,
    hasVisibleWindowControlsOverlay(),
    readLinuxCsdOverride(),
  );
  if (!showControls || !state) return null;

  const invoke = (action: "minimize" | "maximize-toggle" | "close") => {
    void window.desktopBridge?.performLinuxWindowControlAction?.(action).catch(() => undefined);
  };

  return (
    <div
      data-slot="linux-window-controls"
      data-no-drag=""
      className="linux-window-controls ms-auto flex h-full shrink-0 items-center gap-1"
    >
      <button
        type="button"
        aria-label={gt("Minimize window")}
        onClick={() => invoke("minimize")}
        className="linux-window-control-btn"
      >
        <MorphingIcon variant="minus" className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={state.maximized ? gt("Restore window") : gt("Maximize window")}
        onClick={() => invoke("maximize-toggle")}
        className="linux-window-control-btn"
      >
        <MorphingIcon variant={state.maximized ? "restore" : "maximize"} className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={gt("Close window")}
        onClick={() => invoke("close")}
        data-window-control="close"
        className="linux-window-control-btn"
      >
        <MorphingIcon variant="close" className="size-3.5" />
      </button>
    </div>
  );
}

export function WorkspacePageHeader({
  electron = false,
  reserveNativeControls = electron,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"header"> & {
  readonly electron?: boolean;
  readonly reserveNativeControls?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)]! min-h-[var(--workspace-topbar-height)]! max-h-[var(--workspace-topbar-height)]! shrink-0 items-center gap-3 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left,padding-right] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-(--ease-drawer)",
        electron && "drag-region",
        reserveNativeControls && "wco:pr-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        className,
      )}
      {...props}
    >
      {children}
      {electron && reserveNativeControls ? <LinuxWindowControls /> : null}
    </header>
  );
}

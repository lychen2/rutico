import type { DeviceHostSummary, DevicePlatform } from "@t3tools/contracts";
import {
  Camera,
  Check,
  ChevronLeft,
  Home,
  Keyboard,
  Box,
  Maximize,
  MoreHorizontal,
  PictureInPicture2,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Square,
  Type,
  X,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { T, useGT, useMessages, msg } from "gt-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { ContextualIconSwap } from "~/components/ui/morphing-icon";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useSharedIndicator } from "~/lib/motion/useSharedIndicator";
import { cn } from "~/lib/utils";
import type { DeviceStreamHandle, DeviceViewControls } from "./DeviceStreamView";
import type { DeviceControls } from "./useDeviceControls";

export function DeviceControlsRail(props: {
  platform: DevicePlatform;
  hostKind: DeviceHostSummary["kind"] | undefined;
  handle: DeviceStreamHandle | null;
  view: DeviceViewControls;
  controls: DeviceControls;
  screenshotPending: boolean;
  screenshotConfirmed?: boolean;
  onScreenshot: () => void;
  toolsOpen: boolean;
  onTools: () => void;
  onFloat: () => void;
  onClose: () => void;
  onPowerOff: () => void;
}) {
  const { view, handle, controls } = props;
  const popupSide = "left";
  const settings = controls.detail?.settings;
  const inputDisabled = !handle?.inputConnected;
  const runsHostCommands = props.hostKind === "local" || props.hostKind === "ssh";
  const nextAppearance = settings?.appearance === "dark" ? "light" : "dark";
  const gt = useGT();
  const m = useMessages();
  const [pulsedNav, setPulsedNav] = useState<"home" | "back" | "recents" | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const viewSwitchRef = useRef<HTMLDivElement | null>(null);
  const viewIndicatorRef = useRef<HTMLDivElement | null>(null);

  useSharedIndicator({
    containerRef: viewSwitchRef,
    indicatorRef: viewIndicatorRef,
    activeSelector: "[data-device-view-active='true']",
    activeKey: view.streaming ? (view.phone ? "phone" : "flat") : null,
    preset: "fluid",
    maxSquash: 0.14,
    axis: "y",
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears Android hardware nav pulse timer on unmount
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  const pressHardwareNav = (button: "home" | "back" | "recents") => {
    handle?.pressButton(button);
    setPulsedNav(button);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      setPulsedNav(null);
      pulseTimerRef.current = null;
    }, 180);
  };

  return (
    <aside
      aria-label={gt("Device controls")}
      data-layout="rail"
      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-14 flex-col items-center gap-2 overflow-y-auto [justify-content:safe_center] py-3 pr-2 [scrollbar-width:none]"
    >
      <div className="surface-optical-chrome surface-elevated-rim pointer-events-auto flex shrink-0 flex-col items-center gap-1 overflow-y-auto rounded-full p-2 [scrollbar-width:none]">
        <RailButton
          tooltipSide={popupSide}
          label={gt("Home", { $context: "device home button" })}
          disabled={inputDisabled}
          pulsing={pulsedNav === "home"}
          onClick={() => pressHardwareNav("home")}
        >
          <Home />
        </RailButton>
        {props.platform === "android" ? (
          <>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Back", { $context: "device back button" })}
              disabled={inputDisabled}
              pulsing={pulsedNav === "back"}
              onClick={() => pressHardwareNav("back")}
            >
              <ChevronLeft />
            </RailButton>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Recents", { $context: "Android recent apps button" })}
              disabled={inputDisabled}
              pulsing={pulsedNav === "recents"}
              onClick={() => pressHardwareNav("recents")}
            >
              <Square />
            </RailButton>
            {runsHostCommands ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={gt("Rotate device")}
                      disabled={controls.disabled}
                    />
                  }
                >
                  <RotateCcw />
                </MenuTrigger>
                <MenuPopup side={popupSide}>
                  <MenuItem
                    onClick={() => void controls.act({ type: "setOrientation", value: "portrait" })}
                  >
                    <T>Portrait</T>
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void controls.act({ type: "setOrientation", value: "landscape_left" })
                    }
                  >
                    <T>Landscape</T>
                  </MenuItem>
                </MenuPopup>
              </Menu>
            ) : null}
          </>
        ) : props.hostKind === "simlock" ? null : (
          <RailButton
            tooltipSide={popupSide}
            label={gt("Rotate device")}
            disabled={inputDisabled || !!view.keyboard?.attached}
            onClick={() => handle?.rotate()}
          >
            <RotateCcw />
          </RailButton>
        )}
        {runsHostCommands ? (
          <>
            <RailDivider />
            <RailButton
              tooltipSide={popupSide}
              label={
                nextAppearance === "light"
                  ? gt("Switch device to light mode")
                  : gt("Switch device to dark mode")
              }
              disabled={controls.disabled || !settings?.appearance}
              onClick={() => void controls.act({ type: "setAppearance", value: nextAppearance })}
            >
              <ContextualIconSwap
                activeKey={settings?.appearance === "dark" ? "sun" : "moon"}
                items={[
                  { key: "sun", icon: <SunIcon className="size-4" /> },
                  { key: "moon", icon: <MoonIcon className="size-4" /> },
                ]}
              />
            </RailButton>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={gt("Device text size")}
                    title={gt("Device text size")}
                    disabled={controls.disabled || !settings?.textSize}
                  />
                }
              >
                <Type />
              </MenuTrigger>
              <MenuPopup side={popupSide} className="min-w-40">
                <MenuRadioGroup
                  value={settings?.textSize ?? ""}
                  onValueChange={(value) => {
                    if (
                      value === "small" ||
                      value === "default" ||
                      value === "large" ||
                      value === "extra-large"
                    )
                      void controls.act({ type: "setTextSize", value });
                  }}
                >
                  {(
                    [
                      ["small", msg("Small")],
                      ["default", msg("Default")],
                      ["large", msg("Large")],
                      ["extra-large", msg("Extra large")],
                    ] as const
                  ).map(([value, label]) => (
                    <MenuRadioItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <span className="flex-1">{m(label)}</span>
                        <MenuRadioItemIndicator />
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Device tools")}
              pressed={props.toolsOpen}
              onClick={props.onTools}
            >
              <SlidersHorizontal />
            </RailButton>
          </>
        ) : null}
        {props.hostKind === "simlock" ? null : (
          <RailButton
            tooltipSide={popupSide}
            label={props.screenshotPending ? gt("Capturing screenshot") : gt("Save screenshot")}
            disabled={!view.streaming || props.screenshotPending}
            onClick={props.onScreenshot}
          >
            <ContextualIconSwap
              activeKey={props.screenshotConfirmed ? "confirmed" : "camera"}
              items={[
                { key: "camera", icon: <Camera className="size-4" /> },
                { key: "confirmed", icon: <Check className="size-4 text-success" /> },
              ]}
            />
          </RailButton>
        )}
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("More device actions")}
                title={gt("More device actions")}
              />
            }
          >
            <MoreHorizontal />
          </MenuTrigger>
          <MenuPopup side={popupSide} align="end">
            <MenuItem onClick={props.onFloat}>
              <PictureInPicture2 />
              <T>Float device over chat</T>
            </MenuItem>
            <MenuItem onClick={props.onClose}>
              <X />
              <T>Close device panel</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onPowerOff}>
              <Power />
              {props.hostKind === "simlock"
                ? gt("Return device to the pool")
                : gt("Power off device")}
            </MenuItem>
          </MenuPopup>
        </Menu>
        <RailDivider />
        <div
          ref={viewSwitchRef}
          data-slot="device-view-mode-switch"
          className="relative flex flex-col items-center gap-1"
        >
          <div
            ref={viewIndicatorRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 z-0 rounded-md bg-secondary opacity-0 shadow-xs/5 ring-1 ring-inset ring-border/70 will-change-transform"
          />
          <RailButton
            tooltipSide={popupSide}
            label={gt("3D view")}
            pressed={view.phone}
            indicatorManaged
            viewActive={view.phone}
            disabled={!view.streaming || !!view.phoneUnavailableReason}
            description={view.phoneUnavailableReason ?? undefined}
            onClick={view.showPhone}
          >
            <Box />
          </RailButton>
          <RailButton
            tooltipSide={popupSide}
            label={gt("Flat view")}
            pressed={!view.phone}
            indicatorManaged
            viewActive={!view.phone}
            disabled={!view.streaming}
            onClick={view.showFlat}
          >
            <Smartphone />
          </RailButton>
        </div>
        {view.keyboard ? (
          <RailButton
            tooltipSide={popupSide}
            label={
              view.keyboard.attached ? gt("Detach Magic Keyboard") : gt("Attach Magic Keyboard")
            }
            pressed={view.keyboard.attached}
            onClick={view.keyboard.toggle}
          >
            <Keyboard />
          </RailButton>
        ) : null}
        {view.phone ? (
          <RailButton
            tooltipSide={popupSide}
            label={gt("Restore 3D view")}
            onClick={view.resetView}
          >
            <Maximize />
          </RailButton>
        ) : null}
      </div>
      {view.foldingControls}
    </aside>
  );
}

function RailDivider() {
  return <div aria-hidden className="my-1 h-px w-5 shrink-0 bg-border/70" />;
}

function RailButton(props: {
  tooltipSide: "left" | "bottom";
  label: string;
  description?: string | undefined;
  disabled?: boolean;
  pressed?: boolean;
  pulsing?: boolean;
  indicatorManaged?: boolean;
  viewActive?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      size="icon-sm"
      variant={props.pressed && !props.indicatorManaged ? "secondary" : "ghost"}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      data-device-view-active={props.viewActive ? "true" : undefined}
      data-nav-pulsing={props.pulsing ? "true" : undefined}
      className={cn(props.indicatorManaged && "relative z-1")}
      onClick={props.onClick}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center",
          props.pulsing && "device-rail-nav-pulse",
        )}
      >
        {props.children}
      </span>
    </Button>
  );
  return (
    <Tooltip>
      {props.disabled && props.description ? (
        <TooltipTrigger
          render={
            <span className="inline-flex" tabIndex={0} role="group" aria-label={props.label} />
          }
        >
          {button}
        </TooltipTrigger>
      ) : (
        <TooltipTrigger render={button} />
      )}
      <TooltipPopup side={props.tooltipSide}>{props.description ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}

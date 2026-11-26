import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESETS, resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { Columns2, Link2, Maximize2, Smartphone, Tablet, Unlink2, X } from "lucide-react";
import { useRef, useState } from "react";
import { msg, T, useGT, useMessages } from "gt-react";

import { pulseBrowserSurfaceGeometrySync } from "~/browser/BrowserSurfaceSlot";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useSharedIndicator } from "~/lib/motion/useSharedIndicator";
import { cn } from "~/lib/utils";

import { BROWSER_DEVICE_TOOLBAR_HEIGHT, resizeFreeformViewport } from "./browserViewportLayout";
import { commitViewportAndAspectRatio } from "./browserDeviceToolbarState";
import { ScreenRotationIcon } from "./ScreenRotationIcon";

const RESPONSIVE_VALUE = "responsive";
const QUICK_FORM_FACTORS = [
  {
    id: "pixel-7",
    shortLabel: msg("Pixel 7"),
    detail: "412 × 915",
    icon: Smartphone,
  },
  {
    id: "galaxy-z-fold-5",
    shortLabel: msg("Fold 5"),
    detail: "344 × 882",
    icon: Columns2,
  },
  {
    id: "nest-hub",
    shortLabel: msg("Tablet"),
    detail: "1024 × 600",
    icon: Tablet,
  },
  {
    id: RESPONSIVE_VALUE,
    shortLabel: msg("Responsive", {
      $context: "browser viewport preset that follows the panel size",
    }),
    detail: null,
    icon: Maximize2,
  },
] as const;

const SELECT_ITEMS = [
  {
    value: RESPONSIVE_VALUE,
    label: msg("Responsive", { $context: "browser viewport preset that follows the panel size" }),
  },
  ...PREVIEW_VIEWPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

interface Props {
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>;
  readonly width: number;
  readonly aspectRatio: number | null;
  readonly onAspectRatioChange: (aspectRatio: number | null) => void;
  readonly onChange: (setting: PreviewViewportSetting) => Promise<void>;
}

export function BrowserDeviceToolbar({
  setting,
  width,
  aspectRatio,
  onAspectRatioChange,
  onChange,
}: Props) {
  const gt = useGT();
  const m = useMessages();
  const quickSegmentRef = useRef<HTMLDivElement | null>(null);
  const quickIndicatorRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const [customSize, setCustomSize] = useState<{
    readonly width: string;
    readonly height: string;
    readonly axis?: "width" | "height";
  } | null>(null);
  const presentedSize = customSize ?? {
    width: String(setting.width),
    height: String(setting.height),
  };
  const selectedValue =
    setting._tag === "preset" &&
    PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === setting.presetId)
      ? setting.presetId
      : RESPONSIVE_VALUE;
  const typedWidth = Number(presentedSize.width);
  const typedHeight = Number(presentedSize.height);
  const { width: customWidth, height: customHeight } =
    aspectRatio === null || customSize?.axis === undefined
      ? { width: typedWidth, height: typedHeight }
      : resizeFreeformViewport(
          { width: typedWidth, height: typedHeight },
          { x: 0, y: 0 },
          1,
          customSize?.axis === "height" ? "south" : "east",
          aspectRatio,
        );
  const customValid =
    Number.isInteger(typedWidth) &&
    Number.isInteger(typedHeight) &&
    typedWidth >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    typedWidth <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    typedHeight >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    typedHeight <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customWidth * customHeight <= PREVIEW_VIEWPORT_MAX_AREA;

  const activeQuickFactorId = QUICK_FORM_FACTORS.some((factor) => factor.id === selectedValue)
    ? selectedValue
    : null;
  const showQuickFactors = width >= 520;
  useSharedIndicator({
    containerRef: quickSegmentRef,
    indicatorRef: quickIndicatorRef,
    activeSelector: "[data-quick-factor-active='true']",
    activeKey: showQuickFactors ? activeQuickFactorId : null,
    preset: "fluid",
    maxSquash: 0.14,
    axis: "x",
  });

  const apply = (next: PreviewViewportSetting, nextAspectRatio = aspectRatio) => {
    setPending(true);
    pulseBrowserSurfaceGeometrySync(280);
    void commitViewportAndAspectRatio(next, nextAspectRatio, onChange, onAspectRatioChange).then(
      () => {
        setPending(false);
        setCustomSize(null);
      },
      () => setPending(false),
    );
  };

  const applyCustomSize = () => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setCustomSize(null);
      return;
    }
    apply({ _tag: "freeform", width: customWidth, height: customHeight });
  };

  const updateCustomDimension = (axis: "width" | "height", value: string) => {
    setCustomSize((current) => {
      const next = {
        width: axis === "width" ? value : (current?.width ?? String(setting.width)),
        height: axis === "height" ? value : (current?.height ?? String(setting.height)),
        axis,
      };
      const numeric = Number(value);
      if (
        aspectRatio === null ||
        !Number.isInteger(numeric) ||
        numeric < PREVIEW_VIEWPORT_MIN_DIMENSION ||
        numeric > PREVIEW_VIEWPORT_MAX_DIMENSION
      ) {
        return next;
      }
      const resized = resizeFreeformViewport(
        setting,
        axis === "width"
          ? { x: numeric - setting.width, y: 0 }
          : { x: 0, y: numeric - setting.height },
        1,
        axis === "width" ? "east" : "south",
        aspectRatio,
      );
      return {
        ...next,
        width: axis === "width" ? value : String(resized.width),
        height: axis === "height" ? value : String(resized.height),
      };
    });
  };

  const selectViewport = (value: string | null) => {
    if (!value) return;
    if (value === RESPONSIVE_VALUE) {
      if (setting._tag === "freeform") return;
      apply({ _tag: "freeform", width: setting.width, height: setting.height });
      return;
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    apply(
      resolvePreviewViewport({ mode: "preset", preset: preset.id }),
      aspectRatio === null ? null : preset.width / preset.height,
    );
  };

  const rotate = () => {
    const hasCustomSize =
      customValid && (customWidth !== setting.width || customHeight !== setting.height);
    const source = hasCustomSize
      ? ({ _tag: "freeform", width: customWidth, height: customHeight } as const)
      : setting;
    apply(
      { ...source, width: source.height, height: source.width },
      aspectRatio === null ? null : 1 / aspectRatio,
    );
  };

  const toggleAspectRatio = () => {
    onAspectRatioChange(aspectRatio === null ? customWidth / customHeight : null);
  };

  return (
    <div
      className="surface-optical-chrome sticky top-0 left-0 z-50 flex items-center gap-1 overflow-x-auto border-b border-border/75 bg-background px-1.5 shadow-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ width, height: BROWSER_DEVICE_TOOLBAR_HEIGHT }}
      role="toolbar"
      aria-label={gt("Browser device toolbar")}
      data-browser-device-toolbar
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        const eventTarget = event.target;
        if (
          (nextTarget instanceof HTMLElement &&
            nextTarget.closest('[data-slot="select-positioner"]')) ||
          (eventTarget instanceof HTMLElement &&
            eventTarget.closest('[data-slot="select-positioner"]'))
        ) {
          return;
        }
        applyCustomSize();
      }}
    >
      {showQuickFactors ? (
        <div
          ref={quickSegmentRef}
          role="group"
          aria-label={gt("Quick device presets")}
          data-slot="browser-quick-presets"
          className="relative mr-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 bg-muted/45 p-0.5"
        >
          <div
            ref={quickIndicatorRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 z-0 rounded-sm bg-background opacity-0 shadow-xs/10 ring-1 ring-inset ring-border/70 will-change-transform"
          />
          {QUICK_FORM_FACTORS.map((factor) => {
            const Icon = factor.icon;
            const active = activeQuickFactorId === factor.id;
            const shortLabelText = m(factor.shortLabel);
            const titleLabel = factor.detail
              ? `${shortLabelText} (${factor.detail})`
              : shortLabelText;
            return (
              <Tooltip key={factor.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={pending}
                      data-quick-factor-active={active ? "true" : undefined}
                      aria-pressed={active}
                      aria-label={titleLabel}
                      onClick={() => selectViewport(factor.id)}
                      className={cn(
                        "relative z-1 inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-2xs font-medium transition-colors duration-120 ease-out outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3 shrink-0" />
                      {width >= 660 ? <span>{shortLabelText}</span> : null}
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{titleLabel}</TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
      ) : null}
      <Select
        modal={false}
        value={selectedValue}
        onValueChange={selectViewport}
        items={SELECT_ITEMS.map((item) => ({ ...item, label: m(item.label) }))}
        disabled={pending}
      >
        <SelectTrigger
          variant="ghost"
          size="xs"
          className={cn("shrink-0 justify-between", width >= 440 ? "w-36" : "w-24")}
          aria-label={gt("Browser device preset")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem value={RESPONSIVE_VALUE}>{m(SELECT_ITEMS[0]!.label)}</SelectItem>
          <SelectGroup>
            <SelectGroupLabel>
              <T context="group of standard device sizes">Standard</T>
            </SelectGroupLabel>
            {PREVIEW_VIEWPORT_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <span className="flex w-full items-center justify-between gap-5">
                  <span>{preset.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {preset.detail}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>

      <form
        className="m-0 flex min-w-0 shrink-0 items-center gap-0.5 border-0 p-0"
        aria-label={gt("Viewport dimensions")}
        onSubmit={(event) => {
          event.preventDefault();
          applyCustomSize();
        }}
      >
        <Input
          nativeInput
          type="number"
          inputMode="numeric"
          size="compact"
          font="mono"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.width}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? {
                  width: String(setting.width),
                  height: String(setting.height),
                },
            )
          }
          onChange={(event) => updateCustomDimension("width", event.target.value)}
          aria-label={gt("Viewport width")}
          aria-invalid={!customValid}
          className={width >= 360 ? "w-14" : "w-13"}
        />
        <span className="text-xs text-muted-foreground">×</span>
        <Input
          nativeInput
          type="number"
          inputMode="numeric"
          size="compact"
          font="mono"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.height}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? {
                  width: String(setting.width),
                  height: String(setting.height),
                },
            )
          }
          onChange={(event) => updateCustomDimension("height", event.target.value)}
          aria-label={gt("Viewport height")}
          aria-invalid={!customValid}
          className={width >= 360 ? "w-14" : "w-13"}
        />
      </form>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={aspectRatio === null ? "ghost" : "secondary"}
              size="icon-xs"
              type="button"
              aria-label={
                aspectRatio === null
                  ? gt("Lock viewport aspect ratio")
                  : gt("Unlock viewport aspect ratio")
              }
              aria-pressed={aspectRatio !== null}
              disabled={pending || !customValid}
              onPointerDown={(event) => event.preventDefault()}
              onClick={toggleAspectRatio}
            />
          }
        >
          {aspectRatio === null ? (
            <Unlink2 className={cn(aspectRatio !== null && "text-foreground")} />
          ) : (
            <Link2 className={cn(aspectRatio !== null && "text-foreground")} />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {aspectRatio === null ? <T>Lock aspect ratio</T> : <T>Unlock aspect ratio</T>}
        </TooltipPopup>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        aria-label={gt("Rotate viewport")}
        disabled={pending}
        onClick={rotate}
      >
        <ScreenRotationIcon />
      </Button>
      <span className="sticky right-0 ml-auto flex bg-background">
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={gt("Close device toolbar")}
          disabled={pending}
          onClick={() => {
            apply({ _tag: "fill" }, null);
          }}
        >
          <X />
        </Button>
      </span>
    </div>
  );
}

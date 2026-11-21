import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo, useCallback } from "react";
import { msg, T, useMessages } from "gt-react";
import { StarIcon } from "lucide-react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { MessageResolver } from "../../i18n/messages";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";

function describeUnavailableInstance(
  entry: ProviderInstanceEntry,
  resolve: MessageResolver,
): string {
  const label = entry.displayName;
  // An unavailable instance (a driver this build lacks or the policy leaves out) says why instead.
  if ((!entry.enabled && entry.isAvailable) || entry.status === "disabled") {
    return resolve(msg("{label}: Disabled in settings.", { label }));
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const message = entry.snapshot.message?.trim();
  if (message) {
    return resolve(
      entry.status === "error"
        ? msg("{label}: Unavailable. {message}", { label, message })
        : entry.status === "warning"
          ? msg("{label}: Limited. {message}", { label, message })
          : msg("{label}: Not ready. {message}", { label, message }),
    );
  }
  return resolve(
    entry.status === "error"
      ? msg("{label}: Unavailable.", { label })
      : entry.status === "warning"
        ? msg("{label}: Limited.", { label })
        : msg("{label}: Not ready.", { label }),
  );
}

const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_SIDE_OFFSET = 8;
const PROVIDER_ROW_CLASS_NAME =
  "relative isolate flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md text-left text-xs text-muted-foreground transition-colors [--picker-provider-background:var(--popover)] enabled:hover:bg-accent enabled:hover:text-accent-foreground enabled:hover:[--picker-provider-background:var(--accent)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-accent-foreground aria-pressed:[--picker-provider-background:var(--accent)] aria-pressed:after:absolute aria-pressed:after:inset-y-2 aria-pressed:after:end-0 aria-pressed:after:w-0.5 aria-pressed:after:rounded-full aria-pressed:after:bg-primary sm:justify-start sm:px-2";
const HORIZONTAL_PROVIDER_ROW_CLASS_NAME =
  "relative isolate flex h-7 max-w-64 cursor-pointer items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors duration-120 [--picker-provider-background:var(--popover)] enabled:hover:bg-accent enabled:hover:text-accent-foreground enabled:hover:[--picker-provider-background:var(--accent)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:[--picker-provider-background:var(--foreground)]";

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  horizontal?: boolean;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
}) {
  const m = useMessages();
  const showFavorites = props.showFavorites ?? true;
  const { horizontal } = props;
  const rowClassName = horizontal ? HORIZONTAL_PROVIDER_ROW_CLASS_NAME : PROVIDER_ROW_CLASS_NAME;
  const tooltipSide = horizontal ? "top" : PICKER_TOOLTIP_SIDE;
  const revealSelected = useCallback(
    (strip: HTMLDivElement | null) => {
      if (!horizontal || !strip) return;
      const selected = strip.querySelector(`[aria-pressed="true"]`);
      if (!selected) return;
      const viewport = strip.getBoundingClientRect();
      const button = selected.getBoundingClientRect();
      if (button.left < viewport.left) strip.scrollLeft += button.left - viewport.left;
      else if (button.right > viewport.right) strip.scrollLeft += button.right - viewport.right;
    },
    // A new selection must be brought into view without resetting manual scroll on other renders.
    [horizontal, props.selectedInstanceId],
  );

  return (
    <Toolbar.Root
      className={cn(
        "shrink-0 overflow-hidden bg-muted/30",
        horizontal ? "w-full border-b border-border/70" : "w-11 sm:w-36",
      )}
      data-model-picker-sidebar="true"
      aria-label={m(msg("Providers"))}
      orientation={horizontal ? "horizontal" : "vertical"}
      onKeyDownCapture={(event) => {
        if (!horizontal || (event.key !== "Home" && event.key !== "End")) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const buttons =
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const button = event.key === "Home" ? buttons[0] : buttons[buttons.length - 1];
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        button.focus();
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== (horizontal ? "ArrowUp" : "ArrowRight")) return;
        event.preventDefault();
        props.onFocusSearch();
      }}
    >
      <div
        className={
          horizontal
            ? "overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
            : "h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
        ref={revealSelected}
        onFocus={(event) => {
          if (horizontal && event.target instanceof HTMLButtonElement) {
            event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }}
      >
        <div
          className={
            horizontal
              ? "flex min-h-10 w-max items-center gap-1 px-2 py-1"
              : "flex min-h-full flex-col gap-1 p-1"
          }
        >
          {showFavorites ? (
            <>
              <div
                className={cn("relative", !horizontal && "w-full")}
                data-model-picker-provider="favorites"
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toolbar.Button
                        className={cn(rowClassName, horizontal && "group")}
                        onClick={() => props.onSelectInstance("favorites")}
                        type="button"
                        aria-label={m(msg("Favorites"))}
                        aria-pressed={props.selectedInstanceId === "favorites"}
                      >
                        <StarIcon
                          className={
                            horizontal
                              ? "size-4 group-aria-pressed:fill-current"
                              : "mx-0.5 size-5 shrink-0 fill-current"
                          }
                          aria-hidden
                        />
                        <span
                          className={
                            horizontal ? "min-w-0 truncate" : "hidden min-w-0 truncate sm:block"
                          }
                        >
                          <T>Favorites</T>
                        </span>
                      </Toolbar.Button>
                    }
                  />
                  <TooltipPopup
                    side={tooltipSide}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    <T>Favorites</T>
                  </TooltipPopup>
                </Tooltip>
              </div>
              <div
                className={
                  horizontal ? "mx-0.5 h-4 border-s border-border/70" : "border-b border-border/70"
                }
                aria-hidden="true"
              />
            </>
          ) : null}

          {props.instanceEntries.map((entry) => {
            const isUnavailable = !isProviderInstancePickerReady(entry);
            const isContextDisabled = props.disabledInstanceIds?.has(entry.instanceId) ?? false;
            const unavailableSelectionIsReachable =
              props.selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
            const isDisabled =
              (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
            const isSelected = props.selectedInstanceId === entry.instanceId;
            const showInstanceBadge = shouldShowInstanceBadge(entry, props.instanceEntries);

            const tooltip = isUnavailable
              ? describeUnavailableInstance(entry, m)
              : isContextDisabled
                ? (props.getDisabledInstanceTooltip?.(entry) ?? entry.displayName)
                : entry.displayName;

            const button = (
              <Toolbar.Button
                className={cn(rowClassName, isDisabled && "cursor-not-allowed opacity-50")}
                data-provider-accent-color={entry.accentColor}
                onClick={() => !isDisabled && props.onSelectInstance(entry.instanceId)}
                disabled={isDisabled}
                focusableWhenDisabled={!isDisabled}
                aria-pressed={isSelected}
                type="button"
                aria-label={isUnavailable || isContextDisabled ? tooltip : entry.displayName}
              >
                <ProviderInstanceIcon
                  driverKind={entry.driverKind}
                  displayName={entry.displayName}
                  accentColor={entry.accentColor}
                  acpRegistryAgentId={entry.acpRegistryAgentId}
                  acpRegistryIconUrl={entry.acpRegistryIconUrl}
                  showBadge={showInstanceBadge}
                  className={horizontal ? "z-30 size-5" : "z-30 size-6"}
                  iconClassName={horizontal ? "size-[17px]" : "size-5"}
                  indicatorBackground="var(--picker-provider-background)"
                  {...(entry.accentColor ? { badgeClassName: "h-3 min-w-3 px-0.5 text-5xs" } : {})}
                />
                <span
                  className={horizontal ? "min-w-0 truncate" : "hidden min-w-0 truncate sm:block"}
                >
                  {entry.displayName}
                </span>
              </Toolbar.Button>
            );

            const trigger = isDisabled ? (
              <span className="relative block w-full">{button}</span>
            ) : (
              button
            );

            return (
              <div
                key={entry.instanceId}
                className={cn("relative", !horizontal && "w-full")}
                data-model-picker-provider={entry.instanceId}
              >
                <Tooltip>
                  <TooltipTrigger render={trigger} />
                  <TooltipPopup
                    side={tooltipSide}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    {tooltip}
                  </TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </Toolbar.Root>
  );
});

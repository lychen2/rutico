import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
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

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
}) {
  const m = useMessages();
  const showFavorites = props.showFavorites ?? true;

  return (
    <Toolbar.Root
      className="w-11 shrink-0 overflow-hidden bg-muted/30 sm:w-36"
      data-model-picker-sidebar="true"
      aria-label={m(msg("Providers"))}
      orientation="vertical"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          props.onFocusSearch();
          return;
        }
      }}
    >
      <div className="h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-h-full flex-col gap-1 p-1">
          {showFavorites ? (
            <>
              <div className="relative w-full" data-model-picker-provider="favorites">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toolbar.Button
                        className={PROVIDER_ROW_CLASS_NAME}
                        onClick={() => props.onSelectInstance("favorites")}
                        type="button"
                        aria-label={m(msg("Favorites"))}
                        aria-pressed={props.selectedInstanceId === "favorites"}
                      >
                        <StarIcon className="mx-0.5 size-5 shrink-0 fill-current" aria-hidden />
                        <span className="hidden min-w-0 truncate sm:block">
                          <T>Favorites</T>
                        </span>
                      </Toolbar.Button>
                    }
                  />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    <T>Favorites</T>
                  </TooltipPopup>
                </Tooltip>
              </div>
              <div className="border-b border-border/70" aria-hidden="true" />
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
                className={cn(
                  PROVIDER_ROW_CLASS_NAME,
                  isDisabled && "cursor-not-allowed opacity-50",
                )}
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
                  className="size-6 z-30"
                  iconClassName="size-5"
                  indicatorBackground="var(--picker-provider-background)"
                  {...(entry.accentColor ? { badgeClassName: "h-3 min-w-3 px-0.5 text-5xs" } : {})}
                />
                <span className="hidden min-w-0 truncate sm:block">{entry.displayName}</span>
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
                className="relative w-full"
                data-model-picker-provider={entry.instanceId}
              >
                <Tooltip>
                  <TooltipTrigger render={trigger} />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
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

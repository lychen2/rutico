import {
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type RuntimeRequestId,
} from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { memo, useState } from "react";
import { EllipsisIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import { Button, InlineButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";

interface ComposerPendingApprovalActionsProps {
  presentation?: "composer" | "inline";
  requestId: RuntimeRequestId;
  isResponding: boolean;
  canRespond: boolean;
  disabled?: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS = [
  {
    decision: "cancel",
    label: msg("Cancel", { $context: "verb, response to an approval request" }),
  },
  {
    decision: "decline",
    label: msg("Decline", { $context: "verb, response to an approval request" }),
  },
  { decision: "acceptForSession", label: msg("Always allow this session") },
  {
    decision: "accept",
    label: msg("Approve", { $context: "verb, response to an approval request" }),
  },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  presentation = "composer",
  requestId,
  isResponding,
  canRespond,
  disabled = false,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const gt = useGT();
  const m = useMessages();
  const [submittedStamp, setSubmittedStamp] = useState<{
    readonly requestId: RuntimeRequestId;
    readonly decision: ProviderApprovalDecision;
    readonly state: "in_flight" | "confirmed";
  } | null>(null);
  const activeStamp =
    submittedStamp?.requestId === requestId &&
    (submittedStamp.state === "confirmed" || submittedStamp.state === "in_flight" || isResponding)
      ? submittedStamp.decision
      : null;
  // Provider options carry server-authored labels; only the built-in defaults are translated.
  const optionLabel = (label: string) => (options === DEFAULT_APPROVAL_OPTIONS ? m(label) : label);
  const primaryOptions = options.filter(
    (option) => option.decision === "decline" || option.decision === "accept",
  );
  const moreOptions = options.filter(
    (option) => option.decision !== "decline" && option.decision !== "accept",
  );

  const submitDecision = (decision: ProviderApprovalDecision) => {
    if (disabled || isResponding || !canRespond) return;
    setSubmittedStamp({ requestId, decision, state: "in_flight" });
    void Promise.resolve(onRespondToApproval(requestId, decision)).then(
      (result) => {
        const confirmed =
          typeof result === "object" &&
          result !== null &&
          "_tag" in result &&
          (result as { readonly _tag?: unknown })._tag === "Success";
        setSubmittedStamp((current) => {
          if (current?.requestId !== requestId || current.decision !== decision) return current;
          return confirmed ? { requestId, decision, state: "confirmed" } : null;
        });
      },
      () => {
        setSubmittedStamp((current) => (current?.requestId === requestId ? null : current));
      },
    );
  };

  if (activeStamp !== null) {
    const isApproved =
      activeStamp === "accept" ||
      activeStamp === "acceptForSession" ||
      activeStamp === "acceptAlways";
    const stampLabel = isApproved
      ? gt("Approved")
      : activeStamp === "cancel"
        ? gt("Cancelled")
        : gt("Declined");
    return (
      <span
        role="status"
        data-approval-stamp={isApproved ? "approved" : "declined"}
        className={
          isApproved
            ? "inline-flex items-center gap-1.5 rounded-full border border-success/35 bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success-foreground"
            : "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/75 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
        }
      >
        {isApproved ? (
          <svg aria-hidden="true" viewBox="0 0 14 14" fill="none" className="size-3 shrink-0">
            <path
              d="M2.8 7.3l2.8 2.8 5.6-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={100}
              data-approval-stamp-check="true"
            />
          </svg>
        ) : (
          <MinusIcon aria-hidden="true" className="size-3 shrink-0" />
        )}
        <span>{stampLabel}</span>
      </span>
    );
  }

  return (
    <>
      {primaryOptions.map((option) => {
        const buttonProps = {
          disabled: disabled || isResponding || !canRespond,
          "aria-description": option.warning,
          onClick: () => submitDecision(option.decision),
        };
        const content = (
          <>
            {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
            <span className={presentation === "inline" ? "whitespace-normal" : "max-w-40 truncate"}>
              {optionLabel(option.label)}
            </span>
          </>
        );
        const button =
          presentation === "inline" ? (
            <InlineButton
              key={option.decision}
              {...buttonProps}
              tone={option.decision === "accept" ? "default" : "muted"}
            >
              {content}
            </InlineButton>
          ) : (
            <Button
              key={option.decision}
              {...buttonProps}
              size="xs"
              variant={option.decision === "accept" ? "default" : "outline"}
            >
              {content}
            </Button>
          );
        return option.warning ? (
          <Tooltip key={option.decision}>
            <TooltipTrigger render={button} />
            <TooltipPopup side="top">{option.warning}</TooltipPopup>
          </Tooltip>
        ) : (
          button
        );
      })}
      {moreOptions.length > 0 ? (
        <Menu>
          <MenuTrigger
            disabled={disabled || isResponding || !canRespond}
            render={
              presentation === "inline" ? (
                <InlineButton tone="muted" aria-label={gt("More approval options")} />
              ) : (
                <Button size="icon-xs" variant="outline" aria-label={gt("More approval options")} />
              )
            }
          >
            {presentation === "inline" ? (
              gt("More", { $context: "button that opens more approval options" })
            ) : (
              <EllipsisIcon />
            )}
          </MenuTrigger>
          <MenuPopup {...composerFloatingLayerProps} side="top" align="end" width="content">
            {moreOptions.map((option) => {
              const item = (
                <MenuItem
                  key={option.decision}
                  disabled={disabled || isResponding || !canRespond}
                  aria-description={option.warning}
                  onClick={() => submitDecision(option.decision)}
                >
                  {option.warning ? <TriangleAlertIcon className="size-3 text-warning" /> : null}
                  <span className="min-w-0 whitespace-normal wrap-break-word">
                    {optionLabel(option.label)}
                  </span>
                </MenuItem>
              );
              return option.warning ? (
                <Tooltip key={option.decision}>
                  <TooltipTrigger render={item} />
                  <TooltipPopup side="top">{option.warning}</TooltipPopup>
                </Tooltip>
              ) : (
                item
              );
            })}
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
});

import {
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type RuntimeRequestId,
} from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { memo, useRef, useState } from "react";
import { EllipsisIcon, LoaderCircleIcon, MinusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button, InlineButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { composerFloatingLayerProps } from "./composerEventScope";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

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

interface ApprovalSubmissionState {
  readonly requestId: RuntimeRequestId;
  readonly decision: ProviderApprovalDecision;
  readonly phase: "in_flight" | "confirmed" | "failed";
  readonly attempt: number;
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

function isApprovedDecision(decision: ProviderApprovalDecision): boolean {
  return decision === "accept" || decision === "acceptForSession" || decision === "acceptAlways";
}

function approvalResultTag(result: unknown): "Success" | "Failure" | undefined {
  if (typeof result !== "object" || result === null || !("_tag" in result)) {
    return undefined;
  }
  const tag = (result as { readonly _tag?: unknown })._tag;
  return tag === "Success" || tag === "Failure" ? tag : undefined;
}

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
  const attemptRef = useRef(0);
  const [submission, setSubmission] = useState<ApprovalSubmissionState | null>(null);
  const activeSubmission = submission?.requestId === requestId ? submission : null;
  const activePhase = activeSubmission?.phase ?? "pending";
  // Provider options carry server-authored labels; only the built-in defaults are translated.
  const optionLabel = (label: string) => (options === DEFAULT_APPROVAL_OPTIONS ? m(label) : label);
  const primaryOptions = options.filter(
    (option) => option.decision === "decline" || option.decision === "accept",
  );
  const moreOptions = options.filter(
    (option) => option.decision !== "decline" && option.decision !== "accept",
  );

  const submitDecision = (decision: ProviderApprovalDecision) => {
    if (disabled || isResponding || !canRespond || activePhase === "in_flight") return;
    const attempt = ++attemptRef.current;
    setSubmission({ requestId, decision, phase: "in_flight", attempt });

    let responsePromise: Promise<unknown>;
    try {
      responsePromise = Promise.resolve(onRespondToApproval(requestId, decision));
    } catch {
      setSubmission({ requestId, decision, phase: "failed", attempt });
      return;
    }

    void responsePromise.then(
      (result) => {
        const tag = approvalResultTag(result);
        setSubmission((current) => {
          if (
            current?.requestId !== requestId ||
            current.decision !== decision ||
            current.attempt !== attempt
          ) {
            return current;
          }
          if (tag === "Success") {
            return { requestId, decision, phase: "confirmed", attempt };
          }
          if (tag === "Failure") {
            return { requestId, decision, phase: "failed", attempt };
          }
          return null;
        });
      },
      () => {
        setSubmission((current) => {
          if (
            current?.requestId !== requestId ||
            current.decision !== decision ||
            current.attempt !== attempt
          ) {
            return current;
          }
          return { requestId, decision, phase: "failed", attempt };
        });
      },
    );
  };

  const confirmedStampKind =
    activeSubmission?.phase === "confirmed"
      ? isApprovedDecision(activeSubmission.decision)
        ? "approved"
        : activeSubmission.decision === "cancel"
          ? "cancelled"
          : "declined"
      : undefined;

  const statusLabel =
    activeSubmission?.phase === "in_flight"
      ? gt("Submitting…")
      : activeSubmission?.phase === "failed"
        ? gt("Failed. Try again.")
        : confirmedStampKind === "approved"
          ? gt("Approved")
          : confirmedStampKind === "cancelled"
            ? gt("Cancelled")
            : confirmedStampKind === "declined"
              ? gt("Declined")
              : "";

  const statusClassName =
    activePhase === "pending"
      ? "sr-only"
      : activePhase === "in_flight"
        ? "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
        : activePhase === "failed"
          ? "inline-flex items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive"
          : confirmedStampKind === "approved"
            ? "inline-flex items-center gap-1.5 rounded-full border border-success/35 bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success-foreground"
            : "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/75 px-2.5 py-0.5 text-xs font-medium text-muted-foreground";

  const showActionControls = activePhase === "pending" || activePhase === "failed";

  return (
    <>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={activePhase === "in_flight" ? true : undefined}
        data-approval-state={activePhase}
        data-approval-stamp={confirmedStampKind}
        className={statusClassName}
      >
        {activePhase === "in_flight" ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-3 shrink-0 motion-safe:animate-spin"
          />
        ) : activePhase === "failed" ? (
          <TriangleAlertIcon aria-hidden="true" className="size-3 shrink-0" />
        ) : confirmedStampKind === "approved" ? (
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
        ) : confirmedStampKind === "cancelled" ? (
          <XIcon aria-hidden="true" className="size-3 shrink-0" />
        ) : confirmedStampKind === "declined" ? (
          <MinusIcon aria-hidden="true" className="size-3 shrink-0" />
        ) : null}
        {statusLabel ? <span>{statusLabel}</span> : null}
      </span>
      {showActionControls ? (
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
                <span
                  className={presentation === "inline" ? "whitespace-normal" : "max-w-40 truncate"}
                >
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
              <SharedTooltipTrigger key={option.decision} render={button} label={option.warning} />
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
                    <Button
                      size="icon-xs"
                      variant="outline"
                      aria-label={gt("More approval options")}
                    />
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
                      {option.warning ? (
                        <TriangleAlertIcon className="size-3 text-warning" />
                      ) : null}
                      <span className="min-w-0 whitespace-normal wrap-break-word">
                        {optionLabel(option.label)}
                      </span>
                    </MenuItem>
                  );
                  return option.warning ? (
                    <SharedTooltipTrigger
                      key={option.decision}
                      render={item}
                      label={option.warning}
                    />
                  ) : (
                    item
                  );
                })}
              </MenuPopup>
            </Menu>
          ) : null}
        </>
      ) : null}
    </>
  );
});

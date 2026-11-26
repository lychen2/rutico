import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
  PUSH_HOOKS_APPROVAL_LABEL,
  PUSH_HOOKS_APPROVAL_QUESTION,
} from "@t3tools/client-runtime/state/thread-requests";
import { msg, T, useMessages } from "gt-react";
import { ShieldIcon } from "lucide-react";
import { memo, use } from "react";
import { type PendingApproval } from "../../session-logic";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ApprovalText } from "./ApprovalText";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { PushHooksApprovalDetails } from "./PushHooksApprovalDetails";
import { ToolActivityIconView, type WorkEntryIconName } from "./TimelineToolActivityIcon";
import { TimelineRowCtx } from "./timelineRowContext";

const APPROVAL_PRESENTATION = {
  command: {
    icon: "terminal",
    label: msg("Command approval"),
    detailLabel: msg("Command", { $context: "noun, shell command awaiting approval" }),
  },
  "file-change": {
    icon: "square-pen",
    label: msg("File change approval"),
    detailLabel: msg("File change"),
  },
  "file-read": { icon: "eye", label: msg("File read approval"), detailLabel: msg("File to read") },
  permission: {
    icon: "wrench",
    label: msg("App permission approval"),
    detailLabel: msg("Permission request"),
  },
  "mcp-elicitation": {
    icon: "hammer",
    label: msg("App access approval"),
    detailLabel: msg("App access request"),
  },
} satisfies Record<
  PendingApproval["requestKind"],
  { icon: WorkEntryIconName; label: string; detailLabel: string }
>;

export const TimelinePendingApprovalRow = memo(function TimelinePendingApprovalRow({
  approval,
}: {
  approval: PendingApproval;
}) {
  const { respondingRequestIds, canOperateThread, onRespondToApproval } = use(TimelineRowCtx);
  const m = useMessages();
  const presentation = APPROVAL_PRESENTATION[approval.requestKind];
  // T3 Code's own question reads as the app asking: a plain sentence, then what it names.
  const { pushHooks } = approval;
  const label = pushHooks ? PUSH_HOOKS_APPROVAL_LABEL : presentation.label;
  const canRespond = approval.responseCapability === "live";
  return (
    <div
      role="group"
      aria-label={m(label)}
      data-v2-item-type="approval_request"
      data-approval-decision-card="true"
      className="my-1.5 flex min-w-0 flex-col gap-2.5 rounded-xl border border-warning/30 bg-card p-3.5 text-xs shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10 text-warning">
            <ToolActivityIconView
              icon={undefined}
              fallbackName={pushHooks ? "terminal" : presentation.icon}
              className="block size-3.5 shrink-0 stroke-2"
              muted={false}
            />
          </span>
          <Badge variant="warning" size="sm">
            {m(label)}
          </Badge>
          {approval.appName ? (
            <span className="min-w-0 truncate text-muted-foreground">{approval.appName}</span>
          ) : null}
        </div>
        {canRespond ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-warning">
            <ShieldIcon aria-hidden className="size-3 shrink-0" />
            <T>Waiting for approval</T>
          </span>
        ) : null}
      </div>
      {pushHooks ? (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/75 bg-code/50 px-3 py-2">
          <span className="block min-w-0 font-medium text-foreground select-text! wrap-anywhere">
            {m(PUSH_HOOKS_APPROVAL_QUESTION)}
          </span>
          <PushHooksApprovalDetails pushHooks={pushHooks} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <ApprovalText
            text={approval.detail || m(presentation.label)}
            label={m(presentation.detailLabel)}
            className="rounded-lg border border-border/75 bg-code/70 px-3 py-2"
          />
        </div>
      )}
      {approval.reason ? (
        <p className="text-muted-foreground select-text wrap-anywhere">{approval.reason}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {!canRespond ? (
            <span className="text-warning">
              <T>Provider process is gone. Interrupt or restart the run to respond.</T>
            </span>
          ) : null}
          {approval.fullAccessOverride ? (
            <Popover>
              <PopoverTrigger openOnHover render={<InlineButton tone="muted" />}>
                {m(FULL_ACCESS_OVERRIDE_QUESTION)}
              </PopoverTrigger>
              <PopoverPopup
                aria-label={m(FULL_ACCESS_OVERRIDE_QUESTION)}
                tooltipStyle
                side="top"
                className="max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal"
              >
                {fullAccessOverrideExplanation(approval.fullAccessOverride, m)}
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>
        {canRespond && onRespondToApproval ? (
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <ComposerPendingApprovalActions
              presentation="composer"
              requestId={approval.requestId}
              disabled={!canOperateThread}
              isResponding={respondingRequestIds.includes(approval.requestId)}
              canRespond={canRespond}
              options={approval.options}
              onRespondToApproval={onRespondToApproval}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

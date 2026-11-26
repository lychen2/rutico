import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import type { ChildThreadApproval } from "@t3tools/client-runtime/state/thread-requests";
import {
  fullAccessOverrideExplanation,
  PUSH_HOOKS_APPROVAL_QUESTION,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { T, useGT, useMessages, Var } from "gt-react";
import { ShieldIcon } from "lucide-react";
import { useState } from "react";
import { useEnvironmentScope } from "../../state/session";
import { childThreadApprovalsAtom, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { ApprovalText } from "./ApprovalText";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { PushHooksApprovalDetails } from "./PushHooksApprovalDetails";

function ChildApproval({
  entry,
  stackIndex,
  stackTotal,
}: {
  entry: ChildThreadApproval;
  stackIndex: number;
  stackTotal: number;
}) {
  const canRespond = useEnvironmentScope(entry.thread.environmentId, AuthOrchestrationOperateScope);
  const respond = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const gt = useGT();
  const messages = useMessages();
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { approval } = entry;
  return (
    <section
      aria-label={gt("Approval from {title}", { title: entry.title })}
      data-approval-decision-card="true"
      data-approval-stack-index={stackIndex}
      className="rounded-xl border border-warning/30 bg-card p-3.5 text-xs shadow-xs"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          <ShieldIcon aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
          <span className="truncate">
            <T>
              Approval needed from <Var>{entry.title}</Var>
            </T>
          </span>
        </p>
        {stackTotal > 1 ? (
          <Badge variant="warning" size="sm">
            <span className="tabular-nums">
              {stackIndex + 1}/{stackTotal}
            </span>
          </Badge>
        ) : null}
      </div>
      {approval.pushHooks ? (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/75 bg-code/50 px-3 py-2">
          <p className="font-medium text-foreground">{messages(PUSH_HOOKS_APPROVAL_QUESTION)}</p>
          <PushHooksApprovalDetails pushHooks={approval.pushHooks} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <ApprovalText
            text={approval.detail || approval.requestKind}
            className="rounded-lg border border-border/75 bg-code/70 px-3 py-2"
          />
        </div>
      )}
      {approval.appName ? <p className="mt-2 text-muted-foreground">{approval.appName}</p> : null}
      {approval.responseCapability !== "live" ? (
        <p className="mt-2 text-warning">
          <T>Provider process is gone. Interrupt or restart the child thread to respond.</T>
        </p>
      ) : null}
      {approval.reason ? <p className="mt-2 text-muted-foreground">{approval.reason}</p> : null}
      {approval.fullAccessOverride ? (
        <p className="mt-2 text-muted-foreground">
          {fullAccessOverrideExplanation(approval.fullAccessOverride, messages)}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
        <ComposerPendingApprovalActions
          presentation="composer"
          requestId={approval.requestId}
          isResponding={responding}
          canRespond={approval.responseCapability === "live"}
          disabled={!canRespond}
          options={approval.options}
          onRespondToApproval={async (requestId, decision) => {
            if (!canRespond || responding) return;
            setResponding(true);
            setError(null);
            const result = await respond({
              environmentId: entry.thread.environmentId,
              input: { threadId: entry.thread.threadId, requestId, decision },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const failure = squashAtomCommandFailure(result);
              setError(
                failure instanceof Error
                  ? failure.message
                  : gt("Failed to submit approval decision."),
              );
            }
            setResponding(false);
            return result;
          }}
        />
      </div>
      {error !== null ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function ChildThreadApprovals({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const approvals = useAtomValue(childThreadApprovalsAtom(threadRef));
  if (approvals.length === 0) return null;
  const stackedDepth = Math.min(3, approvals.length);
  return (
    <div data-approval-stack-depth={stackedDepth} className="relative mb-2">
      {stackedDepth >= 3 ? (
        <div
          aria-hidden="true"
          data-approval-stack-layer="3"
          className="pointer-events-none absolute inset-x-4 -bottom-2 h-3 rounded-b-xl border border-warning/18 bg-card/75"
        />
      ) : null}
      {stackedDepth >= 2 ? (
        <div
          aria-hidden="true"
          data-approval-stack-layer="2"
          className="pointer-events-none absolute inset-x-2 -bottom-1 h-3 rounded-b-xl border border-warning/24 bg-card/90"
        />
      ) : null}
      <div className="relative z-10 flex max-h-80 flex-col gap-2 overflow-auto">
        {approvals.map((entry, index) => (
          <ChildApproval
            key={JSON.stringify([
              entry.thread.environmentId,
              entry.thread.threadId,
              entry.approval.requestId,
            ])}
            entry={entry}
            stackIndex={index}
            stackTotal={approvals.length}
          />
        ))}
      </div>
    </div>
  );
}

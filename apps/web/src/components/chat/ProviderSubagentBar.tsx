import {
  formatProviderSubagentStatus,
  type ProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { ArrowUpLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { tickTextContent } from "~/lib/tickTextContent";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  ReadOnlyComposerBar,
  ReadOnlyComposerLead,
  ReadOnlyComposerStatus,
} from "./ReadOnlyComposerBar";

export function ProviderSubagentBar(props: {
  readonly provider: ProviderInstanceEntry | null;
  readonly showInstanceBadge: boolean;
  readonly modelLabel: string;
  readonly effortLabel: string | null;
  readonly status: ProviderSubagentStatus | null;
  readonly onOpenParent: (() => void) | null;
  readonly actions?: ReactNode;
}) {
  const { status } = props;
  const gt = useGT();
  const messages = useMessages();
  const live = status !== null && isOrchestrationV2WorkActive(status.status);
  const modelDescription =
    props.effortLabel === null ? props.modelLabel : `${props.modelLabel}, ${props.effortLabel}`;
  const announcement = formatProviderSubagentStatus(
    status === null ? null : { ...status, startedAt: null },
    0,
    messages,
  );

  return (
    <ReadOnlyComposerBar
      actions={
        <>
          <span role="status" className="sr-only">
            {gt("{model} subagent: {status}", { model: modelDescription, status: announcement })}
          </span>
          <span className="shrink-0 text-muted-foreground @max-[640px]/composer-surface:sr-only">
            <T>Runs on its own</T>
          </span>
          {props.actions}
          {props.onOpenParent ? (
            <Button size="sm" variant="ghost" onClick={props.onOpenParent}>
              <ArrowUpLeftIcon />
              <span className="@max-[320px]/composer-surface:sr-only">
                <T>Open parent</T>
              </span>
            </Button>
          ) : null}
        </>
      }
    >
      <ReadOnlyComposerLead>
        <span
          data-subagent-bar-badge="true"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/75 bg-card/85 px-2 py-0.5"
        >
          <span
            ref={live ? observeVisibleAnimation : undefined}
            aria-hidden="true"
            data-subagent-bar-dot={live ? "live" : (status?.status ?? "idle")}
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              live
                ? "bg-info"
                : status?.status === "completed"
                  ? "bg-success"
                  : status?.status === "failed"
                    ? "bg-destructive"
                    : "bg-muted-foreground/50",
            )}
          />
          {props.provider ? (
            <ProviderInstanceIcon
              driverKind={props.provider.driverKind}
              displayName={props.provider.displayName}
              accentColor={props.provider.accentColor}
              acpRegistryAgentId={props.provider.acpRegistryAgentId}
              acpRegistryIconUrl={props.provider.acpRegistryIconUrl}
              showBadge={props.showInstanceBadge}
              className="size-3.5 shrink-0"
              iconClassName="size-3.5"
              badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
            />
          ) : null}
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {props.modelLabel}
          </span>
          {props.effortLabel === null ? null : (
            <span className="shrink-0 text-2xs text-muted-foreground">{props.effortLabel}</span>
          )}
        </span>
      </ReadOnlyComposerLead>
      <ReadOnlyComposerStatus
        ref={tickTextContent(
          (nowMs) => formatProviderSubagentStatus(status, nowMs, messages),
          live,
        )}
        aria-hidden
      />
    </ReadOnlyComposerBar>
  );
}

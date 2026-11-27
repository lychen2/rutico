import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/assistantInsights";
import { MessageId, type TurnItemId } from "@t3tools/contracts";
import { canForkProjectedAssistantItem } from "@t3tools/client-runtime/state/thread-workflows";
import { agentWorkingDirectories } from "@t3tools/client-runtime/workspace-basename-lookup";
import { T, useGT, useMessages } from "gt-react";
import { use, useLayoutEffect, useRef, useState } from "react";
import { type ChatMessage } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { GitForkIcon, ReplyIcon } from "lucide-react";
import { captureAssistantMessageOpening } from "~/lib/assistantTextSelection";
import { responseContextRecord } from "~/lib/composerContextRecords";
import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import { observeResize } from "~/lib/observeResize";
import {
  assistantLandingKey,
  claimAssistantLandingAnimation,
  markAssistantMessageStreaming,
} from "./turnLandingChoreography";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { McpAppFrame } from "./McpAppFrame";
import { readResponseSubagents, useAssistantMessageText } from "../../state/entities";
import { MessageCopyButton } from "./MessageCopyButton";
import { AssistantCitationSource } from "./AssistantCitationSource";
import { resolveAssistantMessageCopyState } from "./MessagesTimeline.logic";
import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { readThreadTurnItems } from "../../state/entities";
import { useV2ItemSupport } from "../../state/v2ItemSupport";
import { TimelineRowCtx, TimelineRowActivityCtx, type TimelineRow } from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL, MessageAuthorHeading } from "./TimelineRowParts";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

const magicContextPrefix = /^\u00a7\d+\u00a7(?:[ \t]|$)/;

export function AssistantTimelineRow({
  row,
  isLatest = false,
}: {
  row: Extract<TimelineRow, { kind: "message" }>;
  isLatest?: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  // The timeline holds a streaming message's row while only its text grows.
  const liveText = useAssistantMessageText(
    row.message.streaming ? ctx.threadRef : null,
    row.projectedItem?.item.id,
  );
  const text = liveText ?? row.message.text;
  const messageText =
    text || (row.message.streaming || row.suppressEmptyResponse ? "" : gt("(empty response)"));
  const streamingProseRef = useRef<HTMLDivElement | null>(null);
  const metaRailRef = useRef<HTMLDivElement | null>(null);
  const streamingFloorRef = useRef<{ readonly key: string; height: number }>({
    key: "",
    height: 0,
  });
  const streamingFloorKey = assistantLandingKey(ctx.routeThreadKey, row.message.id);
  const isStreamingMessage = Boolean(row.message.streaming);
  const isLandedMessage = row.showAssistantMeta && !isStreamingMessage;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds a monotonic downward-only min-height floor while streaming to eliminate jitter and clears immediately on settle or LegendList row recycle
  useLayoutEffect(() => {
    const container = streamingProseRef.current;
    if (!container) return;
    if (!isStreamingMessage) {
      container.style.minHeight = "";
      if (streamingFloorRef.current.key === streamingFloorKey) {
        streamingFloorRef.current = { key: "", height: 0 };
      }
      return;
    }
    if (streamingFloorRef.current.key !== streamingFloorKey) {
      streamingFloorRef.current = { key: streamingFloorKey, height: 0 };
      container.style.minHeight = "";
    }
    const syncFloor = () => {
      const measured = Math.ceil(container.offsetHeight);
      if (measured > streamingFloorRef.current.height) {
        streamingFloorRef.current.height = measured;
        container.style.minHeight = `${measured}px`;
      }
    };
    syncFloor();
    const stop = observeResize(container, syncFloor);
    return () => {
      stop();
      container.style.minHeight = "";
    };
  }, [isStreamingMessage, streamingFloorKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays one-shot action-rail lift keyed by stable thread+message identity so LegendList recycling never replays landing animations
  useLayoutEffect(() => {
    const metaRail = metaRailRef.current;
    if (isStreamingMessage) {
      markAssistantMessageStreaming(streamingFloorKey);
      if (metaRail) {
        delete metaRail.dataset.resultJustLanded;
      }
      return;
    }
    if (!isLandedMessage || !metaRail) return;
    if (!claimAssistantLandingAnimation(streamingFloorKey)) {
      delete metaRail.dataset.resultJustLanded;
      return;
    }
    if (prefersReducedMotion() || typeof metaRail.animate !== "function") {
      return;
    }
    metaRail.dataset.resultJustLanded = "true";
    const timing = getSpringWaapiTiming("snappy");
    const animation = metaRail.animate(
      [
        { opacity: 0, transform: "translate3d(0, 3px, 0)" },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      {
        duration: Math.min(240, timing.duration),
        easing: timing.easing,
      },
    );
    const cleanup = () => {
      delete metaRail.dataset.resultJustLanded;
    };
    animation.addEventListener("finish", cleanup, { once: true });
    return () => {
      animation.cancel();
      cleanup();
    };
  }, [isLandedMessage, isStreamingMessage, streamingFloorKey]);

  return (
    <>
      <div
        className="relative min-w-0 px-1 py-0.5"
        data-assistant-response-state={
          row.message.streaming ? "streaming" : row.showAssistantMeta ? "landed" : "progress"
        }
        data-result-landed={isLandedMessage ? "true" : undefined}
      >
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product name stays English */}
        <MessageAuthorHeading>Rutico</MessageAuthorHeading>
        <div ref={streamingProseRef} data-thread-find-text="true">
          <AssistantCitationSource
            messageId={row.message.id}
            {...(ctx.threadRef ? { threadRef: ctx.threadRef } : {})}
            itemKey={row.id}
            request={ctx.citationRequest}
            listRef={ctx.listRef}
          >
            <ChatMarkdown
              text={messageText.replace(magicContextPrefix, "")}
              renderInsights
              cwd={ctx.markdownCwd}
              agentDirectories={() =>
                ctx.threadRef && row.projectedItem
                  ? agentWorkingDirectories(readThreadTurnItems(ctx.threadRef), row.projectedItem)
                  : []
              }
              threadRef={ctx.threadRef ?? undefined}
              isStreaming={Boolean(row.message.streaming)}
              streamingId={row.message.id}
              lineBreaks={shouldPreserveAssistantLineBreaks(messageText)}
              skills={ctx.skills}
              headingLevelOffset={MESSAGE_HEADING_LEVEL}
              onUseArtifactTemplate={ctx.onUseArtifactTemplate}
              onRunShellCommand={ctx.onRunShellCommand}
              onImageExpand={ctx.onImageExpand}
            />
          </AssistantCitationSource>
        </div>
        {!row.showAssistantMeta && row.projectedItem?.item.status === "interrupted" ? (
          <div className="mt-1.5 flex">
            <AssistantStatusBadge status="interrupted" />
          </div>
        ) : null}
        {row.showAssistantMeta ? (
          <div ref={metaRailRef} data-assistant-meta-rail="true">
            <AssistantMessageMeta
              className="mt-1.5"
              projectedItem={row.projectedItem}
              message={row.message}
              showCopyButton={row.showAssistantCopyButton}
              copyStreaming={row.assistantCopyStreaming}
              alwaysVisible={isLatest}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Text an agent sent with `send_to_user`, shown as its own words. */
export function SentMessageTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "sent-message" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product name stays English */}
      <MessageAuthorHeading>Rutico</MessageAuthorHeading>
      {/* Sent messages have no message id; citations name their turn item instead. */}
      <AssistantCitationSource
        messageId={MessageId.make(row.id)}
        {...(ctx.threadRef ? { threadRef: ctx.threadRef } : {})}
        itemKey={row.id}
        request={ctx.citationRequest}
        listRef={ctx.listRef}
      >
        <ChatMarkdown
          text={row.text.replace(magicContextPrefix, "")}
          cwd={ctx.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          lineBreaks={shouldPreserveAssistantLineBreaks(row.text)}
          skills={ctx.skills}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          onUseArtifactTemplate={ctx.onUseArtifactTemplate}
          onRunShellCommand={ctx.onRunShellCommand}
          onImageExpand={ctx.onImageExpand}
        />
      </AssistantCitationSource>
    </div>
  );
}

function AssistantForkButton({
  projectedItem,
}: {
  readonly projectedItem: NonNullable<Extract<TimelineRow, { kind: "message" }>["projectedItem"]>;
}) {
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  const support = useV2ItemSupport({
    environmentId: ctx.activeThreadEnvironmentId,
    sourceThreadId: projectedItem.sourceThreadId,
    sourceItemId: projectedItem.sourceItemId,
  });
  const canFork = canForkProjectedAssistantItem({
    projectedItem,
    capabilities: support.providerSession?.capabilities,
  });

  const onForkFromRun = ctx.onForkFromRun;
  if (!canFork || onForkFromRun === undefined || projectedItem.item.runId === null) return null;
  const runId = projectedItem.item.runId;

  return (
    <SharedTooltipTrigger
      render={
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onForkFromRun({ sourceThreadId: projectedItem.sourceThreadId, runId }).finally(
              () => setBusy(false),
            );
          }}
          aria-label={gt("Fork from this response")}
        />
      }
      label={<T>Fork from this response</T>}
    >
      {busy ? <Spinner size="xs" /> : <GitForkIcon className="size-3" />}
    </SharedTooltipTrigger>
  );
}

export function AssistantMetaTimelineRow({
  row,
  isLatest = false,
}: {
  row: Extract<TimelineRow, { kind: "assistant-meta" }>;
  isLatest?: boolean;
}) {
  return (
    <div className="group/assistant px-1">
      <AssistantMessageMeta
        className="mt-0.5"
        projectedItem={row.projectedItem}
        message={row.message}
        showCopyButton={row.showAssistantCopyButton}
        copyStreaming={row.assistantCopyStreaming}
        alwaysVisible={isLatest}
      />
    </div>
  );
}

function AssistantMessageMeta({
  className,
  projectedItem,
  message,
  showCopyButton,
  copyStreaming,
  alwaysVisible = false,
}: {
  className?: string;
  projectedItem?: Extract<TimelineRow, { kind: "message" }>["projectedItem"];
  message: ChatMessage;
  showCopyButton: boolean;
  copyStreaming: boolean;
  alwaysVisible?: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const m = useMessages();

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs tabular-nums transition-[opacity,transform] duration-180 ease-out motion-reduce:transition-none",
        alwaysVisible
          ? "opacity-100"
          : "translate-y-0.5 opacity-0 pointer-coarse:translate-y-0 pointer-coarse:opacity-100 focus-within:translate-y-0 focus-within:opacity-100 group-hover/assistant:translate-y-0 group-hover/assistant:opacity-100 motion-reduce:translate-y-0",
        className,
      )}
    >
      {projectedItem && projectedItem.item.status !== "completed" ? (
        <AssistantStatusBadge status={projectedItem.item.status} />
      ) : null}
      <AssistantCopyButton
        message={message}
        showCopyButton={showCopyButton}
        streaming={copyStreaming}
      />
      {projectedItem?.item.type === "assistant_message" ? (
        <AssistantForkButton projectedItem={projectedItem} />
      ) : null}
      {!message.streaming && projectedItem ? (
        <AssistantReplyButton message={message} itemId={projectedItem.sourceItemId} />
      ) : null}
      {!message.streaming && (
        <SharedTooltipTrigger
          render={<p className="text-muted-foreground text-xs tabular-nums" />}
          label={formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat, m)}
        >
          {formatDayAwareTimestamp(message.updatedAt, ctx.timestampFormat, undefined, undefined, m)}
        </SharedTooltipTrigger>
      )}
    </div>
  );
}

function AssistantReplyButton({ message, itemId }: { message: ChatMessage; itemId: TurnItemId }) {
  const ctx = use(TimelineRowCtx);
  const gt = useGT();
  const { threadRef, onReplyToResponse } = ctx;
  if (!threadRef || !onReplyToResponse || !message.text.trim()) return null;

  const reply = () => {
    // The meta row can sit below trailing tool rows, so the message may be virtualized away.
    const source = [
      ...document.querySelectorAll<HTMLElement>("[data-assistant-citation-source]"),
    ].find(
      (element) =>
        element.dataset.assistantCitationSource === message.id &&
        element.dataset.assistantCitationThread === threadRef.threadId &&
        element.dataset.assistantCitationEnvironment === threadRef.environmentId,
    );
    const opening = captureAssistantMessageOpening(source ?? null, message.text);
    if (!opening) return;
    onReplyToResponse(
      responseContextRecord({
        citation: { version: 1, ...threadRef, messageId: message.id, ...opening },
        itemId,
        subagents: readResponseSubagents(threadRef, itemId),
      }),
    );
  };

  return (
    <SharedTooltipTrigger
      render={
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          onClick={reply}
          aria-label={gt("Reply to this response")}
        />
      }
      label={
        <>
          <T>Reply to this response</T>
        </>
      }
    >
      <ReplyIcon className="size-3" />
    </SharedTooltipTrigger>
  );
}

function AssistantStatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
      {status}
    </span>
  );
}

function AssistantCopyButton({
  message,
  showCopyButton,
  streaming,
}: {
  message: ChatMessage;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: message.text ?? null,
    showCopyButton,
    streaming,
  });

  if (!assistantCopyState.visible) {
    return null;
  }

  return <MessageCopyButton text={assistantCopyState.text ?? ""} variant="ghost" />;
}

export function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        threadRef={ctx.threadRef ?? undefined}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
        findActive={ctx.findActive}
      />
    </div>
  );
}

export function HtmlRenderTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "html-render" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const { onAppFullscreenChange } = ctx;
  const onFullscreenChange = (fullscreen: boolean) => onAppFullscreenChange(row.id, fullscreen);

  if (ctx.renderHtmlRender) {
    return <div className="min-w-0 px-1">{ctx.renderHtmlRender(row)}</div>;
  }
  return (
    <div className="html-preview-lane min-w-0 px-1">
      <HtmlRenderFrame
        key={row.htmlRender.attachmentId}
        environmentId={ctx.activeThreadEnvironmentId}
        htmlRender={row.htmlRender}
        threadRef={ctx.threadRef ?? undefined}
        onFullscreenChange={onFullscreenChange}
      />
    </div>
  );
}

export function McpAppTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "mcp-app" }> }) {
  const ctx = use(TimelineRowCtx);
  const { awaitingUser } = use(TimelineRowActivityCtx);

  return (
    <div className="min-w-0 px-1">
      <McpAppFrame
        key={row.mcpApp.attachmentId}
        environmentId={ctx.activeThreadEnvironmentId}
        threadId={row.sourceThreadId}
        conversationThreadId={ctx.threadRef?.threadId ?? row.sourceThreadId}
        itemId={row.itemId}
        revision={row.revision}
        app={row.mcpApp}
        onSendMessage={ctx.onSendAppMessage}
        awaitingUser={awaitingUser}
        onFullscreenChange={(fullscreen) => ctx.onAppFullscreenChange(row.id, fullscreen)}
      />
    </div>
  );
}

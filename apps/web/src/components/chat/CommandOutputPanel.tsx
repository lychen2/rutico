import type { CommandOutputView } from "@t3tools/client-runtime/state/command-output";
import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { TERMINAL_PALETTES, terminalOutputSpans } from "@t3tools/shared/terminalOutput";
import { T, useGT, Var } from "gt-react";
import { ArrowDownIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { useTheme } from "../../hooks/useTheme";
import { useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useInitialOutputReady, type TurnItemSource } from "./timelineRowContext";

const FOLLOW_SLACK_PX = 8;

export function useCommandOutputStreaming(environmentId: EnvironmentId): boolean {
  return (
    useServerConfigs().get(environmentId)?.environment.capabilities.commandOutputStreaming === true
  );
}

/**
 * Output of one expanded command row: streams while the command runs, then
 * shows its final output. Mount it only when `useCommandOutputStreaming` holds
 * or a `source` serves the output.
 * It subscribes only while mounted, so collapsed rows and other threads receive nothing.
 */
export function CommandOutputPanel(props: {
  readonly onInitialOutputReady?: (() => void) | undefined;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly source?: TurnItemSource["commandOutput"] | undefined;
}) {
  const gt = useGT();
  const input = { threadId: props.threadId, itemId: props.itemId };
  const { data, error } = useEnvironmentQuery<CommandOutputView, unknown>(
    props.source
      ? props.source(input)
      : orchestrationEnvironment.v2.commandOutput({ environmentId: props.environmentId, input }),
  );
  useInitialOutputReady(data === null && !error, props.onInitialOutputReady);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [scrolledAway, setScrolledAway] = useState(false);
  const text = data?.output.text ?? "";
  const { resolvedTheme } = useTheme();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pins the output scroller's scrollTop to the bottom after each commit while the user follows
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });

  if (text.length === 0) {
    if (error) {
      return (
        <div className="text-destructive">
          <T>
            Couldn&apos;t load output: <Var>{error}</Var>
          </T>
        </div>
      );
    }
    if (data === null) {
      return (
        <div className="text-muted-foreground italic">
          <T>Loading output…</T>
        </div>
      );
    }
    return data.running ? null : (
      <div className="text-muted-foreground italic">
        <T>No output.</T>
      </div>
    );
  }
  // Parse after all hooks to preserve the text/theme compiler cache.
  const spans = terminalOutputSpans(text, TERMINAL_PALETTES[resolvedTheme]);
  return (
    <div
      data-telemetry-well="true"
      className="relative overflow-hidden rounded-lg border border-border/75 bg-code/70"
    >
      <div
        ref={scrollRef}
        data-command-output-scroller="true"
        data-command-output-faded={scrolledAway ? "true" : undefined}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
          followRef.current = atBottom;
          const nextScrolledAway = !atBottom && element.scrollHeight > element.clientHeight + 24;
          setScrolledAway((current) => (current === nextScrolledAway ? current : nextScrolledAway));
        }}
        className="max-h-80 overflow-auto px-3 py-2 text-muted-foreground [scrollbar-width:thin]"
      >
        {data?.output.truncated ? (
          <div className="mb-1 italic text-muted-foreground/75">
            <T>Earlier output not shown</T>
          </div>
        ) : null}
        {spans.map((span, index) =>
          span.style === null ? (
            span.text
          ) : (
            // Spans never reorder and are rebuilt on each update.
            // oxlint-disable-next-line react/no-array-index-key
            <span key={index} style={span.style}>
              {span.text}
            </span>
          ),
        )}
      </div>
      {scrolledAway ? (
        <button
          type="button"
          data-command-jump-bottom="true"
          aria-label={gt("Jump to bottom of output")}
          onClick={() => {
            const element = scrollRef.current;
            if (!element) return;
            followRef.current = true;
            setScrolledAway(false);
            element.scrollTo({
              top: element.scrollHeight,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            });
          }}
          className="absolute right-2 bottom-2 inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/80 bg-card px-2 py-0.5 font-sans text-2xs font-medium text-foreground shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-95 motion-reduce:transition-none"
        >
          <ArrowDownIcon aria-hidden="true" className="size-2.5" />
          <span>{gt("Bottom")}</span>
        </button>
      ) : null}
    </div>
  );
}

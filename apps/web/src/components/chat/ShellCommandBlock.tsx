import {
  commandHighlightLanguage,
  withVisibleControlCharacters,
} from "@t3tools/client-runtime/work-log/command-label";
import { msg, T, useGT, Var } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Suspense, use } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { cn } from "../../lib/utils";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HighlightedTokens } from "./HighlightedTokens";

const WORD_CLASS_NAME = "[overflow-wrap:anywhere]";

let embeddedScriptsModule:
  | Promise<typeof import("@t3tools/client-runtime/work-log/embedded-scripts")>
  | undefined;
function loadEmbeddedScripts() {
  embeddedScriptsModule ??= import("@t3tools/client-runtime/work-log/embedded-scripts");
  return embeddedScriptsModule;
}

// Match highlighted layout to prevent reflow when the grammar arrives.
function PlainWords({ code }: { code: string }) {
  return code.split(/(\s+)/u).map((part, index) =>
    index % 2 === 1 || part === "" ? (
      part
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- positions are stable for one string
      <span key={index} className={WORD_CLASS_NAME}>
        {part}
      </span>
    ),
  );
}

function HighlightedCommand({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const { embeddedScripts } = use(loadEmbeddedScripts());
  const language = commandHighlightLanguage(code);
  const embedded = language === "shellscript" ? embeddedScripts(code) : [];
  return (
    <HighlightedTokens
      code={code}
      language={language}
      embedded={embedded}
      theme={theme}
      wordClassName={WORD_CLASS_NAME}
    />
  );
}

export function ShellCommandBlock({
  command,
  running = false,
  exitCode,
  framed = true,
}: {
  command: string;
  running?: boolean;
  exitCode?: number | undefined;
  framed?: boolean;
}) {
  const gt = useGT();
  const resolvedTheme = useRenderedAppearance();
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1600,
    target: {
      target: "command",
      unavailableMessage: msg("Clipboard API is unavailable while copying command."),
      failureMessage: msg("Failed to copy command to the clipboard."),
    },
  });
  const trimmed = command.trim();
  const code = withVisibleControlCharacters(trimmed);
  if (!code) return null;
  const plain = <PlainWords code={code} />;
  const showExitOk = !running && exitCode === 0;
  const showExitError = !running && exitCode !== undefined && exitCode !== 0;

  return (
    <div
      data-telemetry-command={framed ? "framed" : "plain"}
      className={cn(
        "group/cmd flex min-w-0 items-start gap-2 text-foreground/90",
        framed && "rounded-lg border border-border/75 bg-code/70 px-2.5 py-1.5",
      )}
    >
      <span aria-hidden="true" className="select-none font-mono text-muted-foreground/65">
        $
      </span>
      <div className="min-w-0 flex-1">
        <RenderErrorBoundary fallback={plain} resetKeys={[code]}>
          <Suspense fallback={plain}>
            <HighlightedCommand code={code} theme={resolvedTheme} />
          </Suspense>
        </RenderErrorBoundary>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-start">
        {running ? (
          <span
            data-exit-code-pill="running"
            className="inline-flex items-center gap-1 rounded-full bg-info/12 px-1.5 py-0.5 font-sans text-2xs font-medium text-info tabular-nums"
          >
            <span
              ref={observeVisibleAnimation}
              aria-hidden="true"
              data-exit-running-dot="true"
              className="size-1.5 rounded-full bg-info"
            />
            <span>{gt("Running")}</span>
          </span>
        ) : showExitOk ? (
          <span
            data-exit-code-pill="ok"
            className="inline-flex items-center gap-1 rounded-full bg-success/14 px-1.5 py-0.5 font-mono text-2xs font-medium text-success-foreground tabular-nums"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className="size-2.5 shrink-0">
              <path
                d="M2.4 6.2l2.3 2.3 4.9-5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                data-exit-check-mark="true"
              />
            </svg>
            <span>0</span>
          </span>
        ) : showExitError ? (
          <span
            data-exit-code-pill="error"
            className="inline-flex items-center gap-1 rounded-full bg-destructive/14 px-1.5 py-0.5 font-mono text-2xs font-medium text-destructive tabular-nums"
          >
            <T>
              exit <Var>{exitCode}</Var>
            </T>
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={isCopied ? gt("Copied command") : gt("Copy command")}
                onClick={() => copyToClipboard(trimmed, undefined)}
                className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/75 transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-95 motion-reduce:transition-none"
              />
            }
          >
            {isCopied ? (
              <CheckIcon
                aria-hidden="true"
                data-telemetry-copy-check="true"
                className="size-3 text-success-foreground"
              />
            ) : (
              <CopyIcon aria-hidden="true" className="size-3" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">{isCopied ? gt("Copied") : gt("Copy command")}</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

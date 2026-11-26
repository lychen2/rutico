import { useGT } from "gt-react";
import { CodeIcon, WorkflowIcon } from "lucide-react";
import { Suspense, use, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { findRevealRef, MarkdownFindContext } from "./markdownFindContext";
import { MermaidDiagram } from "./MermaidDiagram";

export function MarkdownMermaidCodeBlock({
  code,
  fenceTitle,
  theme,
  isStreaming,
  onExpand,
  children,
}: {
  code: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  isStreaming: boolean;
  onExpand: (imageUrl: string) => void;
  children: ReactNode;
}) {
  const gt = useGT();
  const [showCode, setShowCode] = useState(false);
  const searching = use(MarkdownFindContext);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previousHeightRef = useRef<number | null>(null);
  const previousModeRef = useRef<boolean | null>(null);
  const activeAnimationRef = useRef<Animation | null>(null);

  const captureCurrentHeight = () => {
    const stage = stageRef.current;
    if (stage) {
      previousHeightRef.current = stage.offsetHeight;
    }
  };
  const revealSource = () => {
    captureCurrentHeight();
    setShowCode(true);
  };
  const sourceRevealRef = findRevealRef(revealSource);
  const showDiagram = !showCode && !isStreaming && code.trim().length > 0;
  const activeMode = showDiagram ? "diagram" : "code";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures offsetHeight across discrete Mermaid source/diagram transitions and releases inline styles on WAAPI finish
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const prevMode = previousModeRef.current;
    previousModeRef.current = showDiagram;
    const prevHeight = previousHeightRef.current;
    const nextHeight = stage.offsetHeight;
    previousHeightRef.current = nextHeight;

    if (
      prevMode === null ||
      prevMode === showDiagram ||
      prevHeight === null ||
      Math.abs(nextHeight - prevHeight) < 2 ||
      prefersReducedMotion() ||
      typeof stage.animate !== "function"
    ) {
      return;
    }

    activeAnimationRef.current?.cancel();
    stage.style.overflow = "clip";
    const timing = getSpringWaapiTiming("spatial");
    const animation = stage.animate(
      [
        {
          height: `${prevHeight}px`,
          clipPath: "inset(0 0 8% 0 round 8px)",
          opacity: 0.55,
        },
        {
          height: `${nextHeight}px`,
          clipPath: "inset(0 0 0% 0 round 8px)",
          opacity: 1,
        },
      ],
      {
        duration: Math.min(340, timing.duration),
        easing: timing.easing,
      },
    );
    activeAnimationRef.current = animation;
    const release = () => {
      stage.style.overflow = "";
      stage.style.height = "";
      if (activeAnimationRef.current === animation) {
        activeAnimationRef.current = null;
      }
    };
    animation.addEventListener("finish", release, { once: true });
    return () => {
      animation.cancel();
      release();
    };
  }, [showDiagram]);

  return (
    <MarkdownCodeBlock
      code={code}
      language="mermaid"
      fenceTitle={fenceTitle}
      theme={theme}
      isStreaming={isStreaming}
      canWrap={!showDiagram}
      diagram={showDiagram}
      viewToggle={
        isStreaming ? null : (
          <ToggleGroup
            variant="segmented"
            value={[activeMode]}
            onValueChange={(next) => {
              const selected = next[0];
              if (selected !== "diagram" && selected !== "code") return;
              captureCurrentHeight();
              setShowCode(selected === "code");
            }}
            aria-label={gt("Diagram view")}
          >
            <Tooltip>
              <TooltipTrigger
                render={<ToggleGroupItem value="diagram" aria-label={gt("Show diagram")} />}
              >
                <WorkflowIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{gt("Show diagram")}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<ToggleGroupItem value="code" aria-label={gt("Show code")} />}
              >
                <CodeIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{gt("Show code")}</TooltipPopup>
            </Tooltip>
          </ToggleGroup>
        )
      }
    >
      <div ref={stageRef} data-mermaid-stage={activeMode}>
        {showDiagram ? (
          <RenderErrorBoundary resetKeys={[code, theme]} fallback={children}>
            <Suspense
              fallback={
                <pre className="invisible" aria-hidden>
                  {code}
                </pre>
              }
            >
              <MermaidDiagram source={code} onExpand={onExpand} />
            </Suspense>
            {searching ? (
              <pre ref={sourceRevealRef} hidden aria-hidden>
                {code}
              </pre>
            ) : null}
          </RenderErrorBoundary>
        ) : (
          children
        )}
      </div>
    </MarkdownCodeBlock>
  );
}

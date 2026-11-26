import { useRef, type ReactNode, type UIEvent } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "embedded";
  return cn(
    "@container/diff-header flex items-center justify-between gap-2",
    mode === "embedded" ? "px-2" : "px-4",
    shouldUseDragRegion
      ? "drag-region h-[var(--workspace-topbar-height)] border-b border-border wco:pr-(--workspace-native-controls-inset)"
      : "flex h-10 min-h-10 shrink-0 items-center border-b border-border/60 bg-background in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent",
  );
}

interface DiffHeatRibbonSegment {
  readonly fileKey: string;
  readonly additions: number;
  readonly deletions: number;
  readonly weight: number;
  readonly additionShare: number;
}

function buildDiffHeatSegments(
  files: ReadonlyArray<{
    readonly fileKey: string;
    readonly filePath: string;
    readonly fileDiff: {
      readonly hunks: ReadonlyArray<{
        readonly additionLines: number;
        readonly deletionLines: number;
      }>;
    };
  }>,
  lazyFiles?: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>,
): DiffHeatRibbonSegment[] {
  const statsByPath = lazyFiles ? new Map(lazyFiles.map((file) => [file.path, file])) : null;
  return files.map(({ fileDiff, fileKey, filePath }) => {
    const lazyStat = statsByPath?.get(filePath);
    let additions = lazyStat?.additions ?? 0;
    let deletions = lazyStat?.deletions ?? 0;
    if (!lazyStat) {
      for (const hunk of fileDiff.hunks) {
        additions += hunk.additionLines;
        deletions += hunk.deletionLines;
      }
    }
    const total = Math.max(1, additions + deletions);
    return {
      fileKey,
      additions,
      deletions,
      weight: total,
      additionShare: additions / total,
    };
  });
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: ReactNode;
  heatFiles?: ReadonlyArray<{
    readonly fileKey: string;
    readonly filePath: string;
    readonly fileDiff: {
      readonly hunks: ReadonlyArray<{
        readonly additionLines: number;
        readonly deletionLines: number;
      }>;
    };
  }>;
  heatLazyFiles?: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  children: ReactNode;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const heatSegments = props.heatFiles
    ? buildDiffHeatSegments(props.heatFiles, props.heatLazyFiles)
    : null;
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const ratioRef = useRef(0);

  const handleScrollCapture = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const maxScroll = target.scrollHeight - target.clientHeight;
    if (maxScroll <= 0) return;
    // Ignore inner horizontal-only scrollers or tiny sub-elements inside the diff body.
    if (target.clientHeight < 120) return;
    ratioRef.current = Math.max(0, Math.min(1, target.scrollTop / maxScroll));
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const cursor = cursorRef.current;
      if (!cursor) return;
      const next = ratioRef.current;
      cursor.style.transform = `scaleX(${next.toFixed(4)})`;
      cursor.style.opacity = next > 0.002 ? "1" : "0";
    });
  };

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
      onScrollCapture={heatSegments && heatSegments.length > 0 ? handleScrollCapture : undefined}
    >
      {shouldUseDragRegion ? (
        <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
      ) : (
        <div className={getDiffPanelHeaderRowClassName(props.mode)} data-surface-subheader>
          {props.header}
        </div>
      )}
      {heatSegments && heatSegments.length > 0 ? (
        <div
          aria-hidden="true"
          data-slot="diff-heat-ribbon"
          className="relative h-0.5 w-full shrink-0 overflow-hidden bg-border/35"
        >
          <div className="flex h-full w-full gap-px opacity-55">
            {heatSegments.map((segment) => (
              <div
                key={segment.fileKey}
                className="flex h-full min-w-0.5 overflow-hidden"
                style={{ flexGrow: segment.weight }}
              >
                {segment.additions > 0 ? (
                  <span
                    className="h-full bg-diff-addition-foreground/80"
                    style={{ width: `${Math.round(segment.additionShare * 100)}%` }}
                  />
                ) : null}
                {segment.deletions > 0 ? (
                  <span
                    className="h-full bg-diff-deletion-foreground/80"
                    style={{ width: `${Math.round((1 - segment.additionShare) * 100)}%` }}
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div
            ref={(node) => {
              cursorRef.current = node;
              return () => {
                if (cursorRef.current === node) cursorRef.current = null;
                if (frameRef.current !== null) {
                  window.cancelAnimationFrame(frameRef.current);
                  frameRef.current = null;
                }
              };
            }}
            data-slot="diff-scroll-ribbon-cursor"
            className="pointer-events-none absolute inset-0 origin-left bg-primary/90 opacity-0 will-change-transform"
            style={{ transform: "scaleX(0)" }}
          />
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

export function DiffFileHeaderSkeleton({
  titleWidth,
}: {
  titleWidth: "short" | "medium" | "long";
}) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 pr-3">
      <div className="flex size-5 shrink-0 items-center justify-center">
        <Skeleton className="size-2.5" />
      </div>
      <Skeleton className="size-5 shrink-0" />
      <Skeleton
        shape="pill"
        className={
          titleWidth === "short"
            ? "h-3 w-2/5 max-w-52"
            : titleWidth === "medium"
              ? "h-3 w-1/2 max-w-64"
              : "h-3 w-3/5 max-w-72"
        }
      />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton shape="pill" className="h-3 w-5" />
        <Skeleton shape="pill" className="h-3 w-5" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton({ width }: { width: "short" | "medium" | "long" }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton shape="pill" className="h-2.5 w-5 shrink-0" />
      <Skeleton
        shape="pill"
        className={
          width === "short" ? "h-2.5 w-3/5" : width === "medium" ? "h-2.5 w-2/3" : "h-2.5 w-4/5"
        }
      />
    </div>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <DiffFileHeaderSkeleton titleWidth="medium" />
      <div className="flex h-6 items-center gap-2 px-2 pr-3">
        <div className="h-px flex-1 bg-border/40" />
        <Skeleton shape="pill" className="h-2.5 w-24" />
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton width="medium" />
        <DiffCodeLineSkeleton width="long" />
        <DiffCodeLineSkeleton width="short" />
      </div>
      <DiffFileHeaderSkeleton titleWidth="short" />
      <DiffFileHeaderSkeleton titleWidth="long" />
      <span className="sr-only">{props.label}</span>
    </div>
  );
}

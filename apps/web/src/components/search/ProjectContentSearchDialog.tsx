import { Spinner } from "~/components/ui/spinner";
import { AuthFilesystemReadScope, type ProjectContentMatch } from "@t3tools/contracts";

import { T, useGT, useMessages, Var } from "gt-react";
import {
  CornerDownLeftIcon,
  FolderSearchIcon,
  LockIcon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  getProjectFileContents,
  useProjectFileQuery,
} from "~/components/files/projectFilesQueryState";
import { AnimatedNumber } from "~/components/ui/animated-number";
import { FloatingHighlight } from "~/components/ui/floating-highlight";
import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useRenderedAppearance, useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { useProjectContentSearch } from "~/state/queries";
import { readEnvironmentScope } from "~/state/session";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle } from "../ui/toggle";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import {
  HighlightedSearchContext,
  HighlightedSearchLine,
  type SearchContextLine,
} from "./HighlightedSearchLine";

interface ProjectContentSearchDialogProps {
  readonly onOpenChange: (open: boolean) => void;
}

/** Syntax-highlighting all 500 result rows at once stalls the UI. */
const VISIBLE_MATCH_WINDOW = 100;
const CONTEXT_RADIUS_LINES = 8;
const PEEK_PREFETCH_DEBOUNCE_MS = 120;

function formatLocaleCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function buildContextWindow(
  contents: string | undefined,
  match: ProjectContentMatch,
): SearchContextLine[] {
  if (contents === undefined) {
    return [
      {
        lineNumber: match.lineNumber,
        content: match.lineContent,
        isTarget: true,
      },
    ];
  }
  const allLines = contents.split(/\r?\n/);
  const targetIdx = Math.max(0, Math.min(allLines.length - 1, match.lineNumber - 1));
  const startIdx = Math.max(0, targetIdx - CONTEXT_RADIUS_LINES);
  const endIdx = Math.min(allLines.length - 1, targetIdx + CONTEXT_RADIUS_LINES);
  const lines: SearchContextLine[] = [];
  for (let index = startIdx; index <= endIdx; index++) {
    lines.push({
      lineNumber: index + 1,
      content: allLines[index] ?? "",
      isTarget: index === targetIdx,
    });
  }
  return lines;
}

function SearchContextPeekPane(props: {
  readonly target: ActiveProjectTarget;
  readonly match: ProjectContentMatch | undefined;
  readonly canRead: boolean;
  readonly resolvedTheme: "light" | "dark";
  readonly renderedAppearance: "light" | "dark";
  readonly onOpenMatch: (match: ProjectContentMatch) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const match = props.match;
  const matchPath = match?.path ?? null;
  const cachedContents =
    matchPath !== null && props.canRead
      ? getProjectFileContents(props.target.environmentId, props.target.cwd, matchPath)
      : undefined;
  const hasCachedContents = cachedContents !== undefined;

  const [debouncedPath, setDebouncedPath] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces file prefetching by 120ms so holding ArrowDown does not storm file reads
  useEffect(() => {
    if (matchPath === null || !props.canRead || hasCachedContents) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedPath(matchPath);
    }, PEEK_PREFETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hasCachedContents, matchPath, props.canRead]);

  const activeQueryPath =
    matchPath !== null && !hasCachedContents && debouncedPath === matchPath ? matchPath : null;
  const fileQuery = useProjectFileQuery(
    props.target.environmentId,
    props.target.cwd,
    activeQueryPath,
    props.canRead && activeQueryPath !== null,
    messages,
  );

  if (!match) return null;

  const contents = cachedContents ?? fileQuery.data?.contents;
  const contextLines = buildContextWindow(contents, match);
  const pathParts = splitPath(match.path);

  return (
    <aside
      aria-label={gt("Match context preview")}
      data-slot="search-context-peek"
      className="hidden min-h-0 min-w-0 flex-1 flex-col bg-background/70 @min-[42rem]:flex"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 bg-popover px-3 text-xs">
        <PierreEntryIcon
          pathValue={match.path}
          kind="file"
          theme={props.resolvedTheme}
          className="size-3.5 shrink-0"
        />
        <span className="truncate font-medium text-foreground">{pathParts.name}</span>
        {pathParts.directory ? (
          <span className="min-w-0 truncate text-muted-foreground">{pathParts.directory}</span>
        ) : null}
        <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">
          :{match.lineNumber}
        </span>
        <button
          type="button"
          disabled={!props.canRead}
          onClick={() => props.onOpenMatch(match)}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <span>
            <T>Open</T>
          </span>
          <CornerDownLeftIcon className="size-3" />
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div key={`${match.path}:${match.lineNumber}`} className="search-context-pane-body py-2">
          <HighlightedSearchContext
            lines={contextLines}
            match={match}
            path={match.path}
            theme={props.renderedAppearance}
          />
          {contents === undefined && fileQuery.isPending ? (
            <div className="mt-2 flex items-center gap-2 px-3 text-2xs text-muted-foreground">
              <Spinner size="xs" />
              <span>
                <T>Loading context…</T>
              </span>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}

interface MatchGroup {
  readonly path: string;
  readonly matches: ReadonlyArray<ProjectContentMatch & { readonly resultIndex: number }>;
}

function splitPath(path: string): { readonly name: string; readonly directory: string } {
  const separator = path.lastIndexOf("/");
  return separator === -1
    ? { name: path, directory: "" }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
}

function groupMatches(matches: ReadonlyArray<ProjectContentMatch>): MatchGroup[] {
  const groups = new Map<string, Array<ProjectContentMatch & { readonly resultIndex: number }>>();
  matches.forEach((match, resultIndex) => {
    const group = groups.get(match.path);
    const indexedMatch = { ...match, resultIndex };
    if (group) {
      group.push(indexedMatch);
    } else {
      groups.set(match.path, [indexedMatch]);
    }
  });
  return [...groups].map(([path, groupedMatches]) => ({ path, matches: groupedMatches }));
}

function SearchOptionButton(props: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <SharedTooltipTrigger
      render={
        <Toggle
          aria-label={props.label}
          disabled={props.disabled}
          pressed={props.active}
          size="segmented"
          variant="segmented"
          onClick={props.onClick}
        />
      }
      label={props.label}
    >
      <span className="font-mono">{props.children}</span>
    </SharedTooltipTrigger>
  );
}

function EmptyContentSearchDialog() {
  const gt = useGT();
  return (
    <CommandPaletteContent
      aria-label={gt("Search project contents")}
      escapeLabel={gt("Back")}
      footerActionLabel={gt("Open file")}
      inputProps={{ disabled: true, placeholder: gt("Search project contents…") }}
      mode="none"
      panelSize="fill"
      testId="project-content-search"
      value=""
    >
      <Empty size="compact">
        <EmptyMedia variant="icon">
          <FolderSearchIcon className="size-4.5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyDescription>
            <T>Open a project to search its files.</T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </CommandPaletteContent>
  );
}

const scrollSelectedRowIntoView = (row: HTMLElement | null) => {
  row?.scrollIntoView({ block: "nearest" });
};

function OpenContentSearchDialog(props: {
  readonly onOpenChange: (open: boolean) => void;
  readonly target: ActiveProjectTarget;
}) {
  const { target } = props;
  const gt = useGT();
  const messages = useMessages();
  const { resolvedTheme } = useTheme();
  const renderedAppearance = useRenderedAppearance();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [visibleCount, setVisibleCount] = useState(VISIBLE_MATCH_WINDOW);

  const search = useProjectContentSearch(
    {
      environmentId: target.environmentId,
      cwd: target.cwd,
      query,
      caseSensitive,
      wholeWord,
      useRegex,
    },
    messages,
  );
  const canOpenMatches = search.canReadFiles && !search.isPending && search.error === null;
  const matches = search.matches;
  const [resultsFor, setResultsFor] = useState(matches);
  if (resultsFor !== matches) {
    setResultsFor(matches);
    setSelectedIndex(0);
    setVisibleCount(VISIBLE_MATCH_WINDOW);
  }
  if (selectedIndex >= visibleCount) {
    setVisibleCount(selectedIndex + VISIBLE_MATCH_WINDOW);
  }
  const visibleMatches = matches.slice(0, visibleCount);
  const groups = groupMatches(visibleMatches);

  const observeLoadMoreSentinel = (sentinel: HTMLElement | null) => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((current) => current + VISIBLE_MATCH_WINDOW);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  };

  const openMatch = (match: ProjectContentMatch) => {
    if (!canOpenMatches || !readEnvironmentScope(target.environmentId, AuthFilesystemReadScope)) {
      return;
    }
    props.onOpenChange(false);
    useRightPanelStore.getState().openFile(target.threadRef, match.path, match.lineNumber);
  };
  const fileCount = new Set(matches.map((match) => match.path)).size;
  const showSearchStatus =
    search.canReadFiles &&
    (search.hasQuery || search.isPending || search.error !== null || search.invalidRegex);

  return (
    <CommandPaletteContent
      aria-label={gt("Search file contents in {project}", { project: target.projectName })}
      escapeLabel={gt("Back")}
      footerActionLabel={gt("Open file")}
      inputAccessory={
        <div className="absolute inset-e-2.5 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
          <SearchOptionButton
            active={caseSensitive}
            disabled={!search.canReadFiles}
            label={gt("Match case")}
            onClick={() => setCaseSensitive((current) => !current)}
          >
            {/* oxlint-disable-next-line t3code/no-untranslated-copy -- match-case glyph; the label carries the meaning */}
            {"Aa"}
          </SearchOptionButton>
          <SearchOptionButton
            active={wholeWord}
            disabled={!search.canReadFiles}
            label={gt("Match whole word")}
            onClick={() => setWholeWord((current) => !current)}
          >
            <span className="underline decoration-2 underline-offset-2">ab</span>
          </SearchOptionButton>
          <SearchOptionButton
            active={useRegex}
            disabled={!search.canReadFiles}
            label={gt("Use regular expression")}
            onClick={() => setUseRegex((current) => !current)}
          >
            .*
          </SearchOptionButton>
        </div>
      }
      inputProps={{
        className: "pe-30",
        disabled: !search.canReadFiles,
        placeholder: gt("Search in {project}", { project: target.projectName }),
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" && matches.length > 0) {
            event.preventDefault();
            setSelectedIndex((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp" && matches.length > 0) {
            event.preventDefault();
            setSelectedIndex((current) => (current - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter") {
            if (!canOpenMatches) {
              event.preventDefault();
              return;
            }
            const match = matches[selectedIndex];
            if (match) {
              event.preventDefault();
              openMatch(match);
            }
          }
        },
      }}
      mode="none"
      onValueChange={setQuery}
      panelSize="fill"
      testId="project-content-search"
      value={query}
    >
      {showSearchStatus ? (
        <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">
          {search.isPending ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" /> <T>Searching…</T>
            </span>
          ) : search.error ? (
            <span className="text-destructive">{search.error}</span>
          ) : search.invalidRegex ? (
            <span className="text-destructive">
              <T>Invalid regular expression</T>
            </span>
          ) : search.truncated ? (
            <span className="inline-flex items-baseline gap-1">
              <T>
                <Var>
                  <AnimatedNumber value={matches.length} format={formatLocaleCount} />
                </Var>
                + results in{" "}
                <Var>
                  <AnimatedNumber value={fileCount} format={formatLocaleCount} />
                </Var>{" "}
                files
              </T>
            </span>
          ) : (
            <span className="inline-flex items-baseline gap-1">
              <T>
                <Var>
                  <AnimatedNumber value={matches.length} format={formatLocaleCount} />
                </Var>{" "}
                results in{" "}
                <Var>
                  <AnimatedNumber value={fileCount} format={formatLocaleCount} />
                </Var>{" "}
                files
              </T>
            </span>
          )}
        </div>
      ) : null}

      {matches.length === 0 ? (
        <Empty size="compact">
          <EmptyMedia variant={search.isCheckingAccess ? "default" : "icon"}>
            {search.isCheckingAccess ? (
              <Spinner />
            ) : !search.canReadFiles ? (
              <LockIcon className="size-4.5 text-muted-foreground" />
            ) : search.hasQuery && !search.isPending && !search.error ? (
              <SearchXIcon className="size-4.5 text-muted-foreground" />
            ) : (
              <SearchIcon className="size-4.5 text-muted-foreground" />
            )}
          </EmptyMedia>
          <EmptyHeader>
            <EmptyDescription>
              {search.isCheckingAccess
                ? gt("Checking file access…")
                : !search.canReadFiles
                  ? search.error
                  : search.hasQuery && !search.isPending && !search.error
                    ? gt("No results found.")
                    : gt("Type to search across your project.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="@container flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col @min-[42rem]:w-[52%] @min-[42rem]:flex-none @min-[42rem]:border-r @min-[42rem]:border-border/60">
            <ScrollArea className="min-h-0 flex-1" scrollFade>
              <div className="relative py-2">
                <FloatingHighlight />
                {groups.map((group) => {
                  const path = splitPath(group.path);
                  return (
                    <section className="pb-2" key={group.path}>
                      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border/60 bg-popover px-3 text-xs">
                        <PierreEntryIcon
                          pathValue={group.path}
                          kind="file"
                          theme={resolvedTheme}
                          className="size-3.5"
                        />
                        <span className="font-medium text-foreground">{path.name}</span>
                        {path.directory ? (
                          <span className="min-w-0 truncate text-muted-foreground">
                            {path.directory}
                          </span>
                        ) : null}
                        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 tabular-nums text-3xs text-muted-foreground">
                          {group.matches.length}
                        </span>
                      </div>
                      {group.matches.map((match) => {
                        const isSelected = match.resultIndex === selectedIndex;
                        return (
                          <button
                            type="button"
                            key={`${match.path}:${match.lineNumber}:${match.resultIndex}`}
                            ref={isSelected ? scrollSelectedRowIntoView : undefined}
                            data-highlighted={isSelected ? "" : undefined}
                            className={cn(
                              "relative z-1 flex h-7 w-full min-w-0 cursor-pointer items-center gap-3 px-3 text-left font-mono text-xs transition-[background-color,color,scale] duration-120 ease-out hover:bg-accent/45 motion-safe:active:scale-[0.995] motion-reduce:transition-none disabled:pointer-events-none",
                              isSelected && "text-accent-foreground hover:bg-transparent",
                            )}
                            disabled={!canOpenMatches}
                            onMouseEnter={() => setSelectedIndex(match.resultIndex)}
                            onClick={() => openMatch(match)}
                          >
                            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/70">
                              {match.lineNumber}
                            </span>
                            <span className="min-w-0 flex-1 truncate whitespace-pre">
                              <HighlightedSearchLine
                                match={match}
                                path={group.path}
                                theme={renderedAppearance}
                              />
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  );
                })}
                {matches.length > visibleCount ? (
                  <div ref={observeLoadMoreSentinel} className="h-8" aria-hidden="true" />
                ) : null}
              </div>
            </ScrollArea>
          </div>
          <SearchContextPeekPane
            target={target}
            match={matches[selectedIndex]}
            canRead={canOpenMatches}
            resolvedTheme={resolvedTheme}
            renderedAppearance={renderedAppearance}
            onOpenMatch={openMatch}
          />
        </div>
      )}
    </CommandPaletteContent>
  );
}

export function ProjectContentSearchDialog(props: ProjectContentSearchDialogProps) {
  const target = useActiveProjectTarget();

  return target ? (
    <OpenContentSearchDialog
      key={`${target.environmentId}:${target.cwd}`}
      onOpenChange={props.onOpenChange}
      target={target}
    />
  ) : (
    <EmptyContentSearchDialog />
  );
}

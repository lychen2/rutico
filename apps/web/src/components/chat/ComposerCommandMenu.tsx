import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import type { ComposerPathSearchTarget } from "@t3tools/client-runtime/state/threads";
import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import {
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ProjectEntry,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type PullRequestContextMetadata,
  type ScopedThreadRef,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import {
  BlocksIcon,
  FolderIcon,
  MessagesSquareIcon,
  PackageIcon,
  SettingsIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { memo, useLayoutEffect, useRef, useState } from "react";

import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { useSharedIndicator } from "~/lib/motion/useSharedIndicator";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Command, CommandGroup, CommandItem, CommandList } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ComposerBanner } from "./ComposerBanner";
import { resolvePullRequestState } from "../pullRequest/pullRequestPresentation";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      searchTarget: ComposerPathSearchTarget;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "pull-request";
      pullRequest: PullRequestContextMetadata;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "thread";
      thread: ScopedThreadRef;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "environment";
      environmentId: EnvironmentId;
      machine: EnvironmentMachineKind;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      instanceId: ProviderInstanceId;
      model: string;
      driverKind: ProviderDriverKind;
      providerDisplayName: string;
      acpRegistryAgentId: string | undefined;
      acpRegistryIconUrl: string | undefined;
      label: string;
      description: string;
    };

export function splitQueryMatchSegments(
  text: string,
  rawQuery: string,
): Array<{ readonly text: string; readonly matched: boolean }> {
  const query = rawQuery.trim().toLowerCase();
  if (!query || !text) return [{ text, matched: false }];

  const lower = text.toLowerCase();
  const directIndex = lower.indexOf(query);
  if (directIndex >= 0) {
    const segments: Array<{ readonly text: string; readonly matched: boolean }> = [];
    if (directIndex > 0) segments.push({ text: text.slice(0, directIndex), matched: false });
    segments.push({ text: text.slice(directIndex, directIndex + query.length), matched: true });
    if (directIndex + query.length < text.length) {
      segments.push({ text: text.slice(directIndex + query.length), matched: false });
    }
    return segments;
  }

  // Ordered subsequence fuzzy match: prefer word/camelCase boundaries, fall back to greedy match.
  const needle = query.replace(/\s+/g, "");
  if (!needle) return [{ text, matched: false }];
  const isBoundary = (index: number) => {
    if (index === 0) return true;
    const prev = text[index - 1] ?? "";
    const curr = text[index] ?? "";
    if (/[/\\._\-\s]/.test(prev)) return true;
    return curr >= "A" && curr <= "Z" && prev >= "a" && prev <= "z";
  };
  const boundaryIndices: number[] = [];
  let cursor = 0;
  for (let i = 0; i < lower.length && cursor < needle.length; i += 1) {
    if (lower[i] === needle[cursor] && isBoundary(i)) {
      boundaryIndices.push(i);
      cursor += 1;
    }
  }
  const matchedIndices =
    cursor === needle.length
      ? boundaryIndices
      : (() => {
          const fallback: number[] = [];
          let pos = 0;
          for (let i = 0; i < lower.length && pos < needle.length; i += 1) {
            if (lower[i] === needle[pos]) {
              fallback.push(i);
              pos += 1;
            }
          }
          return pos === needle.length ? fallback : null;
        })();
  if (!matchedIndices) return [{ text, matched: false }];

  const matchedSet = new Set(matchedIndices);
  const segments: Array<{ readonly text: string; readonly matched: boolean }> = [];
  let runStart = 0;
  let runMatched = matchedSet.has(0);
  for (let i = 1; i <= text.length; i += 1) {
    const isMatched = i < text.length ? matchedSet.has(i) : !runMatched;
    if (i === text.length || isMatched !== runMatched) {
      segments.push({ text: text.slice(runStart, i), matched: runMatched });
      runStart = i;
      runMatched = isMatched;
    }
  }
  return segments;
}

function HighlightedQueryLabel(props: { readonly text: string; readonly query: string }) {
  const segments = splitQueryMatchSegments(props.text, props.query);
  if (segments.length === 1 && !segments[0]?.matched) {
    return props.text;
  }
  return (
    <>
      {segments.map((segment, index) => {
        const key = `${index}:${segment.matched ? "m" : "p"}:${segment.text}`;
        return segment.matched ? (
          <mark key={key} data-fuzzy-match="true">
            {segment.text}
          </mark>
        ) : (
          <span key={key}>{segment.text}</span>
        );
      })}
    </>
  );
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  listId: string;
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  query?: string;
  emptyStateText?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const listRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const query = props.query ?? "";

  useSharedIndicator({
    containerRef: trackRef,
    indicatorRef,
    activeSelector: '[data-composer-item-id][data-active="true"]',
    activeKey: props.activeItemId,
    preset: "fluid",
    maxSquash: 0.15,
    axis: "y",
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the highlighted menu item's DOM node into view
  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <ComposerBanner.Surface
        ref={listRef}
        className="t3-drawer-reveal flex min-h-0 w-full flex-col overflow-hidden pb-(--chat-composer-attachment-overlap) **:data-[slot=command-item]:rounded-lg **:data-[slot=scroll-area-scrollbar]:data-[orientation=vertical]:my-4"
        data-composer-command-drawer="true"
      >
        {props.items.length > 0 ? (
          <>
            <CommandList
              id={props.listId}
              aria-label={
                props.triggerKind ? m(LISTBOX_LABEL_BY_TRIGGER[props.triggerKind]) : undefined
              }
              className="min-h-0 scroll-pb-2 pointer-coarse:scroll-pb-6"
              scrollAreaClassName="max-h-72"
            >
              <CommandGroup>
                <div ref={trackRef} data-command-menu-track="true" className="relative">
                  <span
                    ref={indicatorRef}
                    aria-hidden="true"
                    data-shared-indicator="command-menu"
                    className="pointer-events-none absolute top-0 left-0 z-0 rounded-lg bg-accent opacity-0 will-change-transform"
                  />
                  {props.items.map((item) => (
                    <ComposerCommandMenuItem
                      key={item.id}
                      optionId={composerSuggestionOptionId(props.listId, item.id)}
                      item={item}
                      triggerKind={props.triggerKind}
                      query={query}
                      resolvedTheme={props.resolvedTheme}
                      isActive={props.activeItemId === item.id}
                      onHighlight={props.onHighlightedItemChange}
                      onSelect={props.onSelect}
                    />
                  ))}
                </div>
              </CommandGroup>
            </CommandList>
            <div
              aria-hidden="true"
              className="flex items-center justify-between gap-2 border-t border-foreground/[0.06] px-3 py-1.5 text-muted-foreground/70 text-xs pointer-coarse:hidden"
            >
              <div className="flex items-center gap-1.5">
                <Kbd>↑↓</Kbd>
                <span className="text-muted-foreground/40">·</span>
                <Kbd>↵</Kbd>
                <span className="text-muted-foreground/40">·</span>
                <Kbd>Esc</Kbd>
              </div>
              {props.isLoading ? (
                <Spinner size="xs" tone="muted" aria-hidden="true" className="shrink-0" />
              ) : null}
            </div>
          </>
        ) : (
          <div className="px-5 pt-3.5 pb-7">
            <p className="flex items-center gap-2 text-secondary-label text-xs">
              {props.isLoading ? (
                <>
                  <Spinner size="xs" tone="muted" aria-hidden="true" className="shrink-0" />
                  <span>
                    {props.triggerKind === "skill" || props.triggerKind === "slash-command"
                      ? gt("Searching workspace skills...")
                      : props.triggerKind === "pull-request"
                        ? gt("Finding pull request...")
                        : gt("Searching workspace files...")}
                  </span>
                </>
              ) : (
                (props.emptyStateText ??
                (props.triggerKind === "skill"
                  ? gt("No skills found. Try / to browse provider commands.")
                  : props.triggerKind === "path"
                    ? gt("No matching files or folders.")
                    : gt("No matching command.")))
              )}
            </p>
          </div>
        )}
      </ComposerBanner.Surface>
    </Command>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  optionId: string;
  item: ComposerCommandItem;
  triggerKind: ComposerTriggerKind | null;
  query: string;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const m = useMessages();
  const skillSourceKind =
    props.item.type === "skill" ? resolveProviderSkillSourceKind(props.item.skill) : null;
  const isSlashSkill =
    props.triggerKind === "slash-command" && props.item.type === "skill" ? props.item.skill : null;
  const pullRequestPresentation =
    props.item.type === "pull-request" ? resolvePullRequestState(props.item.pullRequest, m) : null;
  const descriptionRef = useRef<HTMLSpanElement>(null);
  const [descriptionTruncated, setDescriptionTruncated] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the rendered description so only cut-off text gets a tooltip
  useLayoutEffect(() => {
    const description = descriptionRef.current;
    setDescriptionTruncated(
      props.isActive && !!description && description.scrollWidth > description.clientWidth,
    );
  }, [props.isActive]);

  return (
    <CommandItem
      render={<div id={props.optionId} />}
      aria-selected={props.isActive}
      value={props.item.id}
      data-composer-item-id={props.item.id}
      active={props.isActive}
      className="relative z-10"
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "thread" ? (
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      ) : null}
      {props.item.type === "environment" ? (
        <EnvironmentMachineIcon
          kind={props.item.machine}
          aria-hidden="true"
          className="size-4 shrink-0 text-secondary-label"
        />
      ) : null}
      {props.item.type === "model" ? (
        <ProviderInstanceIcon
          driverKind={props.item.driverKind}
          displayName={props.item.providerDisplayName}
          acpRegistryAgentId={props.item.acpRegistryAgentId}
          acpRegistryIconUrl={props.item.acpRegistryIconUrl}
          className="size-4 shrink-0"
          iconClassName="size-4"
        />
      ) : null}
      {pullRequestPresentation ? (
        <pullRequestPresentation.Icon
          role="img"
          aria-label={pullRequestPresentation.label}
          className={cn("size-4 shrink-0", pullRequestPresentation.toneClassName)}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 max-w-[45%] shrink-0 truncate font-sans text-xs font-medium">
          {isSlashSkill ? (
            <>
              <span className="text-secondary-label">/skill:</span>
              <HighlightedQueryLabel
                text={formatProviderSkillDisplayName(isSlashSkill)}
                query={props.query}
              />
            </>
          ) : (
            <HighlightedQueryLabel text={props.item.label} query={props.query} />
          )}
        </span>
        <Tooltip open={descriptionTruncated}>
          <TooltipTrigger
            tabIndex={-1}
            render={
              <span
                ref={descriptionRef}
                className="min-w-0 flex-1 truncate text-left text-secondary-label text-xs"
              />
            }
          >
            {props.item.description}
          </TooltipTrigger>
          <TooltipPopup>{props.item.description}</TooltipPopup>
        </Tooltip>
        {skillSourceKind ? (
          <SkillSourceBadge
            kind={skillSourceKind}
            showSkillSuffix={props.triggerKind === "skill"}
          />
        ) : null}
      </span>
    </CommandItem>
  );
});

export function composerSuggestionOptionId(listId: string, itemId: string): string {
  // JSON escapes lone UTF-16 surrogates before URI encoding without losing identity.
  return `${listId}-${encodeURIComponent(JSON.stringify(itemId))}`;
}

const LISTBOX_LABEL_BY_TRIGGER: Record<ComposerTriggerKind, string> = {
  path: msg("Files and folders"),
  "pull-request": msg("Pull requests"),
  "slash-command": msg("Commands"),
  skill: msg("Skills"),
};

const SKILL_SOURCE_ICON_BY_KIND: Record<ProviderSkillSourceKind, LucideIcon> = {
  app: BlocksIcon,
  repo: FolderIcon,
  project: FolderIcon,
  personal: UserRoundIcon,
  system: SettingsIcon,
  other: PackageIcon,
};

const SKILL_SOURCE_LABEL_BY_KIND: Record<
  ProviderSkillSourceKind,
  { readonly label: string; readonly skillLabel: string }
> = {
  app: {
    label: msg("App", { $context: "skill source badge" }),
    skillLabel: msg("App Skill"),
  },
  repo: {
    label: msg("Repo", { $context: "skill source badge" }),
    skillLabel: msg("Repo Skill"),
  },
  project: {
    label: msg("Project", { $context: "skill source badge" }),
    skillLabel: msg("Project Skill"),
  },
  personal: {
    label: msg("Personal", { $context: "skill source badge" }),
    skillLabel: msg("Personal Skill"),
  },
  system: {
    label: msg("System", { $context: "skill source badge" }),
    skillLabel: msg("System Skill"),
  },
  other: {
    label: msg("Provider", { $context: "skill source badge" }),
    skillLabel: msg("Provider Skill"),
  },
};

function SkillSourceBadge(props: { kind: ProviderSkillSourceKind; showSkillSuffix: boolean }) {
  const m = useMessages();
  const Icon = SKILL_SOURCE_ICON_BY_KIND[props.kind];
  const labels = SKILL_SOURCE_LABEL_BY_KIND[props.kind];
  return (
    <Badge className="ms-auto" variant="secondary">
      <Icon aria-hidden="true" className="text-current" />
      {m(props.showSkillSuffix ? labels.skillLabel : labels.label)}
    </Badge>
  );
}

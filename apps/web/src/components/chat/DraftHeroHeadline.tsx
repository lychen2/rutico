import type { DraftId } from "~/composerDraftStore";
import { composerDraftHasUserContent, useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { T, useGT, Var } from "gt-react";
import {
  BugIcon,
  CompassIcon,
  FileDiffIcon,
  FolderPlusIcon,
  ListChecksIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState, type CSSProperties } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useOrderWhileOpen } from "~/hooks/useOrderWhileOpen";
import { useProjectPin } from "~/hooks/useProjectGroupUpdate";
import { useScratchProject } from "~/hooks/useScratchProject";
import { isTriagePrompt } from "@t3tools/shared/triagePrompt";
import { useClientSettings } from "~/hooks/useSettings";
import { seedDraftModelSelection } from "~/lib/seedDraftModelSelection";
import {
  deriveLogicalProjectKeyFromSettings,
  pickableProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  buildSidebarProjectPickerEntries,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { isProjectPinShortcut, ProjectPinButton } from "../ProjectPinButton";
import { useSortedProjectGroups } from "../CommandPaletteLookups";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { DraftProjectName } from "./DraftProjectName";
import { DraftHeroProjectHeading } from "./DraftHeroProjectHeading";
import { TriageDraftHero } from "./TriageDraftHero";

const ADD_PROJECT_VALUE = "add-project";

interface PickerItem {
  readonly value: string;
  readonly label: string;
}

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const gt = useGT();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  // A boolean, so typing in a draft does not re-render the hero.
  const isTriageDraftPrompt = useComposerDraftStore((store) =>
    draftId ? isTriagePrompt(store.getComposerDraft(draftId)?.prompt ?? "") : false,
  );
  const openAddProject = () => openCommandPalette({ open: "add-project" });
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const openProjectDraft = useNewThreadHandler();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerFilter = useComboboxFilter();
  const highlightedPickerValueRef = useRef<string | null>(null);
  const { canPinProjectGroup, toggleProjectGroupPin } = useProjectPin();

  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectGroups = useSortedProjectGroups(environmentLabelById);
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const environmentMachineById = new Map(
    environments.map(
      (environment) =>
        [
          environment.environmentId,
          resolveEnvironmentMachineKind(environment.serverConfig),
        ] as const,
    ),
  );
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: pickableProjectGroups(projectGroups),
    preferredProjectRef: activeProjectRef,
  });
  const projectEntryByKey = new Map(
    projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const),
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
  );
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(activeProjectRef?.environmentId ?? null);
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null &&
    isScratchProject(activeProject, scratchWorkspaceRootFor(activeProject.environmentId));

  // Pinning from a row keeps rows in place while the picker is open.
  const pickerItems: readonly PickerItem[] = useOrderWhileOpen(
    [
      ...menuEntries.map(({ group }) => ({ value: group.projectKey, label: group.displayName })),
      { value: ADD_PROJECT_VALUE, label: gt("Add project") },
    ],
    (item) => item.value,
    pickerOpen,
  );
  const pickerSearch = pickerQuery.trim();
  const filteredPickerItems =
    pickerSearch.length === 0
      ? pickerItems
      : pickerItems.filter(
          (item) =>
            item.value !== ADD_PROJECT_VALUE &&
            pickerFilter.contains(item, pickerSearch, (candidate) => candidate.label),
        );
  const selectedPickerItem = pickerItems.find((item) => item.value === activeProjectKey) ?? null;

  // The picker can change the draft's target while the no-project home is
  // still being opened; a stale continuation must not retarget it again. Picking
  // a project clears the pending request, and the draft session is compared
  // against the store when the scratch project arrives.
  const pendingScratchRef = useRef<symbol | null>(null);
  const draftTargetKey = () => {
    const session = draftId ? useComposerDraftStore.getState().getDraftSession(draftId) : null;
    return session
      ? `${session.environmentId}:${session.projectId}:${session.logicalProjectKey}`
      : null;
  };
  // Retargeting an empty draft would overwrite the project's draft and strand browser tabs.
  const selectProject = (project: (typeof projects)[number], logicalProjectKey: string) => {
    if (!draftId) {
      return;
    }
    pendingScratchRef.current = null;
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    if (!composerDraftHasUserContent(getComposerDraft(draftId))) {
      void openProjectDraft(projectRef);
      return;
    }
    setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId);
    seedDraftModelSelection(draftId, projectRef);
  };
  const startScratch = async (): Promise<boolean> => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) {
      return false;
    }
    const request = Symbol("scratch");
    pendingScratchRef.current = request;
    const requestedTarget = draftTargetKey();
    const project = await openScratchProject(scratchTargetEnvironmentId);
    if (!project || pendingScratchRef.current !== request || draftTargetKey() !== requestedTarget) {
      return false;
    }
    pendingScratchRef.current = null;
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
    return true;
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Combobox
      items={pickerItems}
      filteredItems={filteredPickerItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={pickerOpen}
      onItemHighlighted={(item) => {
        highlightedPickerValueRef.current = item?.value ?? null;
      }}
      onOpenChange={(open) => {
        setPickerOpen(open);
        setPickerQuery("");
      }}
      value={selectedPickerItem}
      onValueChange={(item) => {
        if (!item) return;
        setPickerOpen(false);
        if (item.value === ADD_PROJECT_VALUE) {
          openAddProject();
          return;
        }
        const entry = projectEntryByKey.get(item.value);
        if (!entry || item.value === activeProjectKey) {
          return;
        }
        selectProject(entry.targetProject, entry.group.projectKey);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<InlineButton tone="picker" />}
              data-draft-project-trigger=""
              data-draft-project-capsule="true"
              className="pointer-events-auto min-w-0 max-w-full align-baseline"
            />
          }
        >
          <DraftProjectName
            value={
              isScratchDraft ? gt("No project") : (activeProjectTitle ?? gt("Choose a project"))
            }
            singleLine
          />
        </TooltipTrigger>
        {activeProjectTitle && !isScratchDraft ? (
          <TooltipPopup side="top">{activeProjectTitle}</TooltipPopup>
        ) : null}
      </Tooltip>
      <ComboboxPopup align="center" className="w-72 overflow-hidden">
        <ComboboxSearchInput
          aria-label={gt("Search projects")}
          placeholder={gt("Search projects...")}
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
          onKeyDown={(event) => {
            const highlighted = highlightedPickerValueRef.current;
            const group = highlighted ? projectEntryByKey.get(highlighted)?.group : undefined;
            if (!group || !canPinProjectGroup(group) || !isProjectPinShortcut(event, keybindings)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            toggleProjectGroupPin(group);
          }}
        />
        <ComboboxEmpty>
          <T>No matching projects.</T>
        </ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) => {
            const entry = projectEntryByKey.get(item.value);
            return (
              <ComboboxItem key={item.value} hideIndicator value={item}>
                {item.value === ADD_PROJECT_VALUE ? (
                  <FolderPlusIcon className="size-4 shrink-0" />
                ) : entry ? (
                  <ProjectFavicon project={entry.group} className="size-4 shrink-0" />
                ) : null}
                <Tooltip>
                  <TooltipTrigger render={<span className="min-w-0 flex-1 text-sm" />}>
                    <DraftProjectName value={item.label} />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{item.label}</TooltipPopup>
                </Tooltip>
                {entry && canPinProjectGroup(entry.group) ? (
                  <ProjectPinButton
                    name={entry.group.displayName}
                    pinned={entry.group.pinned}
                    shortcutLabel={shortcutLabelForCommand(keybindings, "thread.pin")}
                    onToggle={() => toggleProjectGroupPin(entry.group)}
                  />
                ) : null}
                {entry && showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={entry.group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline min-w-0 max-w-full cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <DraftProjectName value={activeProjectTitle ?? gt("Add a project")} singleLine />
    </button>
  );

  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");
  const orStartWithoutProject =
    scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              tone="muted"
              className="pointer-events-auto"
              onClick={() =>
                void startScratch().then((started) => {
                  if (started) {
                    document.querySelector<HTMLElement>("[data-draft-project-trigger]")?.focus();
                  }
                })
              }
            />
          }
        >
          <T>or start without a project</T>
        </TooltipTrigger>
        {noProjectShortcut ? <TooltipPopup side="bottom">{noProjectShortcut}</TooltipPopup> : null}
      </Tooltip>
    ) : null;

  if (isScratchDraft && isTriageDraftPrompt) {
    const environment = environments.find(
      (entry) => entry.environmentId === activeProject.environmentId,
    );
    return (
      <TriageDraftHero
        machineLabel={environment?.label ?? null}
        serverVersion={environment?.serverConfig?.environment.serverVersion ?? null}
      />
    );
  }

  return (
    <div
      data-draft-hero-stage="true"
      className="mx-auto flex w-full max-w-5xl flex-col items-center"
    >
      {hasResolvedProject && !isScratchDraft ? (
        <div className="t3-draft-hero-title w-full">
          <DraftHeroProjectHeading projectName={activeProjectTitle ?? gt("Choose a project")}>
            {projectSelector}
          </DraftHeroProjectHeading>
        </div>
      ) : (
        <h1 className="t3-draft-hero-title w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
          {isScratchDraft ? (
            <T>What should we work on?</T>
          ) : canChooseProject ? (
            <T>
              <Var>{projectSelector}</Var> to start
            </T>
          ) : (
            <T>Add a project to start</T>
          )}
        </h1>
      )}
      {scratchWorkspaceRoot === null ? null : (
        <p className="t3-draft-hero-subtitle mt-2 flex h-6 w-full items-center justify-center text-sm">
          {isScratchDraft ? projectSelector : orStartWithoutProject}
        </p>
      )}
    </div>
  );
}

interface DraftHeroStarterPillsProps {
  readonly draftId: DraftId;
  readonly isGitRepo: boolean;
  readonly activeBranch: string | null;
  readonly activeProjectTitle: string | null;
  readonly isScratchDraft: boolean;
  readonly onSelectStarter: (prompt: string) => void;
}

export function DraftHeroStarterPills({
  draftId,
  isGitRepo,
  activeBranch,
  activeProjectTitle,
  isScratchDraft,
  onSelectStarter,
}: DraftHeroStarterPillsProps) {
  const gt = useGT();
  const hasPrompt = useComposerDraftStore(
    (store) => (store.getComposerDraft(draftId)?.prompt ?? "").length > 0,
  );
  const isTriage = useComposerDraftStore((store) =>
    isTriagePrompt(store.getComposerDraft(draftId)?.prompt ?? ""),
  );
  const [dismissedDraftId, setDismissedDraftId] = useState<DraftId | null>(null);
  const dismissed = dismissedDraftId === draftId;

  if (isTriage) return null;

  const hasProject = activeProjectTitle !== null && !isScratchDraft;
  const starters =
    hasProject && isGitRepo
      ? [
          {
            id: "review",
            icon: FileDiffIcon,
            label: activeBranch
              ? gt("Review {branch}", { branch: activeBranch })
              : gt("Review changes"),
            prompt: activeBranch
              ? gt(
                  "Review the current changes on {branch} and flag any bugs, regressions, or missing edge cases.",
                  { branch: activeBranch },
                )
              : gt(
                  "Review the current working tree changes and flag any bugs, regressions, or missing edge cases.",
                ),
          },
          {
            id: "explain",
            icon: CompassIcon,
            label: gt("Explain architecture"),
            prompt: gt(
              "Walk me through the architecture of {project} and point out where the core logic lives.",
              { project: activeProjectTitle },
            ),
          },
          {
            id: "tests",
            icon: BugIcon,
            label: gt("Fix failing tests"),
            prompt: gt(
              "Run the relevant tests, diagnose any failures, and propose a minimal verified fix.",
            ),
          },
          {
            id: "plan",
            icon: ListChecksIcon,
            label: gt("Plan a feature"),
            prompt: gt(
              "Help me design a concise implementation plan and check trade-offs before editing code.",
            ),
          },
        ]
      : [
          {
            id: "explore",
            icon: CompassIcon,
            label: gt("Explore codebase"),
            prompt: gt("Map out the workspace structure and summarize the key entry points."),
          },
          {
            id: "debug",
            icon: BugIcon,
            label: gt("Debug an issue"),
            prompt: gt(
              "Help me trace the root cause of a bug and verify the fix with a regression test.",
            ),
          },
          {
            id: "script",
            icon: TerminalIcon,
            label: gt("Automate a task"),
            prompt: gt("Write a clean, reusable script to automate a repetitive workflow task."),
          },
          {
            id: "plan",
            icon: ListChecksIcon,
            label: gt("Plan a task"),
            prompt: gt("Break down my goal into clear, ordered implementation steps."),
          },
        ];

  const visible = !hasPrompt && !dismissed;

  return (
    <div
      data-draft-starter-rail="true"
      data-starters-visible={visible ? "true" : "false"}
      aria-hidden={!visible}
      inert={!visible}
      className="pointer-events-none flex flex-wrap items-center justify-center gap-1.5 px-2"
    >
      {starters.map((starter, index) => {
        const Icon = starter.icon;
        return (
          <button
            key={starter.id}
            type="button"
            data-draft-starter-pill="true"
            style={{ "--starter-index": index } as CSSProperties}
            onClick={() => onSelectStarter(starter.prompt)}
            className="pointer-events-auto inline-flex max-w-52 cursor-pointer items-center gap-1.5 rounded-full border border-border/75 bg-card/85 px-2.5 py-1 text-xs text-muted-foreground shadow-xs transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-foreground/25 hover:bg-card hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.97] motion-reduce:transition-none"
          >
            <Icon aria-hidden className="size-3 shrink-0 opacity-75" />
            <span className="truncate">{starter.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        data-draft-starter-dismiss="true"
        aria-label={gt("Hide suggestions")}
        onClick={() => setDismissedDraftId(draftId)}
        className="pointer-events-auto inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground/65 transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-95 motion-reduce:transition-none"
      >
        <XIcon aria-hidden className="size-3" />
      </button>
    </div>
  );
}

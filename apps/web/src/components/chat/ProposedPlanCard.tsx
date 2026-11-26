import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import { msg, T, useGT, Var } from "gt-react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { findRevealRef } from "./markdownFindContext";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  extractProposedPlanHeadings,
  normalizePlanMarkdownForExport,
} from "../../proposedPlan";
import { getSpringWaapiTiming, prefersReducedMotion } from "~/lib/motion/springs";
import ChatMarkdown from "../ChatMarkdown";
import { CheckIcon, ChevronDownIcon, CopyIcon, EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAtomCommand } from "~/state/use-atom-command";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  threadRef,
  cwd,
  workspaceRoot,
  findActive: _findActive = false,
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | undefined;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
  findActive?: boolean;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pendingUnfoldRef = useRef<{
    readonly fromHeight: number;
    readonly targetExpanded: boolean;
  } | null>(null);
  const unfoldAnimationRef = useRef<Animation | null>(null);
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [lastSavePath, setLastSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const [savedNoticeVisible, setSavedNoticeVisible] = useState(false);
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "plan",
      unavailableMessage: msg("Clipboard API is unavailable while copying plan."),
      failureMessage: msg("Failed to copy plan to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy plan"),
          description:
            error instanceof Error ? error.message : gt("An error occurred while copying."),
        }),
      );
    },
  });
  const title = proposedPlanTitle(planMarkdown) ?? gt("Proposed plan");
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown);
  const outlineHeadings = extractProposedPlanHeadings(planMarkdown);
  const isCollapsed = canCollapse && !expanded;
  const showOutline = (!canCollapse || expanded) && outlineHeadings.length >= 2;

  const setExpandedWithUnfold = (nextExpanded: boolean) => {
    const body = bodyRef.current;
    if (body && nextExpanded !== expanded) {
      pendingUnfoldRef.current = {
        fromHeight: body.offsetHeight,
        targetExpanded: nextExpanded,
      };
    }
    setExpanded(nextExpanded);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- auto-clears the transient 2s saved confirmation badge
  useEffect(() => {
    if (!savedNoticeVisible) return;
    const timer = window.setTimeout(() => setSavedNoticeVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [savedNoticeVisible]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs discrete WAAPI height unfold/fold on the unified single markdown tree and releases inline styles on completion
  useLayoutEffect(() => {
    const pending = pendingUnfoldRef.current;
    pendingUnfoldRef.current = null;
    const body = bodyRef.current;
    if (
      !pending ||
      pending.targetExpanded !== expanded ||
      !body ||
      typeof body.animate !== "function"
    ) {
      return;
    }
    unfoldAnimationRef.current?.cancel();
    unfoldAnimationRef.current = null;
    if (prefersReducedMotion()) return;
    const toHeight = body.offsetHeight;
    if (Math.abs(toHeight - pending.fromHeight) < 2) return;
    body.style.overflow = "hidden";
    const timing = getSpringWaapiTiming("spatial");
    const animation = body.animate(
      [
        { height: `${pending.fromHeight}px`, maxHeight: "none" },
        { height: `${toHeight}px`, maxHeight: "none" },
      ],
      {
        duration: Math.min(340, timing.duration),
        easing: timing.easing,
      },
    );
    unfoldAnimationRef.current = animation;
    const release = () => {
      if (unfoldAnimationRef.current === animation) {
        unfoldAnimationRef.current = null;
      }
      body.style.removeProperty("overflow");
    };
    void animation.finished.catch(() => undefined).then(release);
    return () => {
      animation.cancel();
      release();
    };
  }, [expanded]);

  const jumpToOutlineHeading = (headingIndex: number, headingText: string) => {
    const body = bodyRef.current;
    if (!body) return;
    const headingNodes = Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
    const normalized = headingText.trim().toLowerCase();
    const target =
      headingNodes.find((node) => (node.textContent ?? "").trim().toLowerCase() === normalized) ??
      headingNodes[headingIndex];
    if (!target) return;
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
    target.dataset.planJumpTarget = "true";
    window.setTimeout(() => {
      delete target.dataset.planJumpTarget;
    }, 650);
  };

  const revealRef = findRevealRef(() => setExpanded(true));
  const attachBodyRef = (node: HTMLDivElement | null) => {
    bodyRef.current = node;
    return revealRef(node);
  };
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!canWriteFiles) return;
    if (!workspaceRoot) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Workspace path is unavailable"),
          description: gt("This thread does not have a workspace path to save into."),
        }),
      );
      return;
    }
    setIsSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = (savePath: string) => {
    const relativePath = savePath.trim();
    if (!workspaceRoot || !readEnvironmentScope(environmentId, AuthFilesystemWriteScope)) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: gt("Enter a workspace path"),
      });
      return;
    }

    setLastSavePath(savePath);
    setIsSavingToWorkspace(true);
    void (async () => {
      const result = await writeProjectFile({
        environmentId,
        input: {
          cwd: workspaceRoot,
          relativePath,
          contents: saveContents,
        },
      });
      setIsSavingToWorkspace(false);
      if (result._tag === "Success") {
        setIsSaveDialogOpen(false);
        setSavedNoticeVisible(true);
        toastManager.add({
          type: "success",
          title: gt("Plan saved to workspace"),
          description: result.value.relativePath,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not save plan"),
            description:
              error instanceof Error ? error.message : gt("An error occurred while saving."),
          }),
        );
      }
    })();
  };

  const copyLabel = isCopied ? gt("Copied") : gt("Copy to clipboard");

  return (
    <div className="rounded-2xl border border-border/80 bg-card/94 p-4 shadow-xs inset-shadow-2xs inset-shadow-white/65 transition-[border-color,box-shadow] duration-200 ease-out hover:border-border motion-reduce:transition-none dark:border-white/[0.08] dark:bg-card/90 dark:inset-shadow-white/10 dark:hover:border-white/[0.14] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">{gt("Plan", { $context: "badge, noun" })}</Badge>
          {}
          <h3 data-thread-find-text="true" className="truncate text-sm font-medium text-foreground">
            {title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {savedNoticeVisible ? (
            <Badge variant="success" size="sm" data-plan-saved-badge="true">
              <CheckIcon aria-hidden="true" className="size-3" />
              <span>{gt("Saved")}</span>
            </Badge>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  onClick={() => {
                    if (!isCopied) handleCopyPlan();
                  }}
                  aria-label={copyLabel}
                />
              }
            >
              {isCopied ? (
                <CheckIcon key="copied" className="t3-icon-pop size-3.5 text-success" />
              ) : (
                <CopyIcon key="copy" className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <Menu>
            <MenuTrigger
              render={<Button aria-label={gt("Plan actions")} size="icon-xs" variant="outline" />}
            >
              <EllipsisIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={handleCopyPlan}>
                {isCopied ? gt("Copied!") : gt("Copy to clipboard")}
              </MenuItem>
              <MenuItem onClick={handleDownload}>
                <T>Download as markdown</T>
              </MenuItem>
              <MenuItem
                onClick={openSaveDialog}
                disabled={!canWriteFiles || !workspaceRoot || isSavingToWorkspace}
              >
                <T>Save to workspace</T>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {showOutline ? (
        <nav
          aria-label={gt("Plan sections")}
          data-plan-outline-rail="true"
          className="mt-3 flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-2.5"
        >
          {outlineHeadings.map((heading, headingIndex) => (
            <button
              key={heading.id}
              type="button"
              data-plan-outline-pill={heading.level === 2 ? "h2" : "h3"}
              onClick={() => jumpToOutlineHeading(headingIndex, heading.text)}
              className={cn(
                "inline-flex max-w-52 cursor-pointer items-center rounded-full border border-border/75 bg-muted/45 px-2 py-0.5 text-2xs transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-foreground/25 hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.97] motion-reduce:transition-none",
                heading.level === 2 ? "font-medium text-foreground/85" : "text-muted-foreground",
              )}
            >
              <span className="truncate">{heading.text}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="mt-4">
        <div
          ref={attachBodyRef}
          className={cn("relative", isCollapsed && "max-h-104 overflow-hidden")}
          data-thread-find-text="true"
          data-thread-find-fold={isCollapsed ? "" : undefined}
        >
          <ChatMarkdown
            text={displayedPlanMarkdown}
            cwd={cwd}
            environmentId={environmentId}
            threadRef={threadRef}
            isStreaming={false}
            headingLevelOffset={3}
          />
          {isCollapsed ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card/95 via-card/80 to-transparent" />
          ) : null}
        </div>
        {canCollapse ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              aria-expanded={expanded}
              data-scroll-anchor-ignore
              onClick={() => setExpandedWithUnfold(!expanded)}
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform duration-200 ease-(--ease-drawer) motion-reduce:transition-none",
                  expanded && "rotate-180",
                )}
              />
              {expanded ? gt("Collapse plan") : gt("Expand plan")}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingToWorkspace) {
            setIsSaveDialogOpen(open);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <SavePlanToWorkspaceForm
            initialPath={lastSavePath || downloadFilename}
            placeholder={downloadFilename}
            workspaceRoot={workspaceRoot}
            canWriteFiles={canWriteFiles}
            saving={isSavingToWorkspace}
            onCancel={() => setIsSaveDialogOpen(false)}
            onSave={handleSaveToWorkspace}
          />
        </DialogPopup>
      </Dialog>
    </div>
  );
});

function SavePlanToWorkspaceForm({
  initialPath,
  placeholder,
  workspaceRoot,
  canWriteFiles,
  saving,
  onCancel,
  onSave,
}: {
  initialPath: string;
  placeholder: string;
  workspaceRoot: string | undefined;
  canWriteFiles: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (path: string) => void;
}) {
  const gt = useGT();
  const [savePath, setSavePath] = useState(initialPath);
  const savePathInputId = useId();
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <T>Save plan to workspace</T>
        </DialogTitle>
        <DialogDescription>
          {workspaceRoot !== undefined ? (
            <T>
              Enter a path relative to{" "}
              <code>
                <Var>{workspaceRoot}</Var>
              </code>
              .
            </T>
          ) : (
            <T>
              Enter a path relative to <code>the workspace</code>.
            </T>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <label htmlFor={savePathInputId} className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">
            <T>Workspace path</T>
          </span>
          <Input
            id={savePathInputId}
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            disabled={saving}
          />
        </label>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          <T>Cancel</T>
        </Button>
        <Button size="sm" onClick={() => onSave(savePath)} disabled={!canWriteFiles || saving}>
          {saving ? gt("Saving...") : gt("Save")}
        </Button>
      </DialogFooter>
    </>
  );
}

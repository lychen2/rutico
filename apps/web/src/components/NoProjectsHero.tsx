import { useAtomValue } from "@effect/atom-react";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { T, useGT } from "gt-react";
import { MessageSquareDashedIcon, PlusIcon } from "lucide-react";

import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { useScratchProject } from "../hooks/useScratchProject";
import { shortcutLabelForCommand } from "../keybindings";
import { usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerKeybindingsAtom } from "../state/server";
import { T3Wordmark } from "./T3Wordmark";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle, EmptyWireframe } from "./ui/empty";
import { Kbd } from "./ui/kbd";
import { SidebarInset } from "./ui/sidebar";
import { SpecularHeroCard } from "./ui/standalone-page";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function NoProjectsHero() {
  const gt = useGT();
  const contentArea = workspaceAreaProps("home", 1, gt("Home"));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const commandPaletteShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          {isElectron ? <WorkspacePageHeader electron /> : null}
          <Empty size="hero" className="flex-1">
            <SpecularHeroCard maxWidth="lg">
              <EmptyHeader className="max-w-none">
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground dark:border-white/10">
                  <T3Wordmark animated aria-hidden className="h-3 w-auto text-foreground" />
                  {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
                  <span>Rutico</span>
                </div>
                <EmptyWireframe variant="workspace" />
                <div className="t3-draft-hero-title">
                  <EmptyTitle>
                    <T>What should we work on?</T>
                  </EmptyTitle>
                </div>
                <div className="t3-draft-hero-subtitle mt-1.5">
                  <EmptyDescription>
                    {scratchTargetEnvironmentId === null
                      ? gt("Add a project to start your first thread.")
                      : gt("Add a project, or start without one.")}
                  </EmptyDescription>
                </div>
                <div className="t3-draft-hero-actions mt-6 flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
                    <PlusIcon className="size-4" />
                    <T>Add project</T>
                  </Button>
                  {scratchTargetEnvironmentId === null ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
                    >
                      <MessageSquareDashedIcon className="size-4" />
                      <T>Start without a project</T>
                    </Button>
                  )}
                </div>
                {commandPaletteShortcut ? (
                  <div className="t3-draft-hero-actions mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <span>{gt("Command palette")}</span>
                    <Kbd reactiveKey="Mod" variant="outline">
                      {commandPaletteShortcut}
                    </Kbd>
                  </div>
                ) : null}
              </EmptyHeader>
            </SpecularHeroCard>
          </Empty>
        </div>
      </div>
    </SidebarInset>
  );
}

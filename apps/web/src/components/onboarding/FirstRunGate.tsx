import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react";
import { useEffect, useState } from "react";

import {
  ensureClientSettingsHydrated,
  useClientSettings,
  useClientSettingsHydrationStatus,
} from "../../hooks/useSettings";
import { completeOnboarding } from "../../onboarding/firstRun";
import {
  isFirstRunWorkspaceProvenanceAuthoritative,
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  resolveHostedFirstRunDecision,
  transitionFirstRunGateState,
  type FirstRunGateState,
} from "../../onboarding/firstRun.logic";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { environmentProjects } from "../../state/projects";
import { primaryServerConfigAtom, primaryServerWelcomeAtom } from "../../state/server";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { Button } from "../ui/button";
import { T3Wordmark } from "../T3Wordmark";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";

/** Pending blocks all rendering, including EventRouter welcome navigation. */

const FIRST_RUN_DECISION_TIMEOUT_MS = 4_000;

const primaryShellLiveAtom = Atom.make((get) => {
  const serverConfig = get(primaryServerConfigAtom);
  return (
    serverConfig !== null &&
    get(environmentShell.stateValueAtom(serverConfig.environment.environmentId)).status === "live"
  );
}).pipe(Atom.withLabel("web-onboarding-primary-shell-live"));

const workspaceEvidenceLiveAtom = Atom.make((get) => {
  const environmentIds = new Set([
    ...get(environmentProjects.projectsAtom).map((project) => project.environmentId),
    ...get(environmentThreadShells.threadShellsAtom).map((thread) => thread.environmentId),
  ]);

  for (const environmentId of environmentIds) {
    if (get(environmentShell.stateValueAtom(environmentId)).status !== "live") {
      return false;
    }
  }

  return true;
}).pipe(Atom.withLabel("web-onboarding-workspace-evidence-live"));

// Subscribe only to thread count and the sole thread so populated-workspace shell updates cannot rerender the
// app root.
const threadCountAtom = Atom.make(
  (get) => get(environmentThreadShells.threadShellsAtom).length,
).pipe(Atom.withLabel("web-onboarding-thread-count"));

const soleThreadAtom = Atom.make((get) => {
  const threads = get(environmentThreadShells.threadShellsAtom);
  return threads.length === 1 ? threads[0]! : null;
}).pipe(Atom.withLabel("web-onboarding-sole-thread"));

export function FirstRunGate({
  enabled,
  hostedStatic,
  children,
}: {
  readonly enabled: boolean;
  readonly hostedStatic: boolean;
  readonly children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const hydrationStatus = useClientSettingsHydrationStatus();
  const hydrated = hydrationStatus === "ready";
  const onboardingCompletedAt = useClientSettings((settings) => settings.onboardingCompletedAt);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const { isReady: environmentCatalogReady } = useEnvironments();
  const projects = useProjects();
  const threadCount = useAtomValue(threadCountAtom);
  const soleThread = useAtomValue(soleThreadAtom);
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const primaryShellLive = useAtomValue(primaryShellLiveAtom);
  const workspaceEvidenceLive = useAtomValue(workspaceEvidenceLiveAtom);
  const [gateState, setGateState] = useState<FirstRunGateState>(() => ({
    decision:
      (!enabled && !hostedStatic) || (hydrated && onboardingCompletedAt !== null)
        ? "app"
        : "pending",
    stalled: false,
  }));
  const { decision, stalled } = gateState;
  const settingsReadFailed = hydrationStatus === "failed" || hydrationStatus === "retrying";
  // The server's sole cwd-bootstrap project/thread still counts as fresh so npx t3 users see onboarding.
  const serverCwd = serverConfig?.cwd ?? null;
  const primaryEnvironmentId = serverConfig?.environment.environmentId ?? null;
  const workspaceFresh =
    threadCount <= 1 &&
    isFreshFirstRunWorkspace({
      primaryEnvironmentId,
      serverCwd,
      bootstrapProjectId: serverWelcome?.bootstrapProjectId,
      bootstrapThreadId: serverWelcome?.bootstrapThreadId,
      bootstrapProjectCreated: serverWelcome?.bootstrapProjectCreated,
      bootstrapThreadCreated: serverWelcome?.bootstrapThreadCreated,
      projects,
      threads: soleThread === null ? [] : [soleThread],
    });

  const { decision: nextDecision, persistCompletion } = hostedStatic
    ? resolveHostedFirstRunDecision(hydrated)
    : resolveFirstRunDecision({
        enabled,
        hydrated,
        completed: onboardingCompletedAt !== null,
        bootstrapped,
        authoritative: primaryShellLive,
        workspaceAuthoritative: workspaceEvidenceLive,
        workspaceProvenanceAuthoritative: isFirstRunWorkspaceProvenanceAuthoritative({
          welcomeReceived: serverWelcome !== null,
          bootstrapStatus: serverWelcome?.bootstrapStatus ?? null,
        }),
        catalogReady: environmentCatalogReady,
        serverConfigAvailable: serverConfig !== null,
        workspaceFresh,
        projectCount: projects.length,
        threadCount,
      });

  if (hydrated) {
    const transitioned = transitionFirstRunGateState(gateState, {
      type: "evidence",
      decision: nextDecision,
    });
    if (transitioned !== gateState) setGateState(transitioned);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists onboarding completion to settings once the gate settles on skipping the wizard
  useEffect(() => {
    if (decision === "wizard" || !hydrated) return;
    if (persistCompletion && onboardingCompletedAt === null) {
      void completeOnboarding().catch(() => undefined);
    }
  }, [decision, hydrated, onboardingCompletedAt, persistCompletion]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer gives up on a pending first-run decision after the timeout
  useEffect(() => {
    if (!enabled || decision !== "pending" || !hydrated) return;
    const timer = window.setTimeout(
      () => setGateState((state) => transitionFirstRunGateState(state, { type: "timeout" })),
      FIRST_RUN_DECISION_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [decision, enabled, hydrated]);

  // Setup opens by itself only from the home route. A direct link, such as
  // Settings, opens as asked so setup can never lock a user out of the app.
  const wizardOwnsRoute = pathname === "/";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- navigates from the home route to /welcome when the gate decides on the wizard
  useEffect(() => {
    if (decision === "wizard" && wizardOwnsRoute) {
      void navigate({ to: "/welcome", replace: true });
    }
  }, [decision, navigate, wizardOwnsRoute]);

  if (settingsReadFailed) {
    return <FirstRunRecovery reason="settings" retrying={hydrationStatus === "retrying"} />;
  }
  if (decision === "wizard" && !wizardOwnsRoute) {
    return children;
  }
  if (decision !== "app") {
    return stalled ? <FirstRunRecovery reason="connection" /> : <FirstRunPendingLoader />;
  }
  return children;
}

function FirstRunPendingLoader() {
  const gt = useGT();
  return (
    <main
      aria-label={gt("Loading workspace")}
      className="flex h-dvh min-h-0 items-center justify-center bg-background px-6 text-foreground"
      data-slot="first-run-loader"
    >
      <div
        ref={observeVisibleAnimation}
        className="flex flex-col items-center gap-3"
        data-slot="first-run-loader-mark"
      >
        <div className="inline-flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card/80 dark:border-white/10 dark:bg-card/60">
          <T3Wordmark aria-hidden className="h-6 w-auto text-foreground" />
        </div>
      </div>
    </main>
  );
}

function FirstRunRecovery({
  reason,
  retrying = false,
}: {
  readonly reason: "settings" | "connection";
  readonly retrying?: boolean;
}) {
  const settingsReadFailed = reason === "settings";
  const gt = useGT();
  return (
    <main
      className="flex h-dvh min-h-0 items-center justify-center bg-background px-6 text-foreground"
      data-slot="first-run-recovery"
    >
      <div className="flex max-w-sm flex-col items-center rounded-2xl border border-border/65 bg-card/85 px-8 py-8 text-center dark:border-white/10 dark:bg-card/65">
        <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-border/60 bg-background/80 dark:border-white/10">
          <T3Wordmark aria-hidden className="h-5 w-auto text-foreground" />
        </div>
        <h1 className="text-lg font-semibold">
          {settingsReadFailed ? gt("Could not read settings") : gt("Still connecting")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {settingsReadFailed
            ? gt("Your saved settings could not be loaded.")
            : gt("Rutico could not confirm this workspace.")}
        </p>
        <Button
          className="mt-5"
          size="sm"
          variant="outline"
          disabled={retrying}
          onClick={() => {
            if (settingsReadFailed) {
              void ensureClientSettingsHydrated().catch(() => undefined);
            } else {
              window.location.reload();
            }
          }}
        >
          <RefreshIcon refreshing={retrying} />
          {settingsReadFailed ? gt("Retry") : gt("Reload")}
        </Button>
      </div>
    </main>
  );
}

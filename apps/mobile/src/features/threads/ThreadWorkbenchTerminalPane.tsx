import { useAtomMount } from "@effect/atom-react";
import { type KnownTerminalSession } from "@t3tools/client-runtime/state/terminal";
import {
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  DEFAULT_TERMINAL_ID,
  type EnvironmentId,
  type TerminalWriteInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useGT, useMessages } from "gt-react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingScreen } from "../../components/LoadingScreen";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { useServerConfigs } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useAttachedTerminalSession,
  useKnownTerminalSessions,
} from "../../state/use-terminal-session";
import { useConnectionsReady } from "../../state/workspace";
import { useInspectorPaneVisible } from "../layout/inspector-panes";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { TerminalSurface, type TerminalSurfaceHandle } from "../terminal/NativeTerminalSurface";
import { supportsNativeTerminalOutput } from "../terminal/nativeTerminalModule";
import {
  hostPlatformFromOs,
  resolveModifiedTerminalInput,
  type HostPlatform,
  type PendingModifier,
} from "../terminal/terminalInput";
import { resolveTerminalOpenLocation } from "../terminal/terminalLaunchContext";
import {
  buildTerminalMenuSessions,
  nextOpenTerminalId,
  resolveTerminalSessionLabel,
  type TerminalMenuSession,
} from "../terminal/terminalMenu";
import { createTerminalPasteSession } from "../terminal/terminalPaste";
import { getMobileTerminalTheme } from "../terminal/terminalTheme";
import { cacheTerminalGridSize, getCachedTerminalGridSize } from "../terminal/terminalUiState";

const WORKBENCH_DEFAULT_COLS = 64;
const WORKBENCH_DEFAULT_ROWS = 20;

export interface ThreadWorkbenchTerminalPaneProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | null;
  readonly worktreePath: string | null;
  readonly active?: boolean;
  readonly onOpenFullTerminal: (terminalId: string) => void;
}

function pickDefaultWorkbenchTerminalId(
  sessions: ReadonlyArray<KnownTerminalSession>,
  canOperate: boolean,
): string {
  const running = sessions.filter(
    (session) => session.state.status === "running" || session.state.status === "starting",
  );
  if (running.length > 0) {
    return (
      running.find((session) => session.target.terminalId === DEFAULT_TERMINAL_ID)?.target
        .terminalId ??
      running[0]?.target.terminalId ??
      DEFAULT_TERMINAL_ID
    );
  }
  if (!canOperate && sessions[0]) {
    return sessions[0].target.terminalId;
  }
  return DEFAULT_TERMINAL_ID;
}

export function ThreadWorkbenchTerminalPane(props: ThreadWorkbenchTerminalPaneProps) {
  const gt = useGT();
  const messages = useMessages();
  const isPaneVisible = useInspectorPaneVisible();
  const isActive = props.active ?? isPaneVisible;
  const connectionsReady = useConnectionsReady();
  const environment = useEnvironmentPresentation(props.environmentId);
  const canReadTerminal = useEnvironmentScope(props.environmentId, AuthTerminalReadScope);
  const canOperateTerminal = useEnvironmentScope(props.environmentId, AuthTerminalOperateScope);
  const { sessions: knownSessions, error: sessionsError } = useKnownTerminalSessions({
    environmentId: props.environmentId,
    threadId: props.threadId,
  });

  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [createdTerminalIds, setCreatedTerminalIds] = useState<ReadonlyArray<string>>([]);
  const [keyboardFocusNonce, setKeyboardFocusNonce] = useState(0);

  // Lock the initial terminal once sessions load so another client opening `term-1` never
  // hijacks input away from the terminal this pane is already attached to.
  if (knownSessions !== null) {
    const hasSelectedInKnown =
      selectedTerminalId !== null &&
      knownSessions.some((session) => session.target.terminalId === selectedTerminalId);
    const hasSelectedLocally =
      selectedTerminalId !== null && createdTerminalIds.includes(selectedTerminalId);
    if (selectedTerminalId === null) {
      if (canOperateTerminal || knownSessions.length > 0) {
        setSelectedTerminalId(pickDefaultWorkbenchTerminalId(knownSessions, canOperateTerminal));
      }
    } else if (!hasSelectedInKnown && !hasSelectedLocally && knownSessions.length > 0) {
      setSelectedTerminalId(pickDefaultWorkbenchTerminalId(knownSessions, canOperateTerminal));
    }
  }

  const activeTerminalId =
    selectedTerminalId ??
    (knownSessions
      ? pickDefaultWorkbenchTerminalId(knownSessions, canOperateTerminal)
      : DEFAULT_TERMINAL_ID);

  const menuSessions = buildTerminalMenuSessions(
    {
      knownSessions: knownSessions ?? [],
      workspaceRoot: props.workspaceRoot,
    },
    messages,
  );
  const listedIds = new Set(menuSessions.map((session) => session.terminalId));
  const extraSessions: ReadonlyArray<TerminalMenuSession> = createdTerminalIds
    .filter((id) => !listedIds.has(id))
    .map((id) => ({
      terminalId: id,
      cwd: props.worktreePath ?? props.workspaceRoot,
      status: "starting",
      hasRunningSubprocess: false,
      displayLabel: resolveTerminalSessionLabel(id, null, messages),
      updatedAt: null,
    }));
  const displaySessions =
    menuSessions.length === 0 && extraSessions.length === 0
      ? [
          {
            terminalId: activeTerminalId,
            cwd: props.worktreePath ?? props.workspaceRoot,
            status: "starting" as const,
            hasRunningSubprocess: false,
            displayLabel: resolveTerminalSessionLabel(activeTerminalId, null, messages),
            updatedAt: null,
          },
        ]
      : [...menuSessions, ...extraSessions];

  const handleCreateTerminal = () => {
    if (!canOperateTerminal) return;
    const nextId = nextOpenTerminalId({
      listedTerminalIds: displaySessions.map((session) => session.terminalId),
      activeRouteTerminalId: activeTerminalId,
      ...(knownSessions === null || !canReadTerminal ? { uniqueSuffix: uuidv4() } : {}),
    });
    setCreatedTerminalIds((current) => (current.includes(nextId) ? current : [...current, nextId]));
    setSelectedTerminalId(nextId);
  };

  if (!props.workspaceRoot) {
    return (
      <View className="flex-1 justify-center bg-screen p-4">
        <EmptyState
          title={gt("Terminal unavailable")}
          detail={gt(
            "This thread does not have a workspace root yet, so there is nowhere to open a shell.",
          )}
        />
      </View>
    );
  }

  if (!connectionsReady || (!environment.isReady && environment.presentation === null)) {
    return <LoadingScreen message={gt("Opening terminal…")} />;
  }

  if (environment.presentation?.connection.phase !== "connected") {
    return (
      <View className="flex-1 justify-center bg-screen p-4">
        <EmptyState
          title={gt("Environment disconnected")}
          detail={gt("Reconnect this environment to inspect or run terminal sessions.")}
        />
      </View>
    );
  }

  if (!canReadTerminal && !canOperateTerminal) {
    return (
      <View className="flex-1 justify-center bg-screen p-4">
        <EmptyState
          title={gt("Terminal access unavailable")}
          detail={gt("This connection does not have permission to view terminals.")}
        />
      </View>
    );
  }

  if (sessionsError !== null) {
    return (
      <View className="flex-1 justify-center bg-screen p-4">
        <EmptyState title={gt("Could not load terminals")} detail={sessionsError} />
      </View>
    );
  }

  // Read-only clients cannot create a shell; wait for the session list and show an empty state
  // instead of subscribing to a phantom `term-1`.
  if (!canOperateTerminal) {
    if (knownSessions === null) {
      return <LoadingScreen message={gt("Loading terminals…")} />;
    }
    if (knownSessions.length === 0) {
      return (
        <View className="flex-1 justify-center bg-screen p-4">
          <EmptyState
            title={gt("No terminals running")}
            detail={gt("There are no active terminal sessions to view for this thread.")}
          />
        </View>
      );
    }
  }

  return (
    <View className="flex-1 bg-screen">
      <View className="flex-row items-center gap-1 border-b border-border px-2 py-1.5">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row items-center gap-1.5 pr-1"
          className="flex-1"
        >
          {displaySessions.map((session) => {
            const selected = session.terminalId === activeTerminalId;
            return (
              <Pressable
                key={session.terminalId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                hitSlop={6}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  setSelectedTerminalId(session.terminalId);
                }}
                className={cn(
                  "min-h-[36px] flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-70",
                  selected ? "border-primary bg-primary/15" : "border-border bg-card",
                )}
              >
                <View
                  className={cn(
                    "size-1.5 rounded-full",
                    session.status === "running"
                      ? "bg-adaptive-emerald-600-400"
                      : session.status === "error"
                        ? "bg-danger-foreground"
                        : "bg-foreground-muted",
                  )}
                />
                <Text
                  numberOfLines={1}
                  className={cn(
                    "text-xs font-t3-medium",
                    selected ? "text-foreground" : "text-foreground-muted",
                  )}
                >
                  {session.displayLabel}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {canOperateTerminal ? (
          <IconButton
            accessibilityLabel={gt("New terminal")}
            icon="plus"
            onPress={handleCreateTerminal}
          />
        ) : null}
        <IconButton
          accessibilityLabel={gt("Show keyboard")}
          disabled={!canOperateTerminal}
          icon="keyboard"
          onPress={() => setKeyboardFocusNonce((current) => current + 1)}
        />
        <IconButton
          accessibilityLabel={gt("Open full terminal")}
          icon="arrow.up.left.and.arrow.down.right"
          onPress={() => props.onOpenFullTerminal(activeTerminalId)}
        />
      </View>
      <ThreadWorkbenchTerminalSession
        key={`${props.environmentId}:${props.threadId}:${activeTerminalId}`}
        environmentId={props.environmentId}
        threadId={props.threadId}
        terminalId={activeTerminalId}
        workspaceRoot={props.workspaceRoot}
        worktreePath={props.worktreePath}
        knownSession={
          knownSessions?.find((session) => session.target.terminalId === activeTerminalId) ?? null
        }
        hasExplicitTarget={createdTerminalIds.includes(activeTerminalId) || knownSessions !== null}
        canRead={canReadTerminal}
        canOperate={canOperateTerminal}
        active={isActive}
        keyboardFocusNonce={keyboardFocusNonce}
      />
    </View>
  );
}

function ThreadWorkbenchTerminalSession(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly knownSession: KnownTerminalSession | null;
  readonly hasExplicitTarget: boolean;
  readonly canRead: boolean;
  readonly canOperate: boolean;
  readonly active: boolean;
  readonly keyboardFocusNonce: number;
}) {
  const gt = useGT();
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "workbench terminal write");
  const serverConfigs = useServerConfigs();
  const { appearance, themeAppearance, themeId } = useAppearancePreferences();
  const terminalTheme = getMobileTerminalTheme(themeId, themeAppearance);
  const surfaceRef = useRef<TerminalSurfaceHandle>(null);
  const [pasteSession] = useState(createTerminalPasteSession);
  const [pendingModifier, setPendingModifier] = useState<PendingModifier | null>(null);
  const [initialGridSize] = useState(
    () =>
      getCachedTerminalGridSize({
        environmentId: props.environmentId,
        threadId: props.threadId,
        terminalId: props.terminalId,
      }) ?? { cols: WORKBENCH_DEFAULT_COLS, rows: WORKBENCH_DEFAULT_ROWS },
  );

  const openLocation = useMemo(
    () =>
      resolveTerminalOpenLocation({
        terminalLocation: props.knownSession?.state.summary ?? null,
        activeSessionLocation: props.knownSession?.state.summary ?? null,
        workspaceRoot: props.workspaceRoot,
        threadShellWorktreePath: props.worktreePath,
        threadDetailWorktreePath: props.worktreePath,
      }),
    [props.knownSession, props.workspaceRoot, props.worktreePath],
  );

  const [sessionDriver] = useState(() =>
    terminalEnvironment.createSession({
      target: {
        environmentId: props.environmentId,
        threadId: props.threadId,
        terminalId: props.terminalId,
      },
      gridSize: initialGridSize,
      canOperate: () => readEnvironmentScope(props.environmentId, AuthTerminalOperateScope),
      onExit: () => undefined,
      onLiveChange: (live) => {
        pasteSession.reset(live);
      },
    }),
  );

  const attachInput = useMemo(
    () =>
      props.canOperate
        ? {
            threadId: props.threadId,
            terminalId: props.terminalId,
            cwd: openLocation.cwd,
            worktreePath: openLocation.worktreePath,
            cols: initialGridSize.cols,
            rows: initialGridSize.rows,
          }
        : null,
    [
      initialGridSize.cols,
      initialGridSize.rows,
      openLocation.cwd,
      openLocation.worktreePath,
      props.canOperate,
      props.terminalId,
      props.threadId,
    ],
  );

  const observing = props.active && !props.canOperate && props.canRead && props.hasExplicitTarget;
  const streamingOutput = supportsNativeTerminalOutput();
  const terminal = useAttachedTerminalSession({
    materializeBuffer: !streamingOutput,
    environmentId: props.environmentId,
    terminal: !props.active
      ? null
      : props.canOperate
        ? attachInput
        : observing
          ? { threadId: props.threadId, terminalId: props.terminalId }
          : null,
  });

  useAtomMount(
    sessionDriver.driver(
      !props.active
        ? null
        : props.canOperate
          ? attachInput === null
            ? null
            : { kind: "attached", input: attachInput }
          : observing
            ? { kind: "observing" }
            : null,
    ),
  );

  const isRunning = terminal.status === "running" || terminal.status === "starting";
  const hostOs = serverConfigs.get(props.environmentId)?.environment.platform.os ?? null;
  const hostPlatform: HostPlatform = hostPlatformFromOs(hostOs) ?? "unknown";

  const writeInput = async (
    data: string,
    plainWrite?: TerminalWriteInput["plainWrite"],
  ): Promise<boolean> => {
    if (!isRunning || !readEnvironmentScope(props.environmentId, AuthTerminalOperateScope)) {
      return false;
    }
    const result = await writeTerminal({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        terminalId: props.terminalId,
        data,
        ...(plainWrite ? { plainWrite } : {}),
      },
    });
    return result._tag === "Success";
  };

  const pasteText = async (readText: () => Promise<string>) => {
    await pasteSession.paste({
      readText,
      write: writeInput,
      onReadError: () => undefined,
    });
  };

  const handleInput = (data: string) => {
    if (data.length === 0) return;
    if (pendingModifier === null) {
      void pasteSession.write(data, writeInput);
      return;
    }
    const modifier = pendingModifier;
    setPendingModifier(null);
    const resolved = resolveModifiedTerminalInput({
      data,
      modifier,
      hostPlatform,
    });
    if (resolved.kind === "paste") {
      void pasteText(Clipboard.getStringAsync);
      return;
    }
    void pasteSession.write(resolved.data, writeInput);
  };

  const handleResize = (size: { readonly cols: number; readonly rows: number }) => {
    cacheTerminalGridSize(
      {
        environmentId: props.environmentId,
        threadId: props.threadId,
        terminalId: props.terminalId,
      },
      size,
    );
    sessionDriver.reportGridSize(size);
  };

  if (terminal.error !== null && (!props.canOperate || terminal.status === "error")) {
    return (
      <View className="flex-1 justify-center bg-screen p-4">
        <EmptyState title={gt("Terminal unavailable")} detail={terminal.error} />
      </View>
    );
  }

  const quickKeys: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly accessibilityLabel: string;
    readonly active?: boolean;
    readonly onPress: () => void;
  }> = [
    {
      key: "esc",
      label: "Esc",
      accessibilityLabel: gt("Escape"),
      onPress: () => {
        setPendingModifier(null);
        void pasteSession.write("\u001b", writeInput);
      },
    },
    {
      key: "tab",
      label: "Tab",
      accessibilityLabel: gt("Tab"),
      onPress: () => {
        handleInput("\t");
      },
    },
    {
      key: "ctrl",
      label: "Ctrl",
      accessibilityLabel: gt("Control modifier"),
      active: pendingModifier === "ctrl",
      onPress: () => {
        setPendingModifier((current) => (current === "ctrl" ? null : "ctrl"));
      },
    },
    {
      key: "up",
      label: "↑",
      accessibilityLabel: gt("Up arrow"),
      onPress: () => {
        handleInput("\u001b[A");
      },
    },
    {
      key: "down",
      label: "↓",
      accessibilityLabel: gt("Down arrow"),
      onPress: () => {
        handleInput("\u001b[B");
      },
    },
  ];

  return (
    <View className="flex-1" style={{ backgroundColor: terminalTheme.background }}>
      <TerminalSurface
        ref={surfaceRef}
        autoFocus={false}
        readOnly={!props.canOperate}
        buffer={terminal.version === 0 ? null : terminal.buffer}
        output={terminal.version === 0 ? null : terminal.output}
        fontSize={Math.max(10, appearance.terminalFontSize - 1)}
        grid={terminal.grid}
        isRunning={isRunning}
        keyboardFocusRequest={props.keyboardFocusNonce}
        onInput={handleInput}
        onPaste={(text) => {
          void pasteText(async () => text);
        }}
        onResize={handleResize}
        style={{ flex: 1 }}
        terminalKey={`${props.environmentId}:${props.threadId}:${props.terminalId}:workbench`}
        theme={terminalTheme}
      />
      {props.canOperate && isRunning ? (
        <View
          className="flex-row items-center gap-1.5 px-2 py-1.5"
          style={{
            backgroundColor: terminalTheme.background,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: terminalTheme.border,
          }}
        >
          {quickKeys.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.accessibilityLabel}
              accessibilityState={item.active === undefined ? undefined : { selected: item.active }}
              hitSlop={6}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => undefined);
                item.onPress();
              }}
              className={cn(
                "min-h-[36px] min-w-[40px] items-center justify-center rounded-lg border px-2.5 active:opacity-65",
                item.active ? "border-primary bg-primary/15" : "border-border/60 bg-card/40",
              )}
            >
              <Text
                className={cn(
                  "text-xs font-t3-medium",
                  item.active ? "text-foreground" : "text-foreground-muted",
                )}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

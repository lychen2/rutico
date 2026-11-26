import "~/index.css";

import {
  applyTerminalAttachStreamEvent,
  combineTerminalSessionState,
  nextTerminalAttachSeedState,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import { EnvironmentId, ThreadId, type TerminalSessionSnapshot } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { AppAtomRegistryProvider, appAtomRegistry } from "../rpc/atomRegistry";
import { TerminalViewport } from "./ThreadTerminalDrawer";

const fixture = vi.hoisted(() => ({
  sessionAtom: null as Atom.Writable<ReturnType<typeof combineTerminalSessionState>> | null,
  buffer: null as TerminalBufferState | null,
  pushEvent: (_event: Parameters<typeof applyTerminalAttachStreamEvent>[1]) => {},
}));

vi.mock("../state/terminalSessions", async () => {
  const { Atom } = await import("effect/reactivity");
  const { EMPTY_TERMINAL_SESSION_STATE } = await import("@t3tools/client-runtime/state/terminal");
  const sessionAtom = Atom.make(EMPTY_TERMINAL_SESSION_STATE);
  fixture.sessionAtom = sessionAtom;
  fixture.pushEvent = (event) => {
    const current = fixture.buffer ?? nextTerminalAttachSeedState();
    const next = applyTerminalAttachStreamEvent(current, event);
    fixture.buffer = next;
    appAtomRegistry.set(sessionAtom, combineTerminalSessionState(null, next));
  };
  return {
    attachedTerminalSessionAtom: () => sessionAtom,
  };
});
vi.mock("../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success" }),
}));
vi.mock("../state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make(null);
  return { serverEnvironment: { configValueAtom: () => config } };
});
vi.mock("../state/terminal", () => ({
  terminalEnvironment: { write: {}, resize: {} },
}));
vi.mock("../state/preview", () => ({ previewEnvironment: { open: {} } }));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => () => {} }));
vi.mock("./preview/openTerminalLinkInPreview", () => ({ openTerminalLinkInPreview: () => {} }));
vi.mock("~/localApi", () => ({ readLocalApi: () => null }));
vi.mock("../hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    useClientSettings: <T,>(select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => T) =>
      select(DEFAULT_CLIENT_SETTINGS),
    ensureClientSettingsHydrated: async () => {},
    getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  };
});

function makeSnapshot(threadId: ThreadId, history: string): TerminalSessionSnapshot {
  return {
    threadId,
    terminalId: "term-1",
    cwd: "/repo",
    worktreePath: null,
    status: "running",
    pid: 123,
    history,
    exitCode: null,
    exitSignal: null,
    label: "Terminal 1",
    updatedAt: "2026-11-20T00:00:00.000Z",
  };
}

it("submits updated live line numbers from a real Ghostty surface after lines append and scroll the selection", async () => {
  const environmentId = EnvironmentId.make("env-pill-wasm");
  const threadId = ThreadId.make("thread-pill-wasm");
  fixture.buffer = null;
  fixture.pushEvent({
    type: "snapshot",
    snapshot: makeSnapshot(threadId, ""),
  });

  const onAddTerminalContext = vi.fn();
  const container = document.createElement("div");
  container.style.cssText = "width: 480px; height: 220px;";
  await using screen = await render(
    <AppAtomRegistryProvider>
      <TerminalViewport
        advancedTypography={false}
        threadRef={{ environmentId, threadId }}
        threadId={threadId}
        terminalId="term-1"
        terminalLabel="Terminal 1"
        cwd="/repo"
        onSessionExited={() => {}}
        onAddTerminalContext={onAddTerminalContext}
        visible
        keybindings={[]}
      />
    </AppAtomRegistryProvider>,
    { container },
  );

  // Wait for the real libghostty-vt WASM canvas to mount and measure cells.
  const canvas = await vi.waitFor(() => {
    const node = screen.container.querySelector<HTMLCanvasElement>("canvas");
    expect(node).not.toBeNull();
    expect(Number(node!.parentElement?.dataset.terminalCellHeight)).toBeGreaterThan(0);
    expect(node!.getBoundingClientRect().height).toBeGreaterThan(100);
    return node!;
  });

  const mountEl = canvas.parentElement!;
  const cellHeight = Number(mountEl.dataset.terminalCellHeight);
  const cellWidth = Number(mountEl.dataset.terminalCellWidth) || 8;
  const padding = Number(mountEl.dataset.terminalCellPadding) || 4;
  const totalRows = Math.floor((canvas.clientHeight - padding * 2) / cellHeight);
  expect(totalRows).toBeGreaterThanOrEqual(8);

  // Fill every row of the alternate screen so appending 2 lines scrolls the viewport up by 2 rows.
  const rows = Array.from({ length: totalRows }, (_, index) => `row ${index}`);
  await act(() => {
    fixture.pushEvent({
      type: "output",
      threadId,
      terminalId: "term-1",
      data: `\x1b[?1049h\x1b[H${rows.join("\r\n")}`,
    });
  });

  // Real Playwright mouse drag across "row 6" (0-indexed row 6, 1-indexed line 7).
  const row6Y = Math.round(padding + cellHeight * 6.5);
  const canvasLocator = page.elementLocator(canvas);
  await userEvent.hover(canvasLocator, { position: { x: Math.round(padding + 2), y: row6Y } });
  await commands.pointerDown();
  await userEvent.hover(canvasLocator, {
    position: { x: Math.round(padding + cellWidth * 6), y: row6Y },
  });
  await commands.pointerUp();

  const addButton = screen.getByRole("button", { name: "Add to chat" });
  await expect.element(addButton).toBeVisible();

  // Append two new lines in the alternate screen, scrolling "row 6" up by 2 rows (line 7 -> line 5).
  await act(() => {
    fixture.pushEvent({
      type: "output",
      threadId,
      terminalId: "term-1",
      data: "\r\nextra 1\r\nextra 2",
    });
  });

  await expect.element(addButton).toBeVisible();
  await userEvent.click(addButton);

  expect(onAddTerminalContext).toHaveBeenCalledOnce();
  const submitted = onAddTerminalContext.mock.calls[0]![0];
  expect(submitted.text).toBe("row 6");
  expect(submitted.lineStart).toBe(5);
  expect(submitted.lineEnd).toBe(5);
});

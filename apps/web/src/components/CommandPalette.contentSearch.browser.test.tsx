import "~/index.css";

import { EnvironmentId, ThreadId, type ProjectReadFileResult } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { dispatchCommandPalette, useCommandPaletteStore } from "../commandPaletteStore";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { CommandPalette } from "./CommandPalette";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-content-search"),
};

const FILE_CONTENTS = [
  'const header = "intro line that pushes document offset past line two";',
  "const secondNeedle = `multi-line",
  "continued ${secondNeedle}`;",
].join("\n");

const fixture = vi.hoisted(() => ({
  readFileCalls: [] as string[],
  search: {
    canReadFiles: true,
    isCheckingAccess: false,
    hasQuery: true,
    isPending: false,
    error: null,
    invalidRegex: false,
    truncated: false,
    matches: [
      {
        path: "src/example.ts",
        lineNumber: 2,
        lineContent: "const secondNeedle = `multi-line",
        matchRanges: [{ start: 6, end: 18 }],
      },
    ],
  },
}));

vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    environmentId: threadRef.environmentId,
    cwd: "/workspace",
    projectName: "workspace",
    threadRef,
  }),
}));
vi.mock("~/hooks/useTheme", () => ({
  useRenderedAppearance: () => "light",
  useTheme: () => ({ theme: "t3-chat", resolvedTheme: "light", appearanceMode: "light" }),
}));
vi.mock("~/state/filesystem", async (original) => ({
  ...(await original<typeof import("~/state/filesystem")>()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock("~/state/session", async (original) => ({
  ...(await original<typeof import("~/state/session")>()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("~/state/queries", async (original) => ({
  ...(await original<typeof import("~/state/queries")>()),
  useProjectContentSearch: () => fixture.search,
}));
vi.mock("~/state/projects", async (original) => {
  const actual = await original<typeof import("~/state/projects")>();
  const fileAtoms = new Map<string, Atom.Atom<AsyncResult.AsyncResult<ProjectReadFileResult>>>();
  return {
    ...actual,
    projectEnvironment: {
      ...actual.projectEnvironment,
      readFile: ({ input }: { input: { relativePath: string } }) => {
        fixture.readFileCalls.push(input.relativePath);
        let atom = fileAtoms.get(input.relativePath);
        if (!atom) {
          atom = Atom.make<AsyncResult.AsyncResult<ProjectReadFileResult>>(
            AsyncResult.success({
              relativePath: input.relativePath,
              contents: FILE_CONTENTS,
              byteLength: FILE_CONTENTS.length,
              truncated: false,
            }),
          );
          fileAtoms.set(input.relativePath, atom);
        }
        return atom;
      },
    },
  };
});

async function withViewport(width: number, height: number): Promise<AsyncDisposable> {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  return {
    async [Symbol.asyncDispose]() {
      await page.viewport(previous.width, previous.height);
    },
  };
}

function resetPalette() {
  fixture.readFileCalls = [];
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
}

describe("CommandPalette content search preview", () => {
  it("expands on wide viewports to show the syntax-highlighted preview with exact 2nd-line text and highlight", async () => {
    resetPalette();
    await using _viewport = await withViewport(1280, 800);
    await using _screen = await render(
      <AppAtomRegistryProvider>
        <CommandPalette>{null}</CommandPalette>
      </AppAtomRegistryProvider>,
    );

    await act(() => {
      dispatchCommandPalette({
        _tag: "OpenChildSearch",
        mode: "content",
        context: { query: "", linkedThreadSearch: null },
      });
    });

    const palette = page.getByTestId("command-palette");
    await expect.element(palette).toHaveAttribute("data-palette-mode", "content");
    expect(palette.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(672);

    const peekPane = page.getByRole("complementary", { name: "Match context preview" });
    await expect.element(peekPane).toBeVisible();
    await vi.waitFor(() => expect(fixture.readFileCalls).toContain("src/example.ts"));

    // Wait for Shiki multi-line syntax highlighting to render colored token spans on the target line.
    await vi.waitFor(() => {
      const targetRow = peekPane
        .element()
        .querySelector<HTMLElement>('[data-search-context-target="true"]');
      expect(targetRow).not.toBeNull();
      const coloredSpans = targetRow!.querySelectorAll<HTMLElement>('span[style*="color"]');
      expect(coloredSpans.length).toBeGreaterThan(0);
    });

    const targetRow = peekPane
      .element()
      .querySelector<HTMLElement>('[data-search-context-target="true"]')!;
    const codeSpan = targetRow.children[1] as HTMLElement;
    expect(codeSpan.textContent).toBe("const secondNeedle = `multi-line");
    const marks = [...codeSpan.querySelectorAll("mark")];
    expect(marks.map((mark) => mark.textContent)).toEqual(["secondNeedle"]);

    // Verify surrounding lines (1st and 3rd, including multi-line template continuation) stay intact.
    const allRows = [...peekPane.element().querySelectorAll<HTMLElement>("div.flex.min-w-0")];
    const lineTexts = allRows.map(
      (row) => (row.children[1] as HTMLElement | undefined)?.textContent,
    );
    expect(lineTexts).toEqual([
      'const header = "intro line that pushes document offset past line two";',
      "const secondNeedle = `multi-line",
      "continued ${secondNeedle}`;",
    ]);
  });

  it("hides the preview and issues zero preview file reads on narrow viewports", async () => {
    resetPalette();
    await using _viewport = await withViewport(560, 800);
    await using _screen = await render(
      <AppAtomRegistryProvider>
        <CommandPalette>{null}</CommandPalette>
      </AppAtomRegistryProvider>,
    );

    using _timers = fakeTimers();
    await act(() => {
      dispatchCommandPalette({
        _tag: "OpenChildSearch",
        mode: "content",
        context: { query: "", linkedThreadSearch: null },
      });
    });

    const palette = page.getByTestId("command-palette");
    await expect.element(palette).toHaveAttribute("data-palette-mode", "content");
    expect(palette.element().getBoundingClientRect().width).toBeLessThan(672);

    // Advance past the 120ms prefetch debounce to prove no deferred file reads fire while hidden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(page.getByRole("complementary", { name: "Match context preview" }).query()).toBeNull();
    expect(fixture.readFileCalls).toEqual([]);
  });
});

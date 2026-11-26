import "~/index.css";
import "~/styles/pairing-motion.css";
import "~/styles/workspace-hubs.css";

import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import { CommandPaletteContent } from "~/components/CommandPaletteContent";
import { TaskPlanCapsule } from "~/components/chat/TaskPlanCapsule";
import type { AntigravityTaskTrail } from "~/components/chat/antigravityTaskTrail";
import {
  buildDiffHunkAnchors,
  flashHunkSpotlightInShadowDom,
  resolveNextHunkIndex,
} from "~/components/diffs/diffHunkNav";
import {
  CommandDialog,
  CommandDialogPopup,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { QRCodeSvg } from "~/components/ui/qr-code";
import { buildFileDiffEntries, getRenderablePatch } from "~/lib/diffRendering";
import { act, fakeTimers, render } from "../../../test/render";
import { recordThemeTransitionOrigin, runThemeViewTransition } from "./themeTransition";

// Deterministic Chromium Playwright verification of integrated Wave 2 journeys (C139).
// Native Linux Electron compositor helpers & Android hardware traces remain separate artifacts.

function makeTaskTrail(overrides?: Partial<AntigravityTaskTrail>): AntigravityTaskTrail {
  return {
    key: "plan-wave2-demo",
    planId: "plan-wave2-demo",
    steps: [
      { id: "step-1", text: "Audit motion foundation", status: "completed" },
      { id: "step-2", text: "Verify Diff & CommandPalette", status: "running" },
      { id: "step-3", text: "Complete cross-surface gate", status: "pending" },
    ],
    activities: {
      "step-1": [
        {
          id: "act-1",
          kind: "read",
          label: "Read motion-foundation.css",
          path: "apps/web/src/styles/motion-foundation.css",
          status: "completed",
        },
      ],
      "step-2": [
        {
          id: "act-2",
          kind: "command",
          label: "Run Chromium verification",
          command: "vp test run",
          status: "running",
        },
      ],
    },
    waiting: false,
    failed: false,
    complete: false,
    ...overrides,
  };
}

function ZeroLatencyCommandPaletteHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Launch palette
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandDialogPopup aria-label="Command palette">
          <CommandPaletteContent
            items={["Switch theme", "Search workspace", "Open terminal"]}
            inputProps={{ placeholder: "Type a command…" }}
          >
            <CommandList>
              {(item: string) => (
                <CommandItem key={item} value={item}>
                  {item}
                </CommandItem>
              )}
            </CommandList>
          </CommandPaletteContent>
        </CommandDialogPopup>
      </CommandDialog>
    </div>
  );
}

describe("Wave 2 integrated end-to-end choreography verification (C139)", () => {
  it("choreographs View Transition theme iris ripple in Chromium and bypasses cleanly under reduced motion", async () => {
    document.documentElement.style.backgroundColor = "rgb(18, 18, 22)";
    recordThemeTransitionOrigin(240, 140);

    let committedTheme = "light";
    const animated = runThemeViewTransition(() => {
      committedTheme = "dark";
      document.documentElement.dataset.testTheme = committedTheme;
    });
    expect(animated).toBe(true);

    // Chromium runs document.startViewTransition's update callback asynchronously before settling.
    await vi.waitFor(() => {
      expect(committedTheme).toBe("dark");
      expect(document.documentElement.dataset.testTheme).toBe("dark");
      expect(document.documentElement.dataset.themeTransition).toBeUndefined();
    });

    const session = cdp();
    try {
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      const reducedAnimated = runThemeViewTransition(() => {
        committedTheme = "light";
        document.documentElement.dataset.testTheme = committedTheme;
      });
      expect(reducedAnimated).toBe(false);
      expect(document.documentElement.dataset.testTheme).toBe("light");
      expect(document.documentElement.dataset.themeTransition).toBeUndefined();
    } finally {
      delete document.documentElement.dataset.testTheme;
      document.documentElement.style.backgroundColor = "";
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  it("morphs TaskPlanCapsule single-shell expand/collapse and triggers completion bloom", async () => {
    const runningTrail = makeTaskTrail();
    await using screen = await render(<TaskPlanCapsule progress={runningTrail} />, {
      router: false,
    });

    const capsule = screen.container.querySelector<HTMLElement>("[data-plan-capsule]")!;
    const bar = screen.container.querySelector<HTMLButtonElement>('[data-plan-bar="true"]')!;
    expect(capsule.dataset.mode).toBe("run");
    expect(capsule.dataset.open).toBe("false");
    expect(bar.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(bar);
    await vi.waitFor(() => {
      expect(capsule.dataset.open).toBe("true");
      expect(bar.getAttribute("aria-expanded")).toBe("true");
    });
    await expect.element(screen.getByText("Audit motion foundation")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));
    await vi.waitFor(() => {
      expect(capsule.dataset.open).toBe("false");
      expect(bar.getAttribute("aria-expanded")).toBe("false");
    });

    const completedTrail = makeTaskTrail({
      complete: true,
      durationMs: 2400,
      steps: runningTrail.steps.map((step) => ({ ...step, status: "completed" as const })),
    });
    await screen.rerender(<TaskPlanCapsule progress={completedTrail} />);

    await vi.waitFor(() => {
      expect(capsule.dataset.mode).toBe("done");
      expect(capsule.querySelector('[data-just-completed="true"]')).not.toBeNull();
    });
  });

  it("steps @pierre/diffs logical hunk anchors and decorates real Shadow DOM lines cleanly", async () => {
    const patch = [
      "diff --git a/src/motion.ts b/src/motion.ts",
      "--- a/src/motion.ts",
      "+++ a/src/motion.ts",
      "@@ -1,2 +1,3 @@",
      " export const a = 1;",
      "+export const b = 2;",
      " export const c = 3;",
      "diff --git a/src/shell.ts b/src/shell.ts",
      "--- a/src/shell.ts",
      "+++ a/src/shell.ts",
      "@@ -10,2 +10,3 @@",
      " export function open() {",
      "+  return true;",
      " }",
      "",
    ].join("\n");

    const parsed = getRenderablePatch(patch);
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    const entries = buildFileDiffEntries(parsed.files).map((entry) => ({
      fileKey: entry.fileKey,
      filePath: entry.fileDiff.name,
      fileDiff: entry.fileDiff,
    }));
    const anchors = buildDiffHunkAnchors(entries);
    expect(anchors).toHaveLength(2);
    expect(resolveNextHunkIndex(null, 1, anchors.length)).toBe(0);
    expect(resolveNextHunkIndex(0, 1, anchors.length)).toBe(1);
    expect(resolveNextHunkIndex(1, 1, anchors.length)).toBe(0);

    await using screen = await render(null, { router: false });
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const addedLine = document.createElement("div");
    addedLine.setAttribute("data-line", String(anchors[0]!.startLine));
    addedLine.setAttribute("data-line-type", "change-addition");
    const untouchedLine = document.createElement("div");
    untouchedLine.setAttribute("data-line", String(anchors[0]!.startLine));
    untouchedLine.setAttribute("data-line-type", "change-deletion");
    shadow.append(addedLine, untouchedLine);
    screen.container.append(host);

    using _timers = fakeTimers();
    const matchedCount = flashHunkSpotlightInShadowDom(
      [{ id: anchors[0]!.fileKey, element: host }],
      anchors[0]!,
    );
    expect(matchedCount).toBe(1);
    expect(addedLine.getAttribute("data-hunk-spotlight")).toBe("true");
    expect(untouchedLine.getAttribute("data-hunk-spotlight")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(addedLine.getAttribute("data-hunk-spotlight")).toBeNull();
  });

  it("opens CommandDialogPopup with zero entrance delay and focuses the search input immediately", async () => {
    await using _screen = await render(<ZeroLatencyCommandPaletteHarness />);

    await userEvent.click(page.getByRole("button", { name: "Launch palette" }));
    const popup = page.getByRole("dialog", { name: "Command palette" });
    await expect.element(popup).toBeVisible();
    await expect.element(page.getByPlaceholder("Type a command…")).toHaveFocus();

    const style = getComputedStyle(popup.element());
    const delays = style.transitionDelay.split(",").map((part) => part.trim());
    expect(delays.every((delay) => delay === "0s")).toBe(true);
    if (CSS.supports("corner-shape", "superellipse(1.25)")) {
      expect(style.getPropertyValue("corner-shape")).toBe("superellipse(1.25)");
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(popup).not.toBeInTheDocument();
  });

  it("renders branded rounded-eye QR SVG geometry with 3 finder eyes, center mark, and zero backdrop blur", async () => {
    await using screen = await render(
      <QRCodeSvg
        value="https://rutico.example/pair?code=wave2-c139-verification-token"
        level="Q"
        size={192}
        variant="branded"
        showCenterMark
        title="Pair Android device"
      />,
      { router: false },
    );

    const svg = screen.container.querySelector<SVGSVGElement>('svg[data-qr-variant="branded"]')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelector('[data-slot="qr-branded-modules"]')?.getAttribute("d")).toBeTruthy();
    expect(svg.querySelectorAll('[data-slot="qr-finder-eyes"] > g')).toHaveLength(3);
    expect(svg.querySelector('[data-slot="qr-center-mark"]')).not.toBeNull();
    expect(getComputedStyle(svg).backdropFilter).toBe("none");
  });
});

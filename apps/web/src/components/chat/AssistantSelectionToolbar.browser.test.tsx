import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

function SelectionToolbarHarness() {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <div>
      <div
        ref={setViewport}
        data-assistant-citation-viewport="true"
        className="relative h-64 w-96 overflow-auto p-4"
      >
        <div data-assistant-citation-source="assistant-msg-1">
          <p>Selectable assistant reply for keyboard navigation.</p>
        </div>
      </div>
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={{
          environmentId: EnvironmentId.make("env-1"),
          threadId: ThreadId.make("thread-1"),
        }}
        onCite={vi.fn(() => true)}
      />
    </div>
  );
}

describe("AssistantSelectionToolbar", () => {
  it("keeps initial Tab shortcut into Cite and lets forward Tab leave Copy without looping", async () => {
    await using screen = await render(<SelectionToolbarHarness />, { router: false });

    const text = screen.getByText("Selectable assistant reply for keyboard navigation.");
    await userEvent.tripleClick(text);

    const citeButton = page.getByRole("button", { name: "Cite selection in composer" });
    const copyButton = page.getByRole("button", { name: "Copy selection" });
    await expect.element(citeButton).toBeVisible();
    await expect.element(copyButton).toBeVisible();

    // Place a focusable control after the portaled toolbar in document tab order.
    const afterButton = document.createElement("button");
    afterButton.type = "button";
    afterButton.textContent = "After toolbar";
    document.body.append(afterButton);
    using _cleanup = { [Symbol.dispose]: () => afterButton.remove() };

    // First Tab enters the toolbar on Cite.
    await userEvent.keyboard("{Tab}");
    await expect.element(citeButton).toHaveFocus();

    // Second Tab advances from Cite to Copy.
    await userEvent.keyboard("{Tab}");
    await expect.element(copyButton).toHaveFocus();

    // Third Tab leaves the toolbar cleanly to the next control instead of looping back to Cite.
    await userEvent.keyboard("{Tab}");
    await expect.element(page.getByRole("button", { name: "After toolbar" })).toHaveFocus();
    expect(document.querySelector('[data-assistant-selection-toolbar="true"]')).toBeNull();
  });
});

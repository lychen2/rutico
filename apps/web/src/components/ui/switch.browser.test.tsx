import { EnvironmentId, ScheduledTaskId, ThreadId, type ScheduledTask } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const automationsState = vi.hoisted(() => ({
  allowed: true,
  toggle: vi.fn(),
  run: vi.fn(),
  task: null as ScheduledTask | null,
}));

vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => automationsState.allowed,
  readEnvironmentScope: () => automationsState.allowed,
}));
vi.mock(import("@effect/atom-react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomValue: (() => automationsState.allowed) as never,
}));
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => {
  const { serverEnvironment } = await import("../../state/server");
  return {
    ...(await importOriginal()),
    useAtomCommand: ((command: unknown) =>
      command === serverEnvironment.setScheduledTaskEnabled
        ? automationsState.toggle
        : automationsState.run) as never,
  };
});
vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: { tasks: automationsState.task ? [automationsState.task] : [] },
    error: null,
  })) as never,
}));

import { render } from "../../../test/render";
import { ThreadAutomationsPanel } from "../chat/ThreadAutomationsPanel";
import { Switch } from "./switch";

async function cdpDrag(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): Promise<void> {
  const session = cdp();
  const [first, ...rest] = points;
  if (!first) return;
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: first.x,
    y: first.y,
    buttons: 0,
  });
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    x: first.x,
    y: first.y,
  });
  for (const point of rest) {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x: point.x,
      y: point.y,
    });
  }
  const last = rest.at(-1) ?? first;
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    x: last.x,
    y: last.y,
  });
}

function ControlledSwitch({
  initialChecked = false,
  onChange,
  wrapInLabel = false,
}: {
  readonly initialChecked?: boolean;
  readonly onChange: (nextChecked: boolean) => void;
  readonly wrapInLabel?: boolean;
}) {
  const [checked, setChecked] = useState(initialChecked);
  const control = (
    <Switch
      aria-label="Enable automation"
      checked={checked}
      onCheckedChange={(nextChecked) => {
        setChecked(nextChecked);
        onChange(nextChecked);
      }}
    />
  );
  return (
    <div className="p-10">
      {wrapInLabel ? (
        <label className="inline-flex items-center gap-2">
          {control}
          <span>Enable automation</span>
        </label>
      ) : (
        control
      )}
    </div>
  );
}

describe("Switch drag-back and toggle interactions under locked @base-ui/react", () => {
  it("cancels Base UI toggle when dragged past midpoint and back to start, and toggles once on opposite drag, click, and Space", async () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    await using screen = await render(<ControlledSwitch onChange={onChange} />);

    const switchEl = screen.getByRole("switch", { name: "Enable automation" }).element();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    const rect = switchEl.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const startX = rect.left + 4;
    const pastMidX = rect.right - 2;

    // 1. Drag from unchecked past midpoint, then drag back to start -> 0 calls.
    await cdpDrag([
      { x: startX, y },
      { x: pastMidX, y },
      { x: startX, y },
    ]);
    expect(onChange).toHaveBeenCalledTimes(0);
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    // 2. Drag from unchecked to opposite side -> exactly 1 call (true).
    await cdpDrag([
      { x: startX, y },
      { x: pastMidX, y },
    ]);
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    // 2b. Drag from checked left past midpoint, then drag back to checked side -> still 1 call.
    await cdpDrag([
      { x: pastMidX, y },
      { x: startX, y },
      { x: pastMidX, y },
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    // 3. Normal pointer click -> exactly 1 more call (false).
    await userEvent.click(screen.getByRole("switch", { name: "Enable automation" }));
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    // 4. Keyboard Space -> exactly 1 more call (true).
    (switchEl as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(3);
    });
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
  });

  it("does not trigger native hidden input toggle on drag-back when wrapped in a label", async () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    await using screen = await render(<ControlledSwitch onChange={onChange} wrapInLabel />);

    const switchEl = screen.getByRole("switch", { name: "Enable automation" }).element();
    const rect = switchEl.getBoundingClientRect();
    const y = rect.top + rect.height / 2;

    await cdpDrag([
      { x: rect.left + 4, y },
      { x: rect.right - 2, y },
      { x: rect.left + 4, y },
    ]);
    expect(onChange).toHaveBeenCalledTimes(0);
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    // Even if a native click hits the hidden checkbox directly right after a drag-back
    // (e.g. from label activation without pointer capture), it is suppressed too.
    const hiddenInput = screen.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(hiddenInput).not.toBeNull();
    switchEl.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 7,
        button: 0,
        clientX: rect.left + 4,
        clientY: y,
      }),
    );
    switchEl.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 7,
        clientX: rect.right - 2,
        clientY: y,
      }),
    );
    switchEl.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 7,
        clientX: rect.left + 4,
        clientY: y,
      }),
    );
    switchEl.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 7,
        clientX: rect.left + 4,
        clientY: y,
      }),
    );
    hiddenInput.click();
    expect(onChange).toHaveBeenCalledTimes(0);
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    // Subsequent normal click still works.
    await userEvent.click(screen.getByRole("switch", { name: "Enable automation" }));
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
  });

  it("prevents drag-back from writing scheduled task enabled state in ThreadAutomationsPanel", async () => {
    const environmentId = EnvironmentId.make("remote");
    const threadId = ThreadId.make("thread");
    automationsState.allowed = true;
    automationsState.toggle.mockReset().mockResolvedValue({ _tag: "Success" });
    automationsState.run.mockReset().mockResolvedValue({ _tag: "Success" });
    automationsState.task = {
      id: ScheduledTaskId.make("task-1"),
      threadId,
      title: "Daily review",
      enabled: true,
      schedule: { type: "interval", everyMs: 60_000 },
      lastRunStatus: "never",
      nextRunAt: null,
    } as ScheduledTask;

    await using screen = await render(
      <div className="w-80 p-6">
        <ThreadAutomationsPanel environmentId={environmentId} threadId={threadId} />
      </div>,
    );

    const switchEl = screen.getByRole("switch", { name: "Pause Daily review" }).element();
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    const rect = switchEl.getBoundingClientRect();
    const y = rect.top + rect.height / 2;

    // Drag left past midpoint (toward unchecked), then back right to original checked side -> 0 RPC calls.
    await cdpDrag([
      { x: rect.right - 2, y },
      { x: rect.left + 2, y },
      { x: rect.right - 2, y },
    ]);
    expect(automationsState.toggle).toHaveBeenCalledTimes(0);

    // Drag cleanly to the opposite side -> exactly 1 RPC call disabling the task.
    await cdpDrag([
      { x: rect.right - 2, y },
      { x: rect.left + 2, y },
    ]);
    await vi.waitFor(() => {
      expect(automationsState.toggle).toHaveBeenCalledTimes(1);
    });
    expect(automationsState.toggle).toHaveBeenCalledWith({
      environmentId,
      input: { id: automationsState.task.id, enabled: false },
    });
  });
});

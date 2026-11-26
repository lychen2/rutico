import { createContext, use, useEffect, useState, type ReactNode } from "react";

/** Whether the inspector pane subtree is currently visible on screen (false when hidden in a drawer or inactive tab). */
export const InspectorPaneVisibleContext = createContext(true);

export function useInspectorPaneVisible(): boolean {
  return use(InspectorPaneVisibleContext);
}

export interface InspectorPane {
  readonly key: string;
  readonly label?: string;
  readonly render: () => ReactNode;
  /** Opening one of these panes soon mounts the others too, so switching between them is instant. */
  readonly prewarm?: boolean;
}

/** What a route shows in the workspace's inspector: its panes and the one on screen. */
export interface InspectorContent {
  readonly panes: ReadonlyArray<InspectorPane>;
  readonly active: string;
  readonly onSelectPane?: (key: string) => void;
  /** A failed pane renders again when one of these changes. */
  readonly resetKeys?: ReadonlyArray<unknown>;
}

const PREWARM_DELAY_MS = 350;

/**
 * The panes to keep mounted: every pane opened since the inspector appeared, plus prewarmed ones.
 * A mounted pane keeps its state and scroll position while another is on screen.
 */
export function useMountedInspectorPanes(content: InspectorContent | undefined) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const active = content?.active;
  const prewarms = content?.panes.filter((pane) => pane.prewarm) ?? [];
  const prewarmSignature = prewarms.some((pane) => pane.key === active)
    ? prewarms.map((pane) => pane.key).join("\n")
    : "";

  if (active !== undefined && !opened.has(active)) {
    setOpened(new Set([...opened, active]));
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- prewarms the other panes on a timer after one opens
  useEffect(() => {
    if (prewarmSignature === "") return;
    const timeout = setTimeout(() => {
      setOpened((current) => {
        const keys = prewarmSignature.split("\n");
        return keys.every((key) => current.has(key)) ? current : new Set([...current, ...keys]);
      });
    }, PREWARM_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [prewarmSignature]);

  return content?.panes.filter((pane) => opened.has(pane.key)) ?? [];
}

import type { ReactNode } from "react";

import type { InspectorContent } from "./inspector-panes";

export interface AndroidPaseoPanelsProps {
  readonly enabled: boolean;
  readonly viewportWidth: number;
  readonly inspectorContent: InspectorContent | undefined;
  readonly inspectorOpen: boolean;
  readonly onCloseInspector: () => void;
  readonly onStartNewTask: () => void;
  /** Optional external predictive-back progress (0..1) when bridged from native Android 14-16. */
  readonly predictiveBackProgress?: number;
  readonly children: ReactNode;
}

export function AndroidPaseoPanels(props: AndroidPaseoPanelsProps) {
  return props.children;
}

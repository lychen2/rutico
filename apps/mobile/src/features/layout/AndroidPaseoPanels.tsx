import type { ReactNode } from "react";

import type { InspectorContent } from "./inspector-panes";

export interface AndroidPaseoPanelsProps {
  readonly enabled: boolean;
  readonly viewportWidth: number;
  readonly inspectorContent: InspectorContent | undefined;
  readonly inspectorOpen: boolean;
  readonly onCloseInspector: () => void;
  readonly onStartNewTask: () => void;
  readonly children: ReactNode;
}

export function AndroidPaseoPanels(props: AndroidPaseoPanelsProps) {
  return props.children;
}

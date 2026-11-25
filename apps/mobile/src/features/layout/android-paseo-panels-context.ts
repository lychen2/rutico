import { createContext } from "react";

export interface AndroidPaseoPanelsContextValue {
  readonly activePanel: -1 | 0 | 1;
  readonly openLeftDrawer: () => void;
  readonly openRightWorkbench: () => void;
  readonly closePanels: () => void;
}

export const AndroidPaseoPanelsContext = createContext<AndroidPaseoPanelsContextValue | null>(null);

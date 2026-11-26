import { useSyncExternalStore } from "react";

export type HistoryDirection = "back" | "forward";

function getNavigationApi(): Navigation | null {
  if (typeof window === "undefined" || !("navigation" in window)) return null;
  return window.navigation ?? null;
}

function subscribeToNavigationHistory(onChange: () => void): () => void {
  const navigation = getNavigationApi();
  if (!navigation) return () => {};
  navigation.addEventListener("currententrychange", onChange);
  return () => navigation.removeEventListener("currententrychange", onChange);
}

export function canNavigateHistory(direction: HistoryDirection): boolean {
  const navigation = getNavigationApi();
  if (navigation) {
    return direction === "back" ? navigation.canGoBack : navigation.canGoForward;
  }
  if (typeof window === "undefined") return false;
  return direction === "back" ? window.history.length > 1 : true;
}

export function navigateHistory(direction: HistoryDirection) {
  if (direction === "back") window.history.back();
  else window.history.forward();
}

/** Only for Electron: the Navigation API is Chromium-only. */
export function useCanNavigateHistory(direction: HistoryDirection): boolean {
  return useSyncExternalStore(subscribeToNavigationHistory, () => canNavigateHistory(direction));
}

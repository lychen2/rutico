import { useSyncExternalStore } from "react";

import { isElectron } from "../env";
import {
  createSoftwareKeyboardStore,
  syncDocumentSoftwareKeyboardInset,
} from "../lib/softwareKeyboard";

const store = createSoftwareKeyboardStore(
  typeof window === "undefined" ? undefined : window,
  isElectron,
);

function getServerSnapshot() {
  return false;
}

export function useSoftwareKeyboardOpen() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}

/** Binds the shared software-keyboard store to `documentElement`'s `--software-keyboard-inset`. */
export function startSoftwareKeyboardInsetSync(): () => void {
  return syncDocumentSoftwareKeyboardInset(store);
}

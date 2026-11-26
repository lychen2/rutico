import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { trackKeyboardLayout } from "./keyboardLayout";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { isElectron } from "./env";
import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { whenLocaleReady } from "./i18n/runtime";
import { chunkLoadState } from "./lib/chunkReloadGuard";
import { prefersReducedMotion } from "./lib/motion/springs";

const BOOT_CURTAIN_FALLBACK_MS = 300;

function armBootCurtain(): HTMLElement | null {
  const curtain = document.getElementById("boot-curtain");
  if (!curtain) return null;
  if (prefersReducedMotion()) {
    curtain.remove();
    return null;
  }
  curtain.dataset.bootCurtain = "holding";
  document.documentElement.dataset.bootTransition = "entering";
  return curtain;
}

function dismissBootCurtain(curtain: HTMLElement | null): void {
  if (!curtain || !curtain.isConnected) {
    delete document.documentElement.dataset.bootTransition;
    return;
  }
  if (prefersReducedMotion()) {
    curtain.remove();
    delete document.documentElement.dataset.bootTransition;
    return;
  }

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(fallbackTimer);
    curtain.removeEventListener("transitionend", onTransitionEnd);
    curtain.remove();
    delete document.documentElement.dataset.bootTransition;
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === curtain && event.propertyName === "opacity") {
      cleanup();
    }
  };
  const fallbackTimer = window.setTimeout(cleanup, BOOT_CURTAIN_FALLBACK_MS);
  curtain.addEventListener("transitionend", onTransitionEnd);

  // Double-rAF guarantees React has committed and painted its first frame beneath the curtain.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (finished || !curtain.isConnected) return;
      curtain.dataset.bootCurtain = "dismiss";
      document.documentElement.dataset.bootTransition = "settling";
    });
  });
}

function removeBootCurtainImmediately(): void {
  document.getElementById("boot-curtain")?.remove();
  delete document.documentElement.dataset.bootTransition;
}

const stopTrackingKeyboardLayout = trackKeyboardLayout();
import.meta.hot?.dispose(stopTrackingKeyboardLayout);

const router = startAppServices();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const app = <AppRoot router={router} />;

// Split by runtime to keep Clerk out of local startup and clerk-js out of browser builds.
const managedAuthShellModule =
  clerkPublishableKey && hasCloudPublicConfig()
    ? isElectron
      ? import("./components/clerk/ElectronManagedAuthShell")
      : import("./components/clerk/BrowserManagedAuthShell")
    : null;

export const startup = Promise.all([
  managedAuthShellModule?.then((module) => module.default) ?? null,
  // Chained so settings have usually hydrated; English resolves without a chunk load.
  router.load().then(whenLocaleReady),
])
  .then(([ManagedAuthShell]) => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (chunkLoadState.reloadScheduled) return;
    const curtain = armBootCurtain();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {ManagedAuthShell && clerkPublishableKey ? (
          <ManagedAuthShell publishableKey={clerkPublishableKey}>{app}</ManagedAuthShell>
        ) : (
          app
        )}
      </React.StrictMode>,
    );
    dismissBootCurtain(curtain);
  })
  .catch((error: unknown) => {
    removeBootCurtainImmediately();
    if (chunkLoadState.reloadScheduled) return;
    throw error;
  });

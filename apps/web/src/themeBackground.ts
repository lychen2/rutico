import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry, subscribeAtomChanges } from "./rpc/atomRegistry";
import { assetEnvironment } from "./state/assets";
import { localEnvironmentIdAtom } from "./state/primaryEnvironment";
import { themeServerEnvironmentThemesAtom } from "./state/server";
import { environmentSession } from "./state/session";
import { getCustomThemes } from "./themePalette";

const THEME_BACKGROUND_VARIABLE = "--theme-background-image";
const THEME_BACKGROUND_PREV_VARIABLE = "--theme-background-image-prev";
const CROSSFADE_DURATION_MS = 360;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

// The editor's draft preview replaces the root's theme id, so retries track this instead.
let appliedThemeId: string | undefined;
let shownKey: string | null = null;
let loading: AbortController | null = null;
let objectUrl: string | null = null;
let previousObjectUrl: string | null = null;
let crossfadeTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingCrossfade(): void {
  if (crossfadeTimer !== null) {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
  }
  if (previousObjectUrl !== null) {
    URL.revokeObjectURL(previousObjectUrl);
    previousObjectUrl = null;
  }
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.style.removeProperty(THEME_BACKGROUND_PREV_VARIABLE);
    delete root.dataset.themeBackgroundCrossfade;
  }
}

function show(nextUrl: string | null): void {
  const root = document.documentElement;
  if (nextUrl === null) {
    clearPendingCrossfade();
    root.style.removeProperty(THEME_BACKGROUND_VARIABLE);
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    return;
  }

  // Double-buffer crossfade: retain previous decoded image during the 360ms GPU dissolve,
  // then safely revoke its blob URL once the fade completes.
  const outgoingUrl = objectUrl;
  clearPendingCrossfade();
  objectUrl = nextUrl;

  if (outgoingUrl !== null) {
    previousObjectUrl = outgoingUrl;
    root.style.setProperty(THEME_BACKGROUND_PREV_VARIABLE, `url("${outgoingUrl}")`);
    root.dataset.themeBackgroundCrossfade = "active";
    root.style.setProperty(THEME_BACKGROUND_VARIABLE, `url("${nextUrl}")`);
    crossfadeTimer = setTimeout(() => {
      crossfadeTimer = null;
      if (previousObjectUrl === outgoingUrl) {
        URL.revokeObjectURL(outgoingUrl);
        previousObjectUrl = null;
      }
      if (typeof document !== "undefined") {
        document.documentElement.style.removeProperty(THEME_BACKGROUND_PREV_VARIABLE);
        delete document.documentElement.dataset.themeBackgroundCrossfade;
      }
    }, CROSSFADE_DURATION_MS);
    return;
  }

  root.style.setProperty(THEME_BACKGROUND_VARIABLE, `url("${nextUrl}")`);
}

async function decodeBlobImage(url: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted || typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  if (typeof img.decode === "function") {
    try {
      await img.decode();
    } catch {
      // Fall through so partially supported environments still render the blob.
    }
  }
}

async function loadBackground(
  environmentId: EnvironmentId,
  themeId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const minted = await executeAtomQuery(
    appAtomRegistry,
    assetEnvironment.createUrl({
      environmentId,
      input: { resource: { _tag: "environment-theme-background", themeId } },
    }),
    { label: "theme background", reportFailure: false, refresh: true, signal },
  );
  const connection = appAtomRegistry.get(
    environmentSession.preparedConnectionValueAtom(environmentId),
  );
  if (minted._tag !== "Success" || connection._tag === "None") return null;
  const url = resolveAssetUrl(connection.value.httpBaseUrl, minted.value.relativeUrl);
  if (url === null) return null;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const image = await response.blob();
  if (!image.type.startsWith("image/")) return null;
  const blobUrl = URL.createObjectURL(image);
  await decodeBlobImage(blobUrl, signal);
  if (signal.aborted) {
    URL.revokeObjectURL(blobUrl);
    return null;
  }
  return blobUrl;
}

/**
 * Sets `--theme-background-image` to the image published beside `themeId`, or clears it.
 * Double-buffers switches via `image.decode()` so switching wallpapers never flashes blank.
 */
export function applyThemeBackground(themeId: string | undefined): void {
  if (typeof document === "undefined") return;
  appliedThemeId = themeId;
  const environmentId = appAtomRegistry.get(localEnvironmentIdAtom);
  // A saved theme wins its id over a published one, so the published image is not its.
  const revision =
    themeId === undefined || getCustomThemes().some((theme) => theme.id === themeId)
      ? undefined
      : appAtomRegistry.get(themeServerEnvironmentThemesAtom)?.find((theme) => theme.id === themeId)
          ?.background;
  const key =
    environmentId === null || themeId === undefined || revision === undefined
      ? null
      : JSON.stringify([environmentId, themeId, revision]);
  if (key === shownKey) return;
  shownKey = key;
  loading?.abort();
  loading = null;
  // Clear immediately when switching to a theme with no published background; when another
  // background is incoming, keep the previous buffer live until `image.decode()` resolves.
  if (environmentId === null || themeId === undefined || key === null) {
    show(null);
    return;
  }
  const controller = new AbortController();
  loading = controller;
  let retries = 0;
  const failed = () => {
    if (controller.signal.aborted) return;
    const delay = RETRY_DELAYS_MS[retries++];
    if (delay !== undefined) {
      // Transient HTTP failures may never produce a browser online event.
      const timer = setTimeout(load, delay);
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      return;
    }
    loading = null;
    // Lets the next repaint or `online` event try again.
    shownKey = null;
  };
  const load = () => {
    loadBackground(environmentId, themeId, controller.signal).then((url) => {
      if (controller.signal.aborted) {
        if (url !== null) URL.revokeObjectURL(url);
        return;
      }
      if (url === null) failed();
      else {
        loading = null;
        show(url);
      }
    }, failed);
  };
  load();
}

/**
 * A new image revision does not change the palette, so it does not repaint the theme.
 * Coming back online retries a download that failed; a shown image is left alone.
 */
export function startThemeBackground(): () => void {
  const reapply = () => applyThemeBackground(appliedThemeId);
  const unsubscribe = subscribeAtomChanges(themeServerEnvironmentThemesAtom, reapply);
  window.addEventListener("online", reapply);
  return () => {
    unsubscribe();
    window.removeEventListener("online", reapply);
    loading?.abort();
    loading = null;
    shownKey = null;
    show(null);
  };
}

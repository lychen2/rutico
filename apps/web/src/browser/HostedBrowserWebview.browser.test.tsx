import "~/index.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type DesktopPreviewBridge,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  registerWebview: vi.fn<DesktopPreviewBridge["registerWebview"]>(),
  getPreviewConfig: vi.fn<DesktopPreviewBridge["getPreviewConfig"]>(),
}));

vi.mock(import("~/env"), async (original) => ({ ...(await original()), isElectron: true }));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/localApi"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    ensureLocalApi: () => ({ ...actual.ensureLocalApi(), persistence: mocks as never }),
  };
});
vi.mock(import("~/components/preview/previewBridge"), async (original) => ({
  ...(await original()),
  previewBridge: {
    createTab: mocks.createTab,
    closeTab: mocks.closeTab,
    registerWebview: mocks.registerWebview,
    getPreviewConfig: mocks.getPreviewConfig,
    onStateChange: () => () => {},
  } as never,
}));
vi.mock(import("~/components/preview/usePreviewBridge"), async (original) => ({
  ...(await original()),
  usePreviewBridge: () => undefined,
}));

import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
} from "~/hooks/useSettings";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

const threadRef = scopeThreadRef(EnvironmentId.make("a14-env"), ThreadId.make("a14-thread"));
const RUNTIME_TAB_ID = "a14-runtime-tab";

function setup(): Disposable {
  __resetClientSettingsPersistenceForTests();
  useBrowserSurfaceStore.setState(useBrowserSurfaceStore.getInitialState(), true);
  mocks.getClientSettings.mockReset().mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  mocks.setClientSettings.mockReset().mockResolvedValue(undefined);
  mocks.createTab.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset().mockResolvedValue(undefined);
  mocks.registerWebview.mockReset().mockResolvedValue(undefined);
  mocks.getPreviewConfig.mockReset().mockResolvedValue({
    partition: "persist:t3-preview-default",
    webPreferences: "contextIsolation=yes",
    preloadUrl: null,
  });
  return {
    [Symbol.dispose]() {
      useBrowserSurfaceStore.setState(useBrowserSurfaceStore.getInitialState(), true);
      __resetClientSettingsPersistenceForTests();
    },
  };
}

async function decodeScreenshotPng(base64: string): Promise<ImageData> {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function sampleHorizontalLuminanceRow(
  image: ImageData,
  xStart: number,
  xEnd: number,
  y: number,
): number[] {
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const values: number[] = [];
  for (
    let x = Math.max(0, Math.floor(xStart));
    x <= Math.min(image.width - 1, Math.ceil(xEnd));
    x++
  ) {
    const offset = (clampedY * image.width + x) * 4;
    const r = image.data[offset] ?? 255;
    const g = image.data[offset + 1] ?? 255;
    const b = image.data[offset + 2] ?? 255;
    values.push(Math.round((r + g + b) / 3));
  }
  return values;
}

async function captureElementImageData(element: HTMLElement): Promise<ImageData> {
  const base64 = await page.screenshot({
    element,
    base64: true,
    save: false,
  });
  return decodeScreenshotPng(base64);
}

describe("HostedBrowserWebview preserve-3d preset capture crispness (A14)", () => {
  it("preserves the 3D compositing context without overflow-hidden flattening when scaling a device preset for full-detail capture", async () => {
    using _state = setup();
    const preset: PreviewViewportSetting = {
      _tag: "preset",
      presetId: "desktop-1440x900",
      width: 600,
      height: 400,
    };

    // 1. Native size (panel larger than 600x400 preset -> scale === 1).
    useBrowserSurfaceStore.setState({
      byTabId: {
        [RUNTIME_TAB_ID]: {
          visible: true,
          rect: { x: 0, y: 0, width: 700, height: 520 },
          content: null,
          cornerRadius: 0,
          zIndex: 30,
          fitSourceContent: false,
          fittedSourceContent: null,
          updatedAt: 0,
          owner: null,
        },
      },
      activityByTabId: { [RUNTIME_TAB_ID]: 1 },
    });

    await using stack = new AsyncDisposableStack();
    const screen = stack.use(
      await render(
        <AppAtomRegistryProvider>
          <HostedBrowserWebview
            threadRef={threadRef}
            tabId="tab-1"
            runtimeTabId={RUNTIME_TAB_ID}
            initialUrl="https://example.com"
            viewport={preset}
            pictureInPicture={false}
            profileId={undefined}
            zoomFactor={1}
          />
        </AppAtomRegistryProvider>,
      ),
    );
    stack.defer(async () => {
      using _timers = fakeTimers();
      await screen.unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => ensureClientSettingsHydrated());

    const webview = screen.container.querySelector<HTMLElement>("webview")!;
    expect(webview).not.toBeNull();
    // Inject a 1px crisp vertical black line at x = 300px on white inside the webview box.
    const line = document.createElement("div");
    line.style.cssText =
      "position:absolute;left:300px;top:0;width:1px;height:400px;background:#000000;";
    webview.append(line);

    const nativeImage = await captureElementImageData(webview);
    const nativeDpr = nativeImage.width / webview.getBoundingClientRect().width;
    const nativeCenterX = 300 * nativeDpr;
    const nativeRow = sampleHorizontalLuminanceRow(
      nativeImage,
      nativeCenterX - 3,
      nativeCenterX + 3,
      nativeImage.height / 2,
    );
    // Native 1px black line hits pure black (0) flanked by pure white (255).
    expect(Math.min(...nativeRow)).toBe(0);
    expect(nativeRow[0]).toBe(255);
    expect(nativeRow.at(-1)).toBe(255);

    // 2. Shrink the panel smaller than the 600x400 preset so HostedBrowserWebview scales down
    //    with matrix3d(..., depth, ...) + preserve-3d (fullDetail = true via activityByTabId).
    await act(() => {
      useBrowserSurfaceStore.setState((current) => ({
        ...current,
        byTabId: {
          [RUNTIME_TAB_ID]: {
            ...current.byTabId[RUNTIME_TAB_ID]!,
            rect: { x: 0, y: 0, width: 340, height: 280 },
          },
        },
      }));
    });

    const preserveParent = webview.parentElement!;
    expect(getComputedStyle(webview).transform).toContain("matrix3d(");
    expect(getComputedStyle(preserveParent).transformStyle).toBe("preserve-3d");

    // Probe Chromium's ACTUAL 3D compositing preservation using real screenshot pixels:
    // Under matrix3d(s, 0, depth, ...), x = 300px has z = 300 * depth (> 200px).
    // A later sibling at translateZ(20px) sits BEHIND x=300px if preserve-3d is active,
    // but paints OVER and erases the line (all 255 white!) if overflow:hidden flattened preserve-3d.
    const zProbe = document.createElement("div");
    zProbe.style.cssText =
      "position:absolute;inset:0;background:#ffffff;transform:translateZ(20px);pointer-events:none;";
    preserveParent.append(zProbe);

    const scaledImage = await captureElementImageData(preserveParent);
    const scaledRow = sampleHorizontalLuminanceRow(
      scaledImage,
      0,
      scaledImage.width - 1,
      scaledImage.height / 2,
    );
    zProbe.remove();

    // If preserve-3d is NOT flattened by overflow:hidden, the black 1px line at z > 200px
    // renders in front of the white z=20px plane; if flattened, min luminance stays 255.
    expect(Math.min(...scaledRow)).toBeLessThan(180);
    expect(getComputedStyle(preserveParent).overflow).toBe("visible");

    // Outer preset frame still keeps rounded clipping and shadow.
    const outerFrame = preserveParent.parentElement!;
    expect(getComputedStyle(outerFrame).overflow).toBe("hidden");
    expect(Number.parseFloat(getComputedStyle(outerFrame).borderTopLeftRadius)).toBeGreaterThan(0);
  });

  it("never detaches the webview element when toggling fullDetail or switching viewport modes", async () => {
    using _state = setup();
    useBrowserSurfaceStore.setState({
      byTabId: {
        [RUNTIME_TAB_ID]: {
          visible: true,
          rect: { x: 0, y: 0, width: 340, height: 280 },
          content: null,
          cornerRadius: 0,
          zIndex: 30,
          fitSourceContent: false,
          fittedSourceContent: null,
          updatedAt: 0,
          owner: null,
        },
      },
      activityByTabId: { [RUNTIME_TAB_ID]: 0 },
    });

    const renderView = (viewport: PreviewViewportSetting) => (
      <AppAtomRegistryProvider>
        <HostedBrowserWebview
          threadRef={threadRef}
          tabId="tab-1"
          runtimeTabId={RUNTIME_TAB_ID}
          initialUrl="https://example.com"
          viewport={viewport}
          pictureInPicture={false}
          profileId={undefined}
          zoomFactor={1}
        />
      </AppAtomRegistryProvider>
    );

    await using stack = new AsyncDisposableStack();
    const screen = stack.use(
      await render(
        renderView({ _tag: "preset", presetId: "desktop-1440x900", width: 600, height: 400 }),
      ),
    );
    stack.defer(async () => {
      using _timers = fakeTimers();
      await screen.unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => ensureClientSettingsHydrated());

    const initialWebview = screen.container.querySelector("webview")!;
    expect(initialWebview).not.toBeNull();

    const detached: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) detached.push(...record.removedNodes);
    });
    observer.observe(screen.container, { childList: true, subtree: true });

    await act(() => {
      useBrowserSurfaceStore.setState((current) => ({
        ...current,
        activityByTabId: { [RUNTIME_TAB_ID]: 1 },
      }));
    });
    await screen.rerender(renderView({ _tag: "freeform", width: 500, height: 400 }));
    await screen.rerender(renderView({ _tag: "fill" }));
    await screen.rerender(
      renderView({ _tag: "preset", presetId: "desktop-1440x900", width: 600, height: 400 }),
    );
    await act(() => {
      useBrowserSurfaceStore.setState((current) => ({
        ...current,
        activityByTabId: { [RUNTIME_TAB_ID]: 0 },
      }));
    });

    observer.takeRecords().forEach((record) => detached.push(...record.removedNodes));
    observer.disconnect();

    expect(detached.includes(initialWebview)).toBe(false);
    expect(screen.container.querySelector("webview")).toBe(initialWebview);
  });
});

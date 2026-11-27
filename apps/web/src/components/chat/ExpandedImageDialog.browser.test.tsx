import { useState } from "react";
import type { SnapShotSource } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ExpandedImageDialog } from "./ExpandedImageDialog";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const snapShotSource: SnapShotSource = {
  kind: "snap-shot",
  capturedAt: "2026-01-01T00:00:00.000Z",
  appName: "Finder",
  windowTitle: "Downloads",
};

const D2_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1174 920"><rect width="1174" height="920"/></svg>';

function ImagePreviewOpener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open preview
      </button>
      {open && (
        <ExpandedImageDialog
          preview={{ images: [{ src: PIXEL, name: "shot.png", source: snapShotSource }], index: 0 }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("ExpandedImageDialog", () => {
  it.each([
    { opener: "mouse", focusVisible: false },
    { opener: "keyboard", focusVisible: true },
  ])("returns $opener focus to the opener on close", async (c) => {
    await using screen = await render(<ImagePreviewOpener />, {
      // The opener renders no links and reads no route.
      router: false,
    });
    const opener = screen.getByRole("button", { name: "Open preview" });
    if (c.opener === "mouse") {
      await userEvent.click(opener);
    } else {
      await userEvent.keyboard("{Tab}");
      await userEvent.keyboard("{Enter}");
    }
    await expect.element(page.getByRole("button", { name: "Close image preview" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(opener).toHaveFocus();
    expect(opener.element().matches(":focus-visible")).toBe(c.focusVisible);
  });

  it.each(["/work/pipeline.svg", "/work/diagram#v2.svg", "/work/diagram?v2.svg"])(
    "fits a markdown SVG without intrinsic size to the viewer: %s",
    async (path) => {
      const src = URL.createObjectURL(new Blob([D2_SVG], { type: "image/svg+xml" }));
      using _src = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };
      await using screen = await render(
        <ExpandedImageDialog
          preview={{
            images: [
              {
                src,
                name: "Pipeline",
                actionsSource: {
                  kind: "image",
                  name: "Pipeline",
                  src,
                  reference: { kind: "file", path },
                },
              },
            ],
            index: 0,
          }}
          onClose={vi.fn()}
        />,
        // The dialog renders no links and reads no route.
        { router: false },
      );

      const viewer = screen.getByRole("region", { name: "Pipeline, zoomable image" });
      const availableWidth = window.innerWidth * 0.92 - (window.innerWidth >= 640 ? 96 : 0);
      await vi.waitFor(() =>
        expect(viewer.element().getBoundingClientRect().width).toBeCloseTo(availableWidth, 0),
      );
    },
  );

  it("Escape closes a popup opened inside the dialog before the dialog", async () => {
    const onClose = vi.fn();
    await using screen = await render(
      <ExpandedImageDialog
        preview={{ images: [{ src: PIXEL, name: "shot.png", source: snapShotSource }], index: 0 }}
        onClose={onClose}
      />,
      // The dialog renders no links and reads no route.
      { router: false },
    );

    await userEvent.click(screen.getByRole("button", { name: "No accessibility data" }));
    await expect.element(screen.getByText("Accessibility data")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByText("Accessibility data")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Focus returns to the popup's trigger and opens its tooltip; leave it for a plain control.
    (screen.getByRole("button", { name: "Close image preview" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("scrolling pans the image while Ctrl+wheel zooms around the pointer", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1200;
    await using screen = await render(
      <ExpandedImageDialog
        preview={{ images: [{ src: canvas.toDataURL(), name: "large.png" }], index: 0 }}
        onClose={() => {}}
      />,
      // The dialog renders no links and reads no route.
      { router: false },
    );
    const viewportLocator = screen.getByRole("region", { name: "large.png, zoomable image" });
    const viewport = viewportLocator.element() as HTMLElement;
    const image = screen.getByRole("img", { name: "large.png" }).element() as HTMLElement;
    await vi.waitFor(() => expect(image.style.width).not.toBe(""));
    const fitWidth = image.getBoundingClientRect().width;
    const wheels: { ctrlKey: boolean; canceled: boolean }[] = [];
    const recordWheel = (event: WheelEvent) =>
      wheels.push({ ctrlKey: event.ctrlKey, canceled: event.defaultPrevented });
    document.addEventListener("wheel", recordWheel);
    using _wheelListener = {
      [Symbol.dispose]: () => document.removeEventListener("wheel", recordWheel),
    };
    // Wheels land on the viewport's center; this is the image fraction under it.
    const pointerFraction = () => {
      const viewportBounds = viewport.getBoundingClientRect();
      const imageBounds = image.getBoundingClientRect();
      return {
        x: (viewportBounds.left + viewportBounds.width / 2 - imageBounds.left) / imageBounds.width,
        y: (viewportBounds.top + viewportBounds.height / 2 - imageBounds.top) / imageBounds.height,
      };
    };
    const ctrlWheel = async (deltaY: number) => {
      await userEvent.keyboard("{Control>}");
      await userEvent.wheel(viewportLocator, { delta: { y: deltaY } });
      await userEvent.keyboard("{/Control}");
    };

    await userEvent.wheel(viewportLocator, { delta: { y: 120 } });
    expect(wheels.at(-1)).toEqual({ ctrlKey: false, canceled: false });
    expect(image.getBoundingClientRect().width).toBe(fitWidth);

    await ctrlWheel(-100);
    expect(wheels.at(-1)).toEqual({ ctrlKey: true, canceled: true });
    const zoomedWidth = image.getBoundingClientRect().width;
    expect(zoomedWidth).toBeCloseTo(fitWidth * Math.E, 0);

    const pan = async (delta: { x: number; y: number }) => {
      const { scrollLeft, scrollTop } = viewport;
      await userEvent.wheel(viewportLocator, { delta });
      await vi.waitFor(() => {
        expect(Math.sign(viewport.scrollLeft - scrollLeft)).toBe(Math.sign(delta.x));
        expect(Math.sign(viewport.scrollTop - scrollTop)).toBe(Math.sign(delta.y));
      });
    };
    await pan({ x: 60, y: 0 });
    await pan({ x: 0, y: 60 });
    await pan({ x: -40, y: -40 });
    expect(wheels.filter((wheel) => !wheel.ctrlKey).every((wheel) => !wheel.canceled)).toBe(true);
    expect(image.getBoundingClientRect().width).toBe(zoomedWidth);

    const anchor = pointerFraction();
    await ctrlWheel(-50);
    expect(image.getBoundingClientRect().width).toBeGreaterThan(zoomedWidth);
    expect(pointerFraction().x).toBeCloseTo(anchor.x, 2);
    expect(pointerFraction().y).toBeCloseTo(anchor.y, 2);
  });

  it("displays the zoom multiplier HUD on click zoom and steps cleanly between gallery items", async () => {
    await using _screen = await render(
      <ExpandedImageDialog
        preview={{
          images: [
            { src: PIXEL, name: "first.png" },
            { src: PIXEL, name: "second.png" },
          ],
          index: 0,
          sourceRect: { left: 24, top: 24, width: 64, height: 64 },
        }}
        onClose={() => {}}
      />,
      { router: false },
    );

    const hud = document.querySelector<HTMLElement>('[data-zoom-hud="true"]')!;
    expect(hud.getAttribute("data-visible")).toBe("false");

    await userEvent.click(page.getByRole("region", { name: "first.png, zoomable image" }));
    expect(hud.getAttribute("data-visible")).toBe("true");
    expect(hud.textContent).toBe("200%");

    await userEvent.click(page.getByRole("button", { name: "Next media" }));
    await expect.element(page.getByText("second.png (2/2)")).toBeVisible();
  });

  it("navigates gallery items on horizontal touch swipe at fit zoom while ignoring cancel, vertical, and zoomed gestures", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const largeImage = canvas.toDataURL();

    await using _screen = await render(
      <ExpandedImageDialog
        preview={{
          images: [
            { src: largeImage, name: "first.png" },
            { src: largeImage, name: "second.png" },
            { src: largeImage, name: "third.png" },
          ],
          index: 0,
        }}
        onClose={() => {}}
      />,
      { router: false },
    );

    const session = cdp();
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    try {
      const touchSwipe = async (
        element: HTMLElement,
        deltaX: number,
        deltaY: number,
        cancel = false,
      ) => {
        const rect = element.getBoundingClientRect();
        const frame = window.frameElement?.getBoundingClientRect();
        const startX = Math.round(rect.left + rect.width / 2 + (frame?.left ?? 0));
        const startY = Math.round(rect.top + rect.height / 2 + (frame?.top ?? 0));
        const midX = Math.round(startX + deltaX * 0.5);
        const midY = Math.round(startY + deltaY * 0.5);
        const endX = Math.round(startX + deltaX);
        const endY = Math.round(startY + deltaY);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: startX, y: startY, id: 1 }],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: midX, y: midY, id: 1 }],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: endX, y: endY, id: 1 }],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: cancel ? "touchCancel" : "touchEnd",
          touchPoints: [],
        });
      };

      const firstViewer = page
        .getByRole("region", { name: "first.png, zoomable image" })
        .element() as HTMLElement;
      await vi.waitFor(() =>
        expect(firstViewer.getBoundingClientRect().width).toBeGreaterThan(200),
      );

      // Horizontal swipe left advances to second image.
      await touchSwipe(firstViewer, -120, 4);
      await expect.element(page.getByText("second.png (2/3)")).toBeVisible();

      const secondViewer = page
        .getByRole("region", { name: "second.png, zoomable image" })
        .element() as HTMLElement;
      await vi.waitFor(() =>
        expect(secondViewer.getBoundingClientRect().width).toBeGreaterThan(200),
      );

      // Vertical touch gesture does not navigate.
      await touchSwipe(secondViewer, 8, -120);
      await expect.element(page.getByText("second.png (2/3)")).toBeVisible();

      // Cancelled horizontal touch swipe does not navigate.
      await touchSwipe(secondViewer, -120, 0, true);
      await expect.element(page.getByText("second.png (2/3)")).toBeVisible();

      // Horizontal swipe right returns to first image.
      await touchSwipe(secondViewer, 120, 4);
      await expect.element(page.getByText("first.png (1/3)")).toBeVisible();

      // When zoomed in, horizontal touch drag does not advance the gallery.
      const zoomedViewerLocator = page.getByRole("region", { name: "first.png, zoomable image" });
      await userEvent.click(zoomedViewerLocator);
      const hud = document.querySelector<HTMLElement>('[data-zoom-hud="true"]')!;
      await vi.waitFor(() => expect(hud.textContent).toBe("200%"));

      await touchSwipe(zoomedViewerLocator.element() as HTMLElement, -120, 0);
      await expect.element(page.getByText("first.png (1/3)")).toBeVisible();
    } finally {
      await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    }
  });
});

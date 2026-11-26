/* oxlint-disable react/no-unstable-nested-components -- These callbacks return overlays, and are invoked as render functions. */
import { msg, T, useGT } from "gt-react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  FileSurfaceAction,
  FileSurfaceLoading,
  FILE_SURFACE_SUBHEADER_CLASS,
} from "../fileSurfaceChrome";
import { OfficePages, type PaintPage } from "./OfficePages";
import { createWorkerClient } from "./worker-rpc";
import type { SlideMethods, SlideSummary } from "./slide-protocol";
import { rasterize } from "./vector-pictures";
import { m } from "~/i18n/messages";

type Opened = { slides: readonly SlideSummary[]; paint: PaintPage };
export default function Presentation(props: {
  bytes: ArrayBuffer;
  onDetails: (text: string) => void;
  onError: (cause: unknown) => void;
}) {
  const { onError, bytes: source, onDetails } = props;
  const gt = useGT();
  const [opened, setOpened] = useState<Opened>();
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [scrubHudVisible, setScrubHudVisible] = useState(false);
  const [scrubHudPinned, setScrubHudPinned] = useState(false);
  const scrubHudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroll = useRef<((index: number, y?: number) => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clears the auto-fading slide scrub HUD timer on unmount.
  useEffect(
    () => () => {
      if (scrubHudTimer.current !== null) clearTimeout(scrubHudTimer.current);
    },
    [],
  );
  const revealScrubHud = () => {
    setScrubHudVisible(true);
    if (scrubHudTimer.current !== null) clearTimeout(scrubHudTimer.current);
    scrubHudTimer.current = setTimeout(() => {
      setScrubHudVisible(false);
      scrubHudTimer.current = null;
    }, 2000);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Open and paint slides through a worker whose requests and lifetime belong to this presentation.
  useEffect(() => {
    const controller = new AbortController();
    const worker = new Worker(new URL("./presentation.worker.ts", import.meta.url), {
      type: "module",
    });
    const engine = createWorkerClient<SlideMethods>(worker);
    const fail = (cause: unknown) => {
      if (!controller.signal.aborted) onError(cause);
    };
    worker.addEventListener("error", fail);
    worker.addEventListener("messageerror", fail);
    const paint = async (
      index: number,
      canvas: HTMLCanvasElement,
      scale: number,
      signal: AbortSignal,
      again = false,
    ): Promise<void> => {
      const result = await engine.call(
        "paint",
        { index, density: (window.devicePixelRatio || 1) * scale },
        { key: `slide:${index}`, signal },
      );
      if (signal.aborted || result.kind === "cancelled") {
        if (result.kind === "painted") result.bitmap.close();
        return;
      }
      setFailed((previous) => ({ ...previous, [index]: result.kind === "failed" }));
      if (result.kind === "failed") return;
      const context = canvas.getContext("bitmaprenderer");
      if (!context) {
        result.bitmap.close();
        throw new Error(m(msg("This browser cannot draw slides.")));
      }
      canvas.width = result.bitmap.width;
      canvas.height = result.bitmap.height;
      context.transferFromImageBitmap(result.bitmap);
      if (again || !result.vectors.length) return;
      const bitmaps = await Promise.all(result.vectors.map(rasterize));
      if (signal.aborted) {
        bitmaps.forEach((value) => value.bitmap?.close());
        return;
      }
      await engine.call("vectors", bitmaps, {
        transfer: bitmaps.flatMap((value) => (value.bitmap ? [value.bitmap] : [])),
        signal,
      });
      if (!signal.aborted) await paint(index, canvas, scale, signal, true);
    };
    const bytes = source.slice(0);
    void engine
      .call("open", { bytes }, { transfer: [bytes], signal: controller.signal })
      .then((slides) => {
        if (slides.length === 0 || slides.length > 500)
          throw new Error(m(msg("Preview limited to presentations with 1 to 500 slides.")));
        setOpened({ slides, paint });
        onDetails(
          m(
            msg("{count, plural, one {{count} slide} other {{count} slides}}", {
              count: slides.length,
            }),
          ),
        );
      })
      .catch(fail);
    return () => {
      controller.abort();
      engine.close();
    };
  }, [source, onDetails, onError]);
  if (!opened) return <FileSurfaceLoading />;
  const select = (index: number) => {
    setPage(index);
    scroll.current?.(index);
    revealScrubHud();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={FILE_SURFACE_SUBHEADER_CLASS}>
        <FileSurfaceAction
          label={gt("Previous slide")}
          disabled={page === 0}
          onPress={() => select(page - 1)}
        >
          <ChevronLeftIcon className="size-3.5" />
        </FileSurfaceAction>
        <span className="flex-1 text-center text-xs tabular-nums" aria-live="polite">
          {gt("Slide {page} of {count}", {
            page: String(page + 1),
            count: String(opened.slides.length),
          })}
        </span>
        <FileSurfaceAction
          label={gt("Next slide")}
          disabled={page + 1 === opened.slides.length}
          onPress={() => select(page + 1)}
        >
          <ChevronRightIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <OfficePages
          pages={opened.slides}
          paint={opened.paint}
          kind="slide"
          scrollRef={scroll}
          onPageChange={(nextPage) => {
            setPage(nextPage);
            revealScrubHud();
          }}
          onError={onError}
          overlay={(index) => (
            <>
              {opened.slides[index]?.hidden ? (
                <div className="pointer-events-none absolute inset-0 bg-white/50" />
              ) : null}
              {failed[index] ? (
                <p
                  role="status"
                  className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-xs text-foreground"
                >
                  <T>This slide could not be drawn.</T>
                </p>
              ) : null}
            </>
          )}
          footer={(index) => {
            const slide = opened.slides[index];
            return slide?.notes || slide?.hidden ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                {slide.hidden ? (
                  <p>
                    <T>Hidden slide</T>
                  </p>
                ) : null}
                {slide.notes ? (
                  <p
                    role="note"
                    aria-label={gt("Speaker notes")}
                    className="select-text whitespace-pre-wrap break-words"
                  >
                    {slide.notes}
                  </p>
                ) : null}
              </div>
            ) : null;
          }}
        />
        {opened.slides.length > 1 ? (
          <div
            data-visible={scrubHudVisible || scrubHudPinned ? "true" : "false"}
            className="doc-scrub-hud surface-optical-chrome surface-elevated-rim absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-2xs text-foreground"
            onPointerEnter={() => setScrubHudPinned(true)}
            onPointerLeave={() => {
              setScrubHudPinned(false);
              revealScrubHud();
            }}
          >
            <span className="shrink-0 font-medium tabular-nums">
              {`${page + 1} / ${opened.slides.length}`}
            </span>
            {opened.slides.length <= 16 ? (
              <div className="flex items-center gap-1">
                {opened.slides.map((_slide, index) => (
                  <button
                    // oxlint-disable-next-line react/no-array-index-key -- Slide ordinals are stable for an opened presentation.
                    key={index}
                    type="button"
                    aria-label={gt("Slide {number}", { number: String(index + 1) })}
                    aria-current={index === page ? "true" : undefined}
                    onClick={() => select(index)}
                    className={
                      index === page
                        ? "h-1.5 w-4 cursor-pointer rounded-full bg-primary transition-[width,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
                        : "size-1.5 cursor-pointer rounded-full bg-muted-foreground/45 transition-[width,background-color] duration-150 ease-out hover:bg-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
                    }
                  />
                ))}
              </div>
            ) : (
              <input
                type="range"
                min={1}
                max={opened.slides.length}
                value={page + 1}
                aria-label={gt("Jump to slide")}
                onChange={(event) => select(Number(event.target.value) - 1)}
                onFocus={() => setScrubHudPinned(true)}
                onBlur={() => {
                  setScrubHudPinned(false);
                  revealScrubHud();
                }}
                className="h-1 w-24 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { msg, T, useGT } from "gt-react";
import { Grid2x2Icon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { m } from "~/i18n/messages";

import { useTheme } from "~/hooks/useTheme";

import { FileSurfaceAction, FileSurfaceLoading } from "./fileSurfaceChrome";

type FontBackdrop = "default" | "checkerboard" | "dark" | "light";

const MAX_FONT_BYTES = 10 * 1024 * 1024;

async function readFont(src: string, signal: AbortSignal) {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(m(msg("The font could not be loaded.")));
  if (Number(response.headers.get("content-length")) > MAX_FONT_BYTES)
    throw new Error(m(msg("Font previews are limited to 10 MB.")));
  const reader = response.body?.getReader();
  if (!reader) throw new Error(m(msg("The font is unavailable.")));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_FONT_BYTES) throw new Error(m(msg("Font previews are limited to 10 MB.")));
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const blob = new Blob(chunks);
  await new FontFace("file-preview", await blob.arrayBuffer()).load();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener(
      "error",
      () => reject(new Error(m(msg("The font could not be decoded.")))),
      { once: true },
    );
    reader.readAsDataURL(blob);
  });
}

export default function FontViewer(props: { readonly src: string; readonly name: string }) {
  const gt = useGT();
  const { resolvedTheme } = useTheme();
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<FontBackdrop>("default");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the font from its URL and abort the request and timeout when the source changes or unmounts.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setError(m(msg("The font took too long to load.")));
      controller.abort();
    }, 30_000);
    void readFont(props.src, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(thrownErrorMessage(cause, m) ?? m(msg("The font is damaged or unsupported.")));
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [props.src]);
  if (error)
    return (
      <div
        role="alert"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
      >
        <p className="text-sm font-medium">
          <T>No preview for this file</T>
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {gt("{error} Save it to open in another app.", { error })}
        </p>
      </div>
    );
  if (!data) return <FileSurfaceLoading />;
  const tokens = getComputedStyle(document.documentElement);
  const themeBackground = tokens.getPropertyValue("--background");
  const themeForeground = tokens.getPropertyValue("--foreground");
  const stageScheme = backdrop === "dark" ? "dark" : backdrop === "light" ? "light" : resolvedTheme;
  const background =
    backdrop === "dark" ? "#111317" : backdrop === "light" ? "#f6f7f9" : themeBackground;
  const foreground =
    backdrop === "dark" ? "#f2f4f8" : backdrop === "light" ? "#111317" : themeForeground;
  const checkerboardCss =
    backdrop === "checkerboard"
      ? `background-image:conic-gradient(${resolvedTheme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)"} 90deg,transparent 90deg 180deg,${resolvedTheme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)"} 180deg 270deg,transparent 270deg);background-size:16px 16px;`
      : "";
  const escapeHtml = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const heading = escapeHtml(gt("Font preview"));
  const sample = escapeHtml(gt("The quick brown fox jumps over the lazy dog."));
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>@font-face{font-family:preview;src:url('${data}')}html{color-scheme:${stageScheme};background:${background};color:${foreground};${checkerboardCss}}body{margin:0;padding:32px;font-family:preview;overflow-wrap:anywhere}h1{font-size:40px;font-weight:normal}p{line-height:1.4}small{font:12px monospace;display:block;opacity:.6;margin-bottom:8px}</style></head><body><h1>${heading}</h1><p style="font-size:24px">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 !?&amp;@#%(){}[]</p>${[12, 16, 24, 40, 64].map((size) => `<p style="font-size:${size}px"><small>${size} px</small>${sample}</p>`).join("")}</body></html>`;
  const toggleBackdrop = (next: Exclude<FontBackdrop, "default">) =>
    setBackdrop((current) => (current === next ? "default" : next));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center justify-end gap-1 border-b border-border/60 px-3 py-1 text-xs text-muted-foreground">
        <FileSurfaceAction
          label={gt("Checkerboard backdrop")}
          pressed={backdrop === "checkerboard"}
          onPress={() => toggleBackdrop("checkerboard")}
        >
          <Grid2x2Icon className="size-3.5" />
        </FileSurfaceAction>
        <FileSurfaceAction
          label={gt("Dark backdrop")}
          pressed={backdrop === "dark"}
          onPress={() => toggleBackdrop("dark")}
        >
          <MoonIcon className="size-3.5" />
        </FileSurfaceAction>
        <FileSurfaceAction
          label={gt("Light backdrop")}
          pressed={backdrop === "light"}
          onPress={() => toggleBackdrop("light")}
        >
          <SunIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      <iframe title={props.name} srcDoc={srcDoc} sandbox="" className="min-h-0 flex-1 border-0" />
    </div>
  );
}

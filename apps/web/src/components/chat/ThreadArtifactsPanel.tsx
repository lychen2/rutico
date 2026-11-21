import type { AssetResource, EnvironmentId, ThreadArtifact, ThreadId } from "@t3tools/contracts";
import { useGT, useLocale } from "gt-react";
import { FileTextIcon, FilmIcon, GlobeIcon, ImageIcon, PaperclipIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { formatBytes } from "~/lib/formatBytes";
import { threadArtifactsQuery } from "~/state/assets";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";

const groupIcons = {
  image: ImageIcon,
  video: FilmIcon,
  page: GlobeIcon,
  document: FileTextIcon,
};
const groupOrder = ["image", "video", "page", "document"] as const;

export function ThreadArtifactsPanel({
  environmentId,
  threadId,
  onAttachFiles,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onAttachFiles: (files: File[]) => void;
}) {
  const gt = useGT();
  const { canReadFiles, isPending } = useFilesystemReadAccess(environmentId);
  const query = useEnvironmentQuery(
    canReadFiles ? threadArtifactsQuery({ environmentId, input: { threadId } }) : null,
  );
  const artifacts = query.data?.artifacts;

  if (isPending || (query.isPending && artifacts === undefined)) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
        {gt("Loading artifacts…")}
      </p>
    );
  }
  if (!canReadFiles) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        {gt("This connection cannot read host files.")}
      </p>
    );
  }
  if (query.error !== null && artifacts === undefined) {
    return (
      <div className="space-y-2 px-3 py-4">
        <p className="text-sm text-muted-foreground" role="alert">
          {gt("Could not load thread artifacts.")}
        </p>
        <Button variant="outline" size="sm" onClick={query.refresh}>
          {gt("Retry")}
        </Button>
      </div>
    );
  }
  if (!artifacts?.length) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        {gt("No artifacts in this thread yet.")}
      </p>
    );
  }

  const grouped: Record<ThreadArtifact["kind"], ThreadArtifact[]> = {
    image: [],
    video: [],
    page: [],
    document: [],
  };
  for (const artifact of artifacts) grouped[artifact.kind].push(artifact);
  const featured = grouped.image[0];
  const groupLabels = {
    image: gt("Images"),
    video: gt("Videos"),
    page: gt("Pages"),
    document: gt("Documents"),
  };

  return (
    <section className="min-w-0 space-y-3 px-3 pt-3 pb-2" aria-label={gt("Artifacts")}>
      {featured ? (
        <FeaturedThreadArtifact
          artifact={featured}
          environmentId={environmentId}
          onAttachFiles={onAttachFiles}
        />
      ) : null}
      <ScrollArea scrollFade className="max-h-64 min-h-0" aria-label={gt("Thread artifacts")}>
        <div className="space-y-3 pe-1">
          {groupOrder.map((kind) => {
            const items = grouped[kind];
            if (!items.length) return null;
            const Icon = groupIcons[kind];
            return (
              <div key={kind}>
                <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  {groupLabels[kind]}
                </h3>
                <ul className="space-y-0.5">
                  {items.map((artifact) => (
                    <li
                      key={JSON.stringify(artifact.resource)}
                      className="flex min-w-0 items-center gap-2 rounded-md py-0.5 ps-1 hover:bg-muted/50"
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span title={artifact.name} className="min-w-0 flex-1 truncate text-xs">
                        {artifact.name}
                      </span>
                      <AttachArtifactButton
                        environmentId={environmentId}
                        artifact={artifact}
                        onAttachFiles={onAttachFiles}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}

function FeaturedThreadArtifact({
  artifact,
  environmentId,
  onAttachFiles,
}: {
  artifact: ThreadArtifact;
  environmentId: EnvironmentId;
  onAttachFiles: (files: File[]) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const previewResource: AssetResource =
    artifact.resource._tag === "attachment"
      ? { ...artifact.resource, disposition: "inline" }
      : artifact.resource;
  const preview = useAssetUrlState(
    environmentId,
    previewResource,
    `${artifact.modifiedAt}:${artifact.sizeBytes}`,
  );
  const previewLabel = gt("Preview {name}", { name: artifact.name });
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(artifact.modifiedAt);

  return (
    <article
      className="overflow-hidden rounded-xl border border-border/70 bg-card"
      aria-label={gt("Latest image")}
    >
      <div className="grid aspect-16/10 place-items-center overflow-hidden bg-muted/50">
        {preview._tag === "Success" ? (
          <a
            className="block size-full min-h-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            href={preview.url}
            target="_blank"
            rel="noreferrer"
            aria-label={previewLabel}
          >
            <img
              src={preview.url}
              alt={artifact.name}
              decoding="async"
              className="size-full object-cover"
            />
          </a>
        ) : (
          <span
            role="status"
            aria-label={preview._tag === "Loading" ? gt("Loading image") : gt("Preview unavailable")}
          >
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium" title={artifact.name}>
            {artifact.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatBytes(artifact.sizeBytes)} · {date}
          </p>
        </div>
        <AttachArtifactButton
          environmentId={environmentId}
          artifact={artifact}
          onAttachFiles={onAttachFiles}
          featured
        />
      </div>
    </article>
  );
}

function AttachArtifactButton({
  environmentId,
  artifact,
  onAttachFiles,
  featured = false,
}: {
  environmentId: EnvironmentId;
  artifact: ThreadArtifact;
  onAttachFiles: (files: File[]) => void;
  featured?: boolean;
}) {
  const gt = useGT();
  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const resource: AssetResource =
    artifact.resource._tag === "attachment" || artifact.resource._tag === "media-file"
      ? { ...artifact.resource, disposition: "attachment" }
      : artifact.resource;
  const refreshUrl = useAssetUrlRefresh(environmentId, resource);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- never append a download after its thread or panel has unmounted
  useLayoutEffect(() => () => controllerRef.current?.abort(), []);

  const attachLabel = gt("Attach {name} to draft", { name: artifact.name });
  async function attach() {
    if (controllerRef.current !== null) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    try {
      const url = await refreshUrl();
      if (controller.signal.aborted) return;
      if (url === null) throw new Error("Missing artifact URL");
      const response = await fetch(url, { credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error(`Artifact download failed: ${response.status}`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      onAttachFiles([
        new File([blob], artifact.name, {
          type: artifact.mimeType,
          lastModified: artifact.modifiedAt,
        }),
      ]);
      setStatus("idle");
    } catch {
      if (!controller.signal.aborted) {
        setStatus("error");
      }
    } finally {
      controllerRef.current = null;
    }
  }

  return (
    <div className="shrink-0">
      <Button
        type="button"
        size={featured ? "xs" : "icon-xs"}
        variant={featured ? "outline" : "ghost-muted"}
        aria-label={attachLabel}
        title={status === "error" ? gt("Could not attach this artifact.") : attachLabel}
        aria-busy={status === "loading"}
        disabled={status === "loading"}
        onClick={() => void attach()}
      >
        <PaperclipIcon aria-hidden />
        {featured ? gt("Attach") : null}
      </Button>
      {status === "error" ? (
        <span role="alert" className="sr-only">{gt("Could not attach this artifact.")}</span>
      ) : null}
    </div>
  );
}

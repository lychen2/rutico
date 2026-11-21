import { AuthOrchestrationOperateScope, WS_METHODS } from "@t3tools/contracts";
import type { AssetResource, EnvironmentId, ThreadArtifact, ThreadId } from "@t3tools/contracts";
import { useGT, useLocale } from "gt-react";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import {
  FileTextIcon,
  FilmIcon,
  FolderOpenIcon,
  GlobeIcon,
  ImageIcon,
  PaperclipIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { formatBytes } from "~/lib/formatBytes";
import { threadArtifactsQuery } from "~/state/assets";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery, useEnvironmentQuerySelector } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const groupIcons = {
  image: ImageIcon,
  video: FilmIcon,
  page: GlobeIcon,
  document: FileTextIcon,
};
const groupOrder = ["image", "video", "page", "document"] as const;
type ArtifactFilter = "all" | ThreadArtifact["kind"];

function isUnsupportedArtifactQuery(result: AsyncResult.AsyncResult<unknown, unknown>) {
  if (result._tag !== "Failure") return false;
  const defect = Cause.findDefect(result.cause);
  if (defect._tag !== "Success") return false;
  const message = defect.success instanceof Error ? defect.success.message : defect.success;
  return message === `Unknown request tag: ${WS_METHODS.assetsListThreadArtifacts}`;
}

function useThreadArtifacts(environmentId: EnvironmentId, threadId: ThreadId) {
  const { canReadFiles, isPending } = useFilesystemReadAccess(environmentId);
  const atom = canReadFiles ? threadArtifactsQuery({ environmentId, input: { threadId } }) : null;
  const query = useEnvironmentQuery(atom);
  const isUnsupported = useEnvironmentQuerySelector(atom, isUnsupportedArtifactQuery);
  return { ...query, canReadFiles, isUnsupported, isPending: isPending || query.isPending };
}

export function ThreadArtifactCount({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const query = useThreadArtifacts(environmentId, threadId);
  return query.isSuccess && query.data ? (
    <span className="ms-1 tabular-nums">{query.data.artifacts.length}</span>
  ) : null;
}

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
  const query = useThreadArtifacts(environmentId, threadId);
  const artifacts = query.data?.artifacts;

  if (!query.canReadFiles && !query.isPending) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        {gt("This connection cannot read host files.")}
      </p>
    );
  }
  if (query.isUnsupported && artifacts === undefined) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground" role="alert">
        {gt("This server does not support thread artifacts. Update the environment and reconnect.")}
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
  if (artifacts === undefined) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
        {gt("Loading artifacts…")}
      </p>
    );
  }
  if (artifacts.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        {gt("No artifacts in this thread yet.")}
      </p>
    );
  }

  return (
    <ThreadArtifactCollection
      key={`${environmentId}:${threadId}`}
      environmentId={environmentId}
      artifacts={artifacts}
      onAttachFiles={onAttachFiles}
    />
  );
}

function ThreadArtifactCollection({
  artifacts,
  environmentId,
  onAttachFiles,
}: {
  artifacts: readonly ThreadArtifact[];
  environmentId: EnvironmentId;
  onAttachFiles: (files: File[]) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const counts = { all: artifacts.length, image: 0, video: 0, page: 0, document: 0 };
  const rows = artifacts.map((artifact) => {
    counts[artifact.kind]++;
    return { artifact, key: JSON.stringify(artifact.resource) };
  });
  const filtered =
    filter === "all" ? rows : rows.filter(({ artifact }) => artifact.kind === filter);
  const selected =
    filtered.find(({ key }) => key === selectedKey) ??
    filtered.find(({ artifact }) => artifact.kind === "image") ??
    filtered[0];
  const labels = {
    all: gt("All"),
    image: gt("Images"),
    video: gt("Videos"),
    page: gt("Pages"),
    document: gt("Documents"),
  };
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });

  return (
    <section className="min-w-0 space-y-3 px-3 pt-3 pb-2" aria-label={gt("Artifacts")}>
      <Select
        value={filter}
        onValueChange={(value) => {
          if (value !== null) {
            setFilter(value);
            setSelectedKey(null);
          }
        }}
      >
        <SelectTrigger size="compact" variant="ghost" aria-label={gt("Artifact type")}>
          <SelectValue>{`${labels[filter]} · ${counts[filter]}`}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false} matchTriggerWidth={false}>
          {(["all", ...groupOrder] as const).map((kind) => (
            <SelectItem key={kind} value={kind}>
              {`${labels[kind]} · ${counts[kind]}`}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {selected ? (
        <>
          <SelectedThreadArtifact
            key={selected.key}
            artifact={selected.artifact}
            environmentId={environmentId}
            onAttachFiles={onAttachFiles}
          />
          <ScrollArea scrollFade className="max-h-64 min-h-0" aria-label={gt("Thread artifacts")}>
            <ul className="space-y-0.5 pe-1">
              {filtered.map(({ artifact, key }) => {
                const Icon = groupIcons[artifact.kind];
                return (
                  <li key={key}>
                    <button
                      type="button"
                      aria-pressed={selected.key === key}
                      className={cn(
                        "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-xs hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selected.key === key && "bg-muted font-medium",
                      )}
                      onClick={() => setSelectedKey(key)}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
                      <time
                        dateTime={new Date(artifact.modifiedAt).toISOString()}
                        className="shrink-0 tabular-nums text-muted-foreground"
                      >
                        {time.format(artifact.modifiedAt)}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">{gt("No artifacts of this type.")}</p>
      )}
    </section>
  );
}

function SelectedThreadArtifact({
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
  const canReveal = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const reveal = useAtomCommand(shellEnvironment.openInEditor, "reveal artifact");
  const resource = artifact.resource;
  const fileResource = resource._tag === "media-file" ? resource : null;
  const attachment =
    resource._tag === "attachment" ? { ...resource, disposition: "inline" as const } : null;
  const media = artifact.kind === "image" || artifact.kind === "video";
  const preview = useAssetUrlState(
    environmentId,
    media ? (attachment ?? fileResource) : null,
    `${artifact.modifiedAt}:${artifact.sizeBytes}`,
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const fileAsset = attachment
    ? { environmentId, attachmentId: attachment.attachmentId }
    : fileResource
      ? { environmentId, resource: fileResource }
      : undefined;
  const Icon = groupIcons[artifact.kind];
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
      aria-label={previewLabel}
    >
      {media ? (
        <div className="grid aspect-16/10 place-items-center overflow-hidden bg-muted/50">
          {preview._tag === "Success" && failedUrl !== preview.url ? (
            artifact.kind === "image" ? (
              <a
                className="block size-full min-h-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                href={preview.url}
                target="_blank"
                rel="noreferrer"
                aria-label={gt("Open image")}
              >
                <img
                  src={preview.url}
                  alt={artifact.name}
                  decoding="async"
                  className="size-full object-contain"
                  onError={() => setFailedUrl(preview.url)}
                />
              </a>
            ) : (
              <video
                controls
                playsInline
                preload="metadata"
                src={preview.url}
                aria-label={artifact.name}
                className="size-full"
                onError={() => setFailedUrl(preview.url)}
              />
            )
          ) : (
            <span
              role="status"
              aria-label={
                preview._tag === "Loading" ? gt("Loading file preview…") : gt("Preview unavailable")
              }
            >
              <Icon className="size-5 text-muted-foreground" aria-hidden />
            </span>
          )}
        </div>
      ) : fileAsset ? (
        <div className="flex aspect-16/10 min-h-0 overflow-hidden border-b border-border/70">
          <AttachmentFilePreview
            key={artifact.modifiedAt}
            name={artifact.name}
            mimeType={artifact.mimeType}
            sizeBytes={artifact.sizeBytes}
            asset={fileAsset}
          />
        </div>
      ) : null}
      <div className="space-y-2 p-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{artifact.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatBytes(artifact.sizeBytes)} · {date}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AttachArtifactButton
            environmentId={environmentId}
            artifact={artifact}
            onAttachFiles={onAttachFiles}
          />
          {canReveal && fileResource ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() =>
                void reveal({
                  environmentId,
                  input: { cwd: fileResource.path, editor: "file-manager", reveal: true },
                })
              }
            >
              <FolderOpenIcon aria-hidden />
              {gt("Open file location")}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function AttachArtifactButton({
  environmentId,
  artifact,
  onAttachFiles,
}: {
  environmentId: EnvironmentId;
  artifact: ThreadArtifact;
  onAttachFiles: (files: File[]) => void;
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
        size="xs"
        variant="default"
        aria-label={attachLabel}
        title={status === "error" ? gt("Could not attach this artifact.") : attachLabel}
        aria-busy={status === "loading"}
        disabled={status === "loading"}
        onClick={() => void attach()}
      >
        <PaperclipIcon aria-hidden />
        {gt("Attach")}
      </Button>
      {status === "error" ? (
        <span role="alert" className="sr-only">
          {gt("Could not attach this artifact.")}
        </span>
      ) : null}
    </div>
  );
}

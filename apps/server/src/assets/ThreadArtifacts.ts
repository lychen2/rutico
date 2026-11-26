import {
  AssetResource,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2TurnItemJson,
  ThreadArtifactsListError,
  type ThreadArtifact,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isNetworkPath, isWindowsDrivePath, workspaceRelativeFilePath } from "@t3tools/shared/path";
import { htmlRenderFromToolItem, previewRecordingIdFromToolItem } from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { makeIsServerInternalPath } from "../auth/serverInternalPaths.ts";
import * as ServerConfig from "../config.ts";

const MIME_TYPES: Readonly<Record<string, string | undefined>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".html": "text/html",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
};
const extensions = `\\.(?:${Object.keys(MIME_TYPES)
  .map((key) => key.slice(1))
  .join("|")})`;
const referencePattern = new RegExp(
  String.raw`\]\(<?([^\n<>]*?${extensions})(?::\d+)?>?\)|[\x60"']([^\n\x60"']*?${extensions})[\x60"']|(?:^|[\s=(：，。；！？、（）【】《》「」『』“”‘’])((?:[a-z]:[/\\])?[^\s<>\x60"'()[\]{}:,;：，。；！？、（）【】《》「」『』“”‘’]+${extensions})(?=$|[\s)\],;:.：，。；！？、（）【】《》」』“”‘’])`,
  "gimu",
);
const commandDirectoryPattern =
  /(?:^|&&|\|\||[;\n])\s*cd\s+(?:--\s+)?(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;&|]+))/g;
const excludedPath =
  /(?:^|[/\\])(?:\.git|\.cache|node_modules|caches?|browser-artifacts)(?:[/\\]|$)/iu;
const excludedToolFields = { data: true, base64: true, diffStr: true, oldStr: true, newStr: true };
const isAssetResource = Schema.is(AssetResource);
const decodeMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ConversationMessageJson),
);
const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2TurnItemJson));
const REFERENCE_MTIME_GRACE_MS = 5 * 60_000;
const MAX_COMMAND_DIRECTORIES = 50;

function pathReferences(value: unknown, visit: (path: string) => void, depth = 0) {
  if (depth > 12) return;
  if (typeof value === "string") {
    if (/^\s*[[{]/.test(value)) {
      try {
        const parsed: unknown = JSON.parse(value);
        pathReferences(parsed, visit, depth + 1);
        return;
      } catch {
        // Shell output and Markdown can also start with a bracket.
      }
    }
    for (const match of value.matchAll(referencePattern)) {
      const reference = match[1] ?? match[2] ?? match[3];
      if (reference !== undefined) visit(reference);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) pathReferences(entry, visit, depth + 1);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.hasOwn(excludedToolFields, key)) pathReferences(entry, visit, depth + 1);
    }
  }
}

function decodePath(reference: string, homeDir: string) {
  let value = reference.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // A literal percent is valid in a local filename.
  }
  if (value.startsWith("~/")) value = homeDir + value.slice(1);
  if (value.includes("\0") || (/^[a-z][a-z\d+.-]*:/i.test(value) && !isWindowsDrivePath(value))) {
    return null;
  }
  return value;
}

function kindForMimeType(mimeType: string): ThreadArtifact["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return mimeType === "text/html" ? "page" : "document";
}

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;

export class ThreadArtifacts extends Context.Service<
  ThreadArtifacts,
  {
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<{ readonly artifacts: readonly ThreadArtifact[] }, ThreadArtifactsListError>;
  }
>()("t3/assets/ThreadArtifacts") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const homeDir = yield* HostProcess.HomeDirectory;
  const isServerInternalPath = yield* makeIsServerInternalPath;

  const list = Effect.fn("ThreadArtifacts.list")(
    function* (threadId: ThreadId) {
      const [thread, rows] = yield* sql.withTransaction(
        Effect.gen(function* () {
          const threads = yield* sql<{ cwd: string; created_at: string }>`
            SELECT COALESCE(json_extract(thread.payload_json, '$.worktreePath'), project.workspace_root) AS cwd,
                   thread.created_at
            FROM orchestration_v2_projection_threads AS thread
            JOIN projection_projects AS project ON project.project_id = thread.project_id
            WHERE thread.thread_id = ${threadId} AND thread.deleted_at IS NULL AND project.deleted_at IS NULL
          `;
          const current = threads[0];
          if (!current) return [null, []] as const;
          const payloads = yield* sql<{ payload_json: string; source: "message" | "item" }>`
            SELECT message.payload_json, 'message' AS source
            FROM orchestration_v2_projection_messages AS message
            LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = message.run_id
            WHERE message.thread_id = ${threadId} AND message.role IN ('user', 'assistant')
              AND run.status IS NOT 'rolled_back'
            UNION ALL
            SELECT item.payload_json, 'item' AS source
            FROM orchestration_v2_projection_turn_items AS item
            LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = item.run_id
            WHERE item.thread_id = ${threadId}
              AND item.type IN ('file_change', 'command_execution', 'dynamic_tool')
              AND run.status IS NOT 'rolled_back'
          `;
          return [current, payloads] as const;
        }),
      );
      if (thread === null) return { artifacts: [] };

      const references = new Map<
        string,
        {
          fresh: boolean;
          readonly preferredCwds: Set<string>;
          hasRootReference: boolean;
        }
      >();
      const attachments = new Map<string, AttachmentResource>();
      const commandDirectories = new Set<string>();
      const addReference = (value: string, needsFreshFile: boolean, commandCwd?: string) => {
        const reference = decodePath(value, homeDir);
        if (!reference || MIME_TYPES[path.extname(reference).toLowerCase()] === undefined) return;
        const existing = references.get(reference);
        if (existing) {
          existing.fresh = existing.fresh && needsFreshFile;
          if (commandCwd !== undefined && commandCwd !== thread.cwd) {
            existing.preferredCwds.add(commandCwd);
          } else {
            existing.hasRootReference = true;
          }
          return;
        }
        const preferredCwds = new Set<string>();
        const isSubdirCommand = commandCwd !== undefined && commandCwd !== thread.cwd;
        if (isSubdirCommand) preferredCwds.add(commandCwd);
        references.set(reference, {
          fresh: needsFreshFile,
          preferredCwds,
          hasRootReference: !isSubdirCommand,
        });
      };
      const addAttachment = (attachmentId: string, fileName: string, mimeType: string) => {
        const resource = { _tag: "attachment", attachmentId, fileName, mimeType } as const;
        if (isAssetResource(resource)) attachments.set(attachmentId, resource);
      };

      for (const row of rows) {
        if (row.source === "message") {
          const message = yield* decodeMessage(row.payload_json);
          for (const attachment of message.attachments ?? []) {
            if (attachment.type === "image" || attachment.type === "file") {
              addAttachment(attachment.id, attachment.name, attachment.mimeType);
            }
          }
          pathReferences(message.text, (reference) => addReference(reference, true));
          continue;
        }
        const item = yield* decodeItem(row.payload_json);
        if (item.type === "file_change") {
          addReference(item.fileName, false);
          for (const change of item.changes ?? []) addReference(change.path, false);
        } else if (item.type === "dynamic_tool") {
          const html = htmlRenderFromToolItem(item);
          if (html) addAttachment(html.attachmentId, `${html.title}.html`, "text/html");
          const recording = previewRecordingIdFromToolItem(item);
          if (recording) addAttachment(recording, "preview-recording.webm", "video/webm");
          pathReferences(item.input, (reference) => addReference(reference, true));
          pathReferences(item.output, (reference) => addReference(reference, true));
        } else if (item.type === "command_execution") {
          let cwd = thread.cwd;
          for (const match of item.input.matchAll(commandDirectoryPattern)) {
            const operand = match[1] ?? match[2] ?? match[3];
            if (!operand || /[$`]/.test(operand)) continue;
            const directory = decodePath(operand, homeDir);
            if (!directory || commandDirectories.size >= MAX_COMMAND_DIRECTORIES) continue;
            cwd = path.resolve(cwd, directory);
            if (cwd !== thread.cwd) commandDirectories.add(cwd);
          }
          pathReferences(item.input, (reference) => addReference(reference, true, cwd));
          pathReferences(item.output, (reference) => addReference(reference, true, cwd));
        }
      }

      const cutoff = Date.parse(thread.created_at) - REFERENCE_MTIME_GRACE_MS;
      // Runs inside the bounded filesystem traversal below, under the list operation's span.
      const statFile = Effect.fnUntraced(function* (filePath: string) {
        const stat = yield* fileSystem.stat(filePath).pipe(Effect.option);
        if (Option.isNone(stat) || stat.value.type !== "File") return null;
        const sizeBytes = Number(stat.value.size);
        if (!Number.isSafeInteger(sizeBytes)) return null;
        const modifiedAt = Option.getOrNull(stat.value.mtime)?.getTime();
        return modifiedAt === undefined ? null : { sizeBytes, modifiedAt };
      });
      const canonicalCwd = yield* fileSystem
        .realPath(thread.cwd)
        .pipe(Effect.orElseSucceed(() => thread.cwd));
      // Each inferred path is handled inside the list operation's span.
      const probeReference = Effect.fnUntraced(function* (requestedPath: string, fresh: boolean) {
        const relative = workspaceRelativeFilePath(requestedPath, thread.cwd);
        if (
          excludedPath.test(relative ?? requestedPath) ||
          (isNetworkPath(requestedPath) && relative === null)
        ) {
          return null;
        }
        const resolved = yield* fileSystem.realPath(requestedPath).pipe(Effect.option);
        if (Option.isNone(resolved)) return null;
        const canonical = resolved.value;
        const canonicalRelative = workspaceRelativeFilePath(canonical, canonicalCwd);
        if (
          excludedPath.test(canonicalRelative ?? canonical) ||
          (isNetworkPath(canonical) && canonicalRelative === null)
        ) {
          return null;
        }
        const mimeType = MIME_TYPES[path.extname(canonical).toLowerCase()];
        if (!mimeType) return null;
        const resource = { _tag: "media-file", threadId, path: canonical, hostOnly: true } as const;
        if (!isAssetResource(resource)) return null;
        const stat = yield* statFile(canonical);
        if (
          !stat ||
          (fresh && !(stat.modifiedAt >= cutoff)) ||
          (yield* isServerInternalPath(canonical))
        ) {
          return null;
        }
        return {
          name: path.basename(canonical),
          kind: kindForMimeType(mimeType),
          resource,
          mimeType,
          ...stat,
        };
      });
      const files = yield* Effect.forEach(
        references,
        ([reference, entry]) =>
          Effect.gen(function* () {
            const { fresh, preferredCwds, hasRootReference } = entry;
            if (isWindowsDrivePath(reference) && !path.isAbsolute(reference)) return null;
            if (
              isNetworkPath(reference) &&
              workspaceRelativeFilePath(reference, thread.cwd) === null
            ) {
              return null;
            }
            if (path.isAbsolute(reference)) {
              return yield* probeReference(reference, fresh);
            }
            // Prefer the directory of the command that referenced this relative path over an
            // unrelated same-named file at the worktree root.
            if (preferredCwds.size > 0) {
              let preferredMatch: NonNullable<
                Effect.Success<ReturnType<typeof probeReference>>
              > | null = null;
              let ambiguous = false;
              for (const directory of preferredCwds) {
                const result = yield* probeReference(path.resolve(directory, reference), fresh);
                if (!result) continue;
                if (preferredMatch && preferredMatch.resource.path !== result.resource.path) {
                  ambiguous = true;
                  break;
                }
                preferredMatch = result;
              }
              if (ambiguous) return null;
              if (preferredMatch && !hasRootReference) return preferredMatch;
              if (preferredMatch) {
                const inWorkspace = yield* probeReference(
                  path.resolve(thread.cwd, reference),
                  fresh,
                );
                if (!inWorkspace || inWorkspace.resource.path === preferredMatch.resource.path) {
                  return preferredMatch;
                }
                return preferredMatch;
              }
            }
            const inWorkspace = yield* probeReference(path.resolve(thread.cwd, reference), fresh);
            if (inWorkspace) return inWorkspace;
            let match: NonNullable<Effect.Success<ReturnType<typeof probeReference>>> | null = null;
            for (const directory of commandDirectories) {
              const result = yield* probeReference(path.resolve(directory, reference), fresh);
              if (!result) continue;
              if (match && match.resource.path !== result.resource.path) return null;
              match = result;
            }
            return match;
          }),
        { concurrency: 8 },
      );
      const savedAttachments = yield* Effect.forEach(
        attachments.values(),
        (resource) =>
          Effect.gen(function* () {
            const filePath = resolveAttachmentPathById({
              attachmentsDir,
              attachmentId: resource.attachmentId,
            });
            if (filePath === null) return null;
            const stat = yield* statFile(filePath);
            if (!stat) return null;
            const mimeType = resource.mimeType ?? "application/octet-stream";
            return {
              name: resource.fileName ?? path.basename(filePath),
              kind: kindForMimeType(mimeType),
              resource,
              mimeType,
              ...stat,
            };
          }),
        { concurrency: 8 },
      );
      const artifacts = new Map<string, ThreadArtifact>();
      for (const file of files) {
        if (file) artifacts.set(file.resource.path, file);
      }
      for (const attachment of savedAttachments) {
        if (attachment) artifacts.set(attachment.resource.attachmentId, attachment);
      }
      return {
        artifacts: Array.from(artifacts.values()).sort(
          (a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name),
        ),
      };
    },
    (effect, threadId) =>
      effect.pipe(Effect.mapError((cause) => new ThreadArtifactsListError({ threadId, cause }))),
  );
  return ThreadArtifacts.of({ list });
});

export const layer = Layer.effect(ThreadArtifacts, make);

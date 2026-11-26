import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { createAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { layer, ThreadArtifacts } from "./ThreadArtifacts.ts";

const testLayer = layer.pipe(
  Layer.provideMerge(
    Layer.merge(
      Sqlite.layerMemory,
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-artifacts-" }),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("lists only existing artifacts recorded by this thread in its worktree", () =>
  Effect.gen(function* () {
    const artifacts = yield* ThreadArtifacts;
    const sql = yield* SqlClient.SqlClient;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-artifact-project-" });
    const root = yield* fs.realPath(projectRoot);
    const worktree = path.join(root, ".worktrees", "topic");
    const output = path.join(worktree, "reports");
    yield* fs.makeDirectory(output, { recursive: true });
    yield* fs.makeDirectory(attachmentsDir, { recursive: true });
    yield* fs.writeFileString(path.join(root, "report.pdf"), "not the thread's report");
    yield* fs.writeFileString(path.join(worktree, "report.pdf"), "thread report");
    yield* fs.writeFileString(path.join(output, "plot.png"), "thread plot");
    yield* fs.writeFileString(path.join(worktree, "unmentioned.md"), "unrelated file");
    yield* fs.writeFileString(path.join(worktree, "rolled-back.pdf"), "previous run output");
    const threadId = ThreadId.make("artifact-thread");
    const pageId = createAttachmentId(threadId, "html");
    if (pageId === null) throw new Error("Could not assign the HTML fixture an attachment ID");
    yield* fs.writeFileString(path.join(attachmentsDir, `${pageId}.html`), "<p>Tool page</p>");
    yield* fs.writeFileString(path.join(attachmentsDir, "saved-image.png"), "attachment bytes");
    const timestamp = "2026-01-01T00:00:00.000Z";
    const older = DateTime.toDateUtc(DateTime.makeUnsafe(timestamp));
    const newer = DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"));
    yield* fs.utimes(path.join(attachmentsDir, "saved-image.png"), older, older);
    yield* fs.utimes(path.join(output, "plot.png"), newer, newer);
    const other = ThreadId.make("artifact-other-thread");
    yield* sql`
      INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('artifact-project', 'Artifacts', ${root}, '[]', ${timestamp}, ${timestamp})
    `;
    for (const id of [threadId, other]) {
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads
          (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
        VALUES (${id}, 'artifact-project', 'Artifacts', 'codex', 'full-access', 'default',
          ${timestamp}, ${timestamp}, ${JSON.stringify({ worktreePath: worktree })})
      `;
    }
    const message = {
      id: "artifact-message",
      threadId,
      runId: null,
      nodeId: null,
      role: "assistant",
      createdBy: "agent",
      creationSource: "provider",
      text: "The [report](report.pdf) and [missing](missing.md) are attached.",
      attachments: [
        {
          type: "image",
          id: "saved-image",
          name: "supplied.png",
          mimeType: "image/png",
          sizeBytes: 16,
        },
      ],
      streaming: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    yield* sql`
      INSERT INTO orchestration_v2_projection_messages
        (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (${message.id}, ${threadId}, 'assistant', 0, ${timestamp}, ${timestamp}, ${JSON.stringify(message)})
    `;
    yield* sql`
      INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES ('rolled-back', ${threadId}, 1, 'codex', 'rolled_back', ${timestamp}, '{}')
    `;
    const item = {
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      status: "completed",
      title: null,
      startedAt: null,
      completedAt: timestamp,
      updatedAt: timestamp,
    };
    const items = [
      {
        ...item,
        id: "command",
        ordinal: 1,
        type: "command_execution",
        input: "cd reports && render plot.png",
        output: "Wrote plot.png",
      },
      { ...item, id: "change", ordinal: 2, type: "file_change", fileName: "./report.pdf" },
      {
        ...item,
        id: "rolled-back-change",
        runId: "rolled-back",
        ordinal: 3,
        type: "file_change",
        fileName: "rolled-back.pdf",
      },
      {
        ...item,
        id: "generated-page",
        ordinal: 4,
        type: "dynamic_tool",
        toolName: "mcp__t3-code__html_render",
        input: {},
        output: [
          {
            type: "text",
            text: JSON.stringify({
              htmlRender: { attachmentId: pageId, title: "Tool page", height: 300 },
            }),
          },
        ],
      },
    ];
    for (const event of items) {
      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items
          (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
        VALUES (${event.id}, ${threadId}, ${event.runId}, ${event.ordinal}, ${event.type},
          'completed', ${timestamp}, ${JSON.stringify(event)})
      `;
    }

    const actual = (yield* artifacts.list(threadId)).artifacts;
    expect(actual.map((artifact) => artifact.name).sort()).toEqual([
      "Tool page.html",
      "plot.png",
      "report.pdf",
      "supplied.png",
    ]);
    expect(actual.find((artifact) => artifact.kind === "image")?.name).toBe("plot.png");
    expect(actual.find((artifact) => artifact.name === "report.pdf")).toMatchObject({
      kind: "document",
      sizeBytes: 13,
      resource: {
        _tag: "media-file",
        threadId,
        path: path.join(worktree, "report.pdf"),
        hostOnly: true,
      },
    });
    expect(actual.find((artifact) => artifact.name === "plot.png")).toMatchObject({
      kind: "image",
      modifiedAt: newer.getTime(),
      resource: {
        _tag: "media-file",
        threadId,
        path: path.join(output, "plot.png"),
        hostOnly: true,
      },
    });
    expect(actual.find((artifact) => artifact.name === "supplied.png")).toMatchObject({
      kind: "image",
      resource: { _tag: "attachment", attachmentId: "saved-image" },
    });
    expect(actual.find((artifact) => artifact.kind === "page")).toMatchObject({
      name: "Tool page.html",
      resource: { _tag: "attachment", attachmentId: pageId },
    });
    expect(yield* artifacts.list(other)).toEqual({ artifacts: [] });
  }).pipe(Effect.provide(testLayer)),
);

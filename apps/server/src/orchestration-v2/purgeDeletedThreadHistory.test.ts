import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ContextTransferId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadViewers from "./ThreadViewers.ts";

const layerDatabase = SqlitePersistence.layerMemory;
const layerStores = Layer.mergeAll(
  layerDatabase,
  EventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ProjectStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  OrchestrationEventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ThreadViewers.layer,
);
const layerTest = Layer.mergeAll(
  layerStores,
  EventSink.layer.pipe(Layer.provideMerge(layerStores)),
  ProjectionMaintenance.layer.pipe(Layer.provideMerge(layerStores)),
);

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" };

function makeThread(
  threadId: ThreadId,
  title: string,
  now: DateTime.Utc,
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project:purge-test"),
    title,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeRun(
  threadId: ThreadId,
  runId: RunId,
  ordinal: number,
  userMessageId: MessageId,
  rootNodeId: NodeId,
  now: DateTime.Utc,
): OrchestrationV2Run {
  return {
    id: runId,
    threadId,
    ordinal,
    providerInstanceId,
    modelSelection,
    providerThreadId: null,
    userMessageId,
    rootNodeId,
    activeAttemptId: RunAttemptId.make(`${runId}:attempt:1`),
    status: "completed",
    queuePosition: null,
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function makeConversationEvents(input: {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly ordinal: number;
  readonly secretToken: string;
  readonly now: DateTime.Utc;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const userMessageId = MessageId.make(`${input.runId}:user-msg`);
  const assistantMessageId = MessageId.make(`${input.runId}:assistant-msg`);
  const rootNodeId = NodeId.make(`${input.runId}:node`);
  const run = makeRun(
    input.threadId,
    input.runId,
    input.ordinal,
    userMessageId,
    rootNodeId,
    input.now,
  );
  return [
    {
      id: EventId.make(`${input.runId}:created`),
      type: "run.created",
      threadId: input.threadId,
      runId: input.runId,
      nodeId: rootNodeId,
      providerInstanceId,
      occurredAt: input.now,
      payload: run,
    },
    {
      id: EventId.make(`${input.runId}:user-msg`),
      type: "message.updated",
      threadId: input.threadId,
      runId: input.runId,
      nodeId: rootNodeId,
      providerInstanceId,
      occurredAt: input.now,
      payload: {
        id: userMessageId,
        threadId: input.threadId,
        runId: input.runId,
        nodeId: rootNodeId,
        role: "user",
        text: `Sensitive prompt ${input.secretToken}`,
        attachments: [],
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: input.now,
        updatedAt: input.now,
      },
    },
    {
      id: EventId.make(`${input.runId}:assistant-msg`),
      type: "message.updated",
      threadId: input.threadId,
      runId: input.runId,
      nodeId: rootNodeId,
      providerInstanceId,
      occurredAt: input.now,
      payload: {
        id: assistantMessageId,
        threadId: input.threadId,
        runId: input.runId,
        nodeId: rootNodeId,
        role: "assistant",
        text: `Sensitive answer ${input.secretToken}`,
        attachments: [],
        streaming: false,
        createdBy: "agent",
        creationSource: "provider",
        createdAt: input.now,
        updatedAt: input.now,
      },
    },
    {
      id: EventId.make(`${input.runId}:tool-item`),
      type: "turn-item.updated",
      threadId: input.threadId,
      runId: input.runId,
      nodeId: rootNodeId,
      providerInstanceId,
      occurredAt: input.now,
      payload: {
        id: TurnItemId.make(`${input.runId}:tool`),
        threadId: input.threadId,
        runId: input.runId,
        nodeId: rootNodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: input.ordinal * 10,
        type: "command_execution",
        status: "completed",
        title: "Secret command",
        input: `echo ${input.secretToken}`,
        output: `Tool output ${input.secretToken}`,
        exitCode: 0,
        startedAt: input.now,
        completedAt: input.now,
        updatedAt: input.now,
      },
    },
    {
      id: EventId.make(`${input.runId}:plan`),
      type: "plan.updated",
      threadId: input.threadId,
      runId: input.runId,
      nodeId: rootNodeId,
      providerInstanceId,
      occurredAt: input.now,
      payload: {
        id: PlanId.make(`${input.runId}:plan`),
        threadId: input.threadId,
        runId: input.runId,
        nodeId: rootNodeId,
        kind: "proposed_plan",
        status: "completed",
        markdown: `Markdown ${input.secretToken}`,
      },
    },
  ];
}

it.effect("hard-deletes thread history, search index, and events when thread.deleted commits", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const sink = yield* EventSink.EventSinkV2;
    const sql = yield* SqlClient.SqlClient;
    const threadId = ThreadId.make("thread:purge-single");
    const secret = "TOP_SECRET_CREDENTIAL_987654";
    const thread = makeThread(threadId, `Confidential ${secret}`, now);
    const runId = RunId.make("run:purge-single:1");

    yield* sink.write({
      events: [
        {
          id: EventId.make("event:purge-single:created"),
          type: "thread.created",
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: thread,
        },
        ...makeConversationEvents({ threadId, runId, ordinal: 1, secretToken: secret, now }),
      ],
    });

    const beforeMessages = yield* sql`
      SELECT COUNT(*) AS count FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId}
    `;
    assert.equal((beforeMessages[0] as { count: number }).count, 2);

    yield* sink.write({
      commandId: CommandId.make("cmd:delete-single"),
      events: [
        {
          id: EventId.make("event:purge-single:deleted"),
          type: "thread.deleted",
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: { ...thread, deletedAt: now, updatedAt: now },
        },
      ],
    });

    const hits = yield* sql<{ readonly count: number }>`
      SELECT
        (SELECT COUNT(*) FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_turn_items WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_v2_turn_item_positions WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_runs WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_plans WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${threadId} AND payload_json LIKE ${`%${secret}%`}) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId} AND (title LIKE ${`%${secret}%`} OR payload_json LIKE ${`%${secret}%`}))
      AS count
    `;
    assert.equal(hits[0]?.count, 0);

    const searchMatches = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM orchestration_v2_message_search
      WHERE orchestration_v2_message_search MATCH ${`"${secret}"`}
    `;
    assert.equal(searchMatches[0]?.count, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "retains pre-fork runs for a live fork, purges post-fork runs, then purges everything when the fork is deleted",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const sink = yield* EventSink.EventSinkV2;
      const sql = yield* SqlClient.SqlClient;
      const sourceId = ThreadId.make("thread:purge-source");
      const forkId = ThreadId.make("thread:purge-fork");
      const run1Id = RunId.make("run:purge-source:1");
      const run2Id = RunId.make("run:purge-source:2");
      const sourceThread = makeThread(sourceId, "Source thread", now);
      const forkThread = makeThread(forkId, "Live fork", now, {
        forkedFrom: { type: "run", threadId: sourceId, runId: run1Id },
      });

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:source:created"),
            type: "thread.created",
            threadId: sourceId,
            providerInstanceId,
            occurredAt: now,
            payload: sourceThread,
          },
          ...makeConversationEvents({
            threadId: sourceId,
            runId: run1Id,
            ordinal: 1,
            secretToken: "KEEP_FORK_ANCESTOR_111",
            now,
          }),
          ...makeConversationEvents({
            threadId: sourceId,
            runId: run2Id,
            ordinal: 2,
            secretToken: "PURGE_POST_FORK_222",
            now,
          }),
          {
            id: EventId.make("event:fork:created"),
            type: "thread.created",
            threadId: forkId,
            providerInstanceId,
            occurredAt: now,
            payload: forkThread,
          },
          {
            id: EventId.make("event:fork:transfer"),
            type: "context-transfer.created",
            threadId: forkId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: ContextTransferId.make("transfer:source-to-fork"),
              type: "fork",
              sourceThreadId: sourceId,
              targetThreadId: forkId,
              sourcePoint: { type: "run", threadId: sourceId, runId: run1Id },
              basePoint: null,
              sourceProviderInstanceId: providerInstanceId,
              targetProviderInstanceId: providerInstanceId,
              targetRunId: null,
              status: "consumed",
              resolution: null,
              createdBy: "user",
              error: null,
              createdAt: now,
              updatedAt: now,
              consumedAt: now,
            },
          },
        ],
      });

      // Deleting source while live fork exists must purge run 2 immediately while preserving run 1.
      yield* sink.write({
        commandId: CommandId.make("cmd:delete-source"),
        events: [
          {
            id: EventId.make("event:source:deleted"),
            type: "thread.deleted",
            threadId: sourceId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...sourceThread, deletedAt: now, updatedAt: now },
          },
        ],
      });

      const postForkRemaining = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM orchestration_events
      WHERE stream_id = ${sourceId} AND payload_json LIKE '%PURGE_POST_FORK_222%'
    `;
      assert.equal(postForkRemaining[0]?.count, 0);

      const preForkRemaining = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM orchestration_v2_projection_messages
      WHERE thread_id = ${sourceId} AND run_id = ${run1Id}
    `;
      assert.equal(preForkRemaining[0]?.count, 2);

      // Deleting the last live fork must cascade-purge run 1 from the already-deleted source too.
      yield* sink.write({
        commandId: CommandId.make("cmd:delete-fork"),
        events: [
          {
            id: EventId.make("event:fork:deleted"),
            type: "thread.deleted",
            threadId: forkId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...forkThread, deletedAt: now, updatedAt: now },
          },
        ],
      });

      const allSourceLeftovers = yield* sql<{ readonly count: number }>`
      SELECT
        (SELECT COUNT(*) FROM orchestration_v2_projection_messages WHERE thread_id IN (${sourceId}, ${forkId})) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_turn_items WHERE thread_id IN (${sourceId}, ${forkId})) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_runs WHERE thread_id IN (${sourceId}, ${forkId})) +
        (SELECT COUNT(*) FROM orchestration_events WHERE stream_id IN (${sourceId}, ${forkId}) AND event_type <> 'thread.deleted')
      AS count
    `;
      assert.equal(allSourceLeftovers[0]?.count, 0);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("ProjectionMaintenance.pruneEventStore purges previously soft-deleted threads", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const sql = yield* SqlClient.SqlClient;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const eventStore = yield* EventStore.EventStoreV2;
    const threadId = ThreadId.make("thread:legacy-soft-deleted");
    const thread = makeThread(threadId, "Old soft-deleted title", now);
    const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
      {
        id: EventId.make("event:legacy:created"),
        type: "thread.created",
        threadId,
        providerInstanceId,
        occurredAt: now,
        payload: thread,
      },
      ...makeConversationEvents({
        threadId,
        runId: RunId.make("run:legacy:1"),
        ordinal: 1,
        secretToken: "LEGACY_SECRET_333",
        now,
      }),
      {
        id: EventId.make("event:legacy:deleted"),
        type: "thread.deleted",
        threadId,
        providerInstanceId,
        occurredAt: now,
        payload: { ...thread, deletedAt: now, updatedAt: now },
      },
    ];
    // Simulate historical state left behind by earlier soft-delete versions without calling EventSink.
    const stored = yield* eventStore.append({ events });
    for (const s of stored) {
      yield* projectionStore.apply(s.event);
    }

    const before = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId}
    `;
    assert.equal(before[0]?.count, 2);

    const summary = yield* maintenance.pruneEventStore();
    assert.isAbove(summary.deletedEventCount, 0);

    const after = yield* sql<{ readonly count: number }>`
      SELECT
        (SELECT COUNT(*) FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_turn_items WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${threadId} AND payload_json LIKE '%LEGACY_SECRET_333%')
      AS count
    `;
    assert.equal(after[0]?.count, 0);
  }).pipe(Effect.provide(layerTest)),
);

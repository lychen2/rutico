import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ContextTransferId,
  EventId,
  GuestMessageId,
  GuestShareId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
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
  EffectOutbox.layer.pipe(Layer.provideMerge(layerDatabase)),
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

    // Running maintenance a second time must skip already-clean tombstones without rewriting rows.
    const beforeChanges = yield* sql<{ readonly count: number }>`SELECT total_changes() AS count`;
    const yieldCount = yield* Ref.make(0);
    const secondSummary = yield* maintenance.pruneEventStore(
      Ref.update(yieldCount, (value) => value + 1),
    );
    const afterChanges = yield* sql<{ readonly count: number }>`SELECT total_changes() AS count`;
    assert.equal(secondSummary.deletedEventCount, 0);
    assert.isAbove(yield* Ref.get(yieldCount), 0);
    // No thread-table rewrite on an already-purged tombstone.
    assert.equal(afterChanges[0]?.count, beforeChanges[0]?.count);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "preserves a shared Codex provider session while another bound thread lives, then removes it on the last delete",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const sink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const threadA = ThreadId.make("thread:shared-codex-a");
      const threadB = ThreadId.make("thread:shared-codex-b");
      const sessionId = ProviderSessionId.make("session:shared-codex:1");
      const driver = ProviderDriverKind.make("codex");
      const session = {
        id: sessionId,
        driver,
        providerInstanceId,
        status: "running" as const,
        cwd: "/workspace/shared",
        model: "gpt-5.4",
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const payloadA = makeThread(threadA, "Thread A", now);
      const payloadB = makeThread(threadB, "Thread B", now);

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:shared-a:created"),
            type: "thread.created",
            threadId: threadA,
            providerInstanceId,
            occurredAt: now,
            payload: payloadA,
          },
          {
            id: EventId.make("event:shared-b:created"),
            type: "thread.created",
            threadId: threadB,
            providerInstanceId,
            occurredAt: now,
            payload: payloadB,
          },
          {
            id: EventId.make("event:shared-a:attached"),
            type: "provider-session.attached",
            threadId: threadA,
            driver,
            providerInstanceId,
            occurredAt: now,
            payload: session,
          },
          // B attaches second so provider_sessions.thread_id is overwritten with threadB.
          {
            id: EventId.make("event:shared-b:attached"),
            type: "provider-session.attached",
            threadId: threadB,
            driver,
            providerInstanceId,
            occurredAt: now,
            payload: session,
          },
        ],
      });

      assert.equal(
        (yield* projectionStore.getThreadRecords(threadA, ["providerSessions"])).providerSessions
          .length,
        1,
      );

      yield* sink.write({
        commandId: CommandId.make("cmd:delete-shared-b"),
        events: [
          {
            id: EventId.make("event:shared-b:detached"),
            type: "provider-session.detached",
            threadId: threadB,
            driver,
            providerInstanceId,
            occurredAt: now,
            payload: { providerSessionId: sessionId, detachedAt: now, reason: "Thread deleted." },
          },
          {
            id: EventId.make("event:shared-b:deleted"),
            type: "thread.deleted",
            threadId: threadB,
            providerInstanceId,
            occurredAt: now,
            payload: { ...payloadB, deletedAt: now, updatedAt: now },
          },
        ],
      });

      const afterDeleteB = yield* projectionStore.getThreadRecords(threadA, ["providerSessions"]);
      assert.equal(afterDeleteB.providerSessions.length, 1);
      assert.equal(afterDeleteB.providerSessions[0]?.id, sessionId);
      const ownerRow = yield* sql<{ readonly thread_id: string | null }>`
        SELECT thread_id FROM orchestration_v2_projection_provider_sessions
        WHERE provider_session_id = ${sessionId}
      `;
      assert.equal(ownerRow[0]?.thread_id, threadA);

      // Deleting the last remaining bound thread removes the main session row too.
      yield* sink.write({
        commandId: CommandId.make("cmd:delete-shared-a"),
        events: [
          {
            id: EventId.make("event:shared-a:detached"),
            type: "provider-session.detached",
            threadId: threadA,
            driver,
            providerInstanceId,
            occurredAt: now,
            payload: { providerSessionId: sessionId, detachedAt: now, reason: "Thread deleted." },
          },
          {
            id: EventId.make("event:shared-a:deleted"),
            type: "thread.deleted",
            threadId: threadA,
            providerInstanceId,
            occurredAt: now,
            payload: { ...payloadA, deletedAt: now, updatedAt: now },
          },
        ],
      });

      const remainingSessions = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_v2_projection_provider_sessions
        WHERE provider_session_id = ${sessionId}
      `;
      assert.equal(remainingSessions[0]?.count, 0);
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "redacts settled runtime-request.respond user feedback and answers from outbox while keeping cleanup effects",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const sink = yield* EventSink.EventSinkV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread:purge-outbox");
      const thread = makeThread(threadId, "Outbox secret thread", now);
      const sessionId = ProviderSessionId.make("session:purge-outbox");
      const succeededSecret = "OUTBOX_SUCCEEDED_ANSWER_777";
      const failedSecret = "OUTBOX_FAILED_FEEDBACK_888";

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:outbox:created"),
            type: "thread.created",
            threadId,
            providerInstanceId,
            occurredAt: now,
            payload: thread,
          },
        ],
      });

      yield* outbox.enqueue([
        {
          id: "effect:outbox:respond-ok",
          commandId: CommandId.make("cmd:respond-ok"),
          threadId,
          request: {
            type: "runtime-request.respond",
            providerSessionId: sessionId,
            requestId: RuntimeRequestId.make("req:ok"),
            feedback: `Ok feedback ${succeededSecret}`,
            answers: { q1: succeededSecret },
          },
        },
        {
          id: "effect:outbox:respond-fail",
          commandId: CommandId.make("cmd:respond-fail"),
          threadId,
          request: {
            type: "runtime-request.respond",
            providerSessionId: sessionId,
            requestId: RuntimeRequestId.make("req:fail"),
            feedback: `Failed feedback ${failedSecret}`,
            answers: { q2: failedSecret },
          },
        },
      ]);
      yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'succeeded', completed_at = ${DateTime.formatIso(now)}
        WHERE effect_id = 'effect:outbox:respond-ok'
      `;
      yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'failed', completed_at = ${DateTime.formatIso(now)}, last_error = 'boom'
        WHERE effect_id = 'effect:outbox:respond-fail'
      `;

      yield* sink.commitCommand({
        commandId: CommandId.make("cmd:delete-outbox-thread"),
        commandType: "thread.delete",
        threadId,
        acceptedAt: now,
        events: [
          {
            id: EventId.make("event:outbox:deleted"),
            type: "thread.deleted",
            threadId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...thread, deletedAt: now, updatedAt: now },
          },
        ],
        effects: [
          {
            id: "effect:delete-outbox:terminal",
            commandId: CommandId.make("cmd:delete-outbox-thread"),
            threadId,
            request: { type: "terminal.cleanup" },
          },
          {
            id: "effect:delete-outbox:attachment",
            commandId: CommandId.make("cmd:delete-outbox-thread"),
            threadId,
            request: { type: "attachment.cleanup", attachmentIds: ["att-1"] },
          },
        ],
      });

      const leaked = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_v2_effect_outbox
        WHERE thread_id = ${threadId}
          AND (payload_json LIKE ${`%${succeededSecret}%`} OR payload_json LIKE ${`%${failedSecret}%`})
      `;
      assert.equal(leaked[0]?.count, 0);

      // Failed row stays present with status='failed' for StorageCleanup's guard, and cleanup effects stay pending.
      const statuses = yield* sql<{ readonly effect_id: string; readonly status: string }>`
        SELECT effect_id, status
        FROM orchestration_v2_effect_outbox
        WHERE thread_id = ${threadId}
        ORDER BY effect_id ASC
      `;
      assert.deepEqual(
        statuses.map((row) => [row.effect_id, row.status]),
        [
          ["effect:delete-outbox:attachment", "pending"],
          ["effect:delete-outbox:terminal", "pending"],
          ["effect:outbox:respond-fail", "failed"],
          ["effect:outbox:respond-ok", "succeeded"],
        ],
      );
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "strips guestShare from a deleted source thread even when a live run fork retains its only run",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const isoNow = DateTime.formatIso(now);
      const sink = yield* EventSink.EventSinkV2;
      const sql = yield* SqlClient.SqlClient;
      const sourceId = ThreadId.make("thread:guest-source");
      const forkId = ThreadId.make("thread:guest-fork");
      const run1Id = RunId.make("run:guest-source:1");
      const guestSecret = "GUEST_PRIVATE_MESSAGE_999";
      const sourceThread = makeThread(sourceId, "Guest source", now, {
        guestShare: {
          id: GuestShareId.make("guest-share:1"),
          host: "example.t3.codes",
          createdAt: isoNow,
          expiresAt: isoNow,
          guestName: "Guest Alice",
          messages: [
            {
              id: GuestMessageId.make("guest-msg:1"),
              text: `Guest note ${guestSecret}`,
              status: "pending",
              submittedAt: isoNow,
            },
          ],
        },
      });
      const forkThread = makeThread(forkId, "Guest live fork", now, {
        forkedFrom: { type: "run", threadId: sourceId, runId: run1Id },
      });

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:guest-source:created"),
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
            secretToken: "KEEP_FOR_FORK_ONLY",
            now,
          }),
          {
            id: EventId.make("event:guest-fork:created"),
            type: "thread.created",
            threadId: forkId,
            providerInstanceId,
            occurredAt: now,
            payload: forkThread,
          },
          {
            id: EventId.make("event:guest-fork:transfer"),
            type: "context-transfer.created",
            threadId: forkId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: ContextTransferId.make("transfer:guest-source-to-fork"),
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

      // Source has only run 1, and fork inherits run 1 (so purgedRuns.length === 0).
      yield* sink.write({
        commandId: CommandId.make("cmd:delete-guest-source"),
        events: [
          {
            id: EventId.make("event:guest-source:deleted"),
            type: "thread.deleted",
            threadId: sourceId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...sourceThread, deletedAt: now, updatedAt: now },
          },
        ],
      });

      const retainedMessages = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${sourceId} AND run_id = ${run1Id}
      `;
      assert.equal(retainedMessages[0]?.count, 2);

      const guestLeaks = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_v2_projection_threads WHERE thread_id = ${sourceId} AND payload_json LIKE ${`%${guestSecret}%`}) +
          (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${sourceId} AND event_type = 'thread.deleted' AND payload_json LIKE ${`%${guestSecret}%`}) +
          (SELECT COUNT(*) FROM orchestration_v2_events WHERE thread_id = ${sourceId} AND event_type = 'thread.deleted' AND payload_json LIKE ${`%${guestSecret}%`})
        AS count
      `;
      assert.equal(guestLeaks[0]?.count, 0);
    }).pipe(Effect.provide(layerTest)),
);

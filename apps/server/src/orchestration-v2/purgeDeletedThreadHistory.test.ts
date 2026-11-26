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

it.effect("purges thread history, search index, and events through ProjectionMaintenance", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const sink = yield* EventSink.EventSinkV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
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

    assert.isAbove(yield* maintenance.purgeDeletedThread(threadId), 0);

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
  "retains fork ancestor run 1 while purging post-fork run 2 and failed outbox answers, then purges run 1 when last fork is deleted",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const sink = yield* EventSink.EventSinkV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
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
              sourcePoint: { threadId: sourceId, runId: run1Id },
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

      yield* outbox.enqueue([
        {
          id: "effect:fork-source:respond-fail",
          commandId: CommandId.make("cmd:fork-source-respond-fail"),
          threadId: sourceId,
          request: {
            type: "runtime-request.respond",
            providerSessionId: ProviderSessionId.make("session:fork-source"),
            requestId: RuntimeRequestId.make("req:fork-source-fail"),
            feedback: "FORK_OUTBOX_FEEDBACK_SECRET",
            answers: { q1: "FORK_OUTBOX_ANSWER_SECRET" },
          },
        },
      ]);
      yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'failed', completed_at = ${DateTime.formatIso(now)}, last_error = 'boom'
        WHERE effect_id = 'effect:fork-source:respond-fail'
      `;

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

      // Deleting source while live fork exists must purge run 2 and scrub failed outbox answers while preserving run 1.
      assert.isAbove(yield* maintenance.purgeDeletedThread(sourceId), 0);

      const postForkRemaining = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${sourceId} AND payload_json LIKE '%PURGE_POST_FORK_222%') +
          (SELECT COUNT(*) FROM orchestration_v2_projection_messages WHERE thread_id = ${sourceId} AND run_id = ${run2Id}) +
          (SELECT COUNT(*) FROM orchestration_v2_projection_runs WHERE thread_id = ${sourceId} AND run_id = ${run2Id})
        AS count
      `;
      assert.equal(postForkRemaining[0]?.count, 0);

      const preForkRemaining = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${sourceId} AND run_id = ${run1Id}
      `;
      assert.equal(preForkRemaining[0]?.count, 2);

      // Fork snapshot still reads inherited run 1 content and has no run 2 content.
      const forkSnapshot = yield* projectionStore.getThreadSnapshot(forkId);
      const serializedFork = JSON.stringify(forkSnapshot.projection);
      assert.include(serializedFork, "KEEP_FORK_ANCESTOR_111");
      assert.notInclude(serializedFork, "PURGE_POST_FORK_222");

      // Failed outbox row keeps status='failed' for worktree protection, with answers & feedback stripped.
      const failedOutboxRows = yield* sql<{
        readonly status: string;
        readonly payload_json: string;
        readonly last_error: string | null;
      }>`
        SELECT status, payload_json, last_error
        FROM orchestration_v2_effect_outbox
        WHERE effect_id = 'effect:fork-source:respond-fail'
      `;
      assert.equal(failedOutboxRows.length, 1);
      assert.equal(failedOutboxRows[0]?.status, "failed");
      assert.isNull(failedOutboxRows[0]?.last_error);
      assert.notInclude(failedOutboxRows[0]?.payload_json ?? "", "FORK_OUTBOX_ANSWER_SECRET");
      assert.notInclude(failedOutboxRows[0]?.payload_json ?? "", "FORK_OUTBOX_FEEDBACK_SECRET");

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

      assert.isAbove(yield* maintenance.purgeDeletedThread(forkId), 0);
      const allSourceLeftovers = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_v2_projection_messages WHERE thread_id IN (${sourceId}, ${forkId})) +
          (SELECT COUNT(*) FROM orchestration_v2_projection_turn_items WHERE thread_id IN (${sourceId}, ${forkId})) +
          (SELECT COUNT(*) FROM orchestration_v2_projection_runs WHERE thread_id IN (${sourceId}, ${forkId})) +
          (SELECT COUNT(*) FROM orchestration_events WHERE stream_id IN (${sourceId}, ${forkId}) AND event_type NOT IN ('thread.created', 'thread.deleted'))
        AS count
      `;
      assert.equal(allSourceLeftovers[0]?.count, 0);
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "preserves deleted threads with pending merge-back or active subagent parent until consumers finish",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const sink = yield* EventSink.EventSinkV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const mergeSourceId = ThreadId.make("thread:merge-source");
      const mergeTargetId = ThreadId.make("thread:merge-target");
      const parentId = ThreadId.make("thread:subagent-parent");
      const childId = ThreadId.make("thread:subagent-child");
      const mergeSource = makeThread(mergeSourceId, "Merge source", now);
      const mergeTarget = makeThread(mergeTargetId, "Merge target", now);
      const parent = makeThread(parentId, "Parent", now);
      const child = makeThread(childId, "Child", now);

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:ms:created"),
            type: "thread.created",
            threadId: mergeSourceId,
            providerInstanceId,
            occurredAt: now,
            payload: mergeSource,
          },
          ...makeConversationEvents({
            threadId: mergeSourceId,
            runId: RunId.make("run:ms:1"),
            ordinal: 1,
            secretToken: "MERGE_KEEP_1",
            now,
          }),
          {
            id: EventId.make("event:mt:created"),
            type: "thread.created",
            threadId: mergeTargetId,
            providerInstanceId,
            occurredAt: now,
            payload: mergeTarget,
          },
          {
            id: EventId.make("event:mt:merge-back"),
            type: "context-transfer.created",
            threadId: mergeTargetId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: ContextTransferId.make("transfer:pending-merge-back"),
              type: "merge_back",
              sourceThreadId: mergeSourceId,
              targetThreadId: mergeTargetId,
              sourcePoint: { threadId: mergeSourceId, runId: RunId.make("run:ms:1") },
              basePoint: null,
              sourceProviderInstanceId: providerInstanceId,
              targetProviderInstanceId: providerInstanceId,
              targetRunId: null,
              status: "pending",
              resolution: null,
              createdBy: "user",
              error: null,
              createdAt: now,
              updatedAt: now,
              consumedAt: null,
            },
          },
          {
            id: EventId.make("event:parent:created"),
            type: "thread.created",
            threadId: parentId,
            providerInstanceId,
            occurredAt: now,
            payload: parent,
          },
          {
            id: EventId.make("event:child:created"),
            type: "thread.created",
            threadId: childId,
            providerInstanceId,
            occurredAt: now,
            payload: child,
          },
          ...makeConversationEvents({
            threadId: childId,
            runId: RunId.make("run:child:1"),
            ordinal: 1,
            secretToken: "CHILD_KEEP_1",
            now,
          }),
        ],
      });

      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, run_id, parent_node_id, provider, child_thread_id, origin, status, updated_at, payload_json
        ) VALUES (
          'sub:1', ${parentId}, 'run:parent:1', 'node:parent:1', 'codex', ${childId}, 'delegated', 'running',
          ${DateTime.formatIso(now)}, '{}'
        )
      `;

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:ms:deleted"),
            type: "thread.deleted",
            threadId: mergeSourceId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...mergeSource, deletedAt: now, updatedAt: now },
          },
          {
            id: EventId.make("event:child:deleted"),
            type: "thread.deleted",
            threadId: childId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...child, deletedAt: now, updatedAt: now },
          },
        ],
      });

      assert.equal(yield* maintenance.purgeDeletedThread(mergeSourceId), 0);
      assert.equal(yield* maintenance.purgeDeletedThread(childId), 0);
      assert.equal(
        (yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM orchestration_v2_projection_messages
            WHERE thread_id IN (${mergeSourceId}, ${childId})
          `)[0]?.count,
        4,
      );
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "maintenance sweep purges deleted tombstones with only agent_feedback or legacy orchestration_v2_events left without rewriting on second scan",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const isoNow = DateTime.formatIso(now);
      const sink = yield* EventSink.EventSinkV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const feedbackOnlyId = ThreadId.make("thread:tombstone-feedback-only");
      const v2EventsOnlyId = ThreadId.make("thread:tombstone-v2events-only");
      const feedbackThread = makeThread(
        feedbackOnlyId,
        ProjectionMaintenance.DELETED_THREAD_TITLE,
        now,
      );
      const v2EventsThread = makeThread(
        v2EventsOnlyId,
        ProjectionMaintenance.DELETED_THREAD_TITLE,
        now,
      );

      yield* sink.write({
        events: [
          {
            id: EventId.make("event:fb-only:created"),
            type: "thread.created",
            threadId: feedbackOnlyId,
            providerInstanceId,
            occurredAt: now,
            payload: feedbackThread,
          },
          {
            id: EventId.make("event:fb-only:deleted"),
            type: "thread.deleted",
            threadId: feedbackOnlyId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...feedbackThread, deletedAt: now, updatedAt: now },
          },
          {
            id: EventId.make("event:v2-only:created"),
            type: "thread.created",
            threadId: v2EventsOnlyId,
            providerInstanceId,
            occurredAt: now,
            payload: v2EventsThread,
          },
          {
            id: EventId.make("event:v2-only:deleted"),
            type: "thread.deleted",
            threadId: v2EventsOnlyId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...v2EventsThread, deletedAt: now, updatedAt: now },
          },
        ],
      });

      yield* sql`
        INSERT INTO agent_feedback (
          id, thread_id, run_id, created_at, kind, subject, expected, actual, workaround,
          user_requested, trace, source, sent
        ) VALUES (
          'fb-leftover', ${feedbackOnlyId}, NULL, ${isoNow}, 'bug', 'LEFTOVER_FEEDBACK_SECRET',
          'expected', 'actual', 'workaround', 0, NULL, 'agent', 1
        )
      `;
      yield* sql`
        INSERT INTO orchestration_v2_events (
          event_id, thread_id, event_type, occurred_at, payload_json
        ) VALUES (
          'v2-leftover-msg', ${v2EventsOnlyId}, 'message.updated', ${isoNow},
          '{"text":"LEFTOVER_V2_EVENT_SECRET"}'
        )
      `;

      const firstSweep = yield* maintenance.pruneEventStore();
      assert.isAbove(firstSweep.purgedRowCount, 0);

      const remaining = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM agent_feedback WHERE thread_id = ${feedbackOnlyId}) +
          (SELECT COUNT(*) FROM orchestration_v2_events WHERE thread_id = ${v2EventsOnlyId} AND event_type NOT IN ('thread.created', 'thread.deleted'))
        AS count
      `;
      assert.equal(remaining[0]?.count, 0);

      const beforeSecond = yield* sql<{ readonly count: number }>`SELECT total_changes() AS count`;
      const secondSweep = yield* maintenance.pruneEventStore();
      const afterSecond = yield* sql<{ readonly count: number }>`SELECT total_changes() AS count`;
      assert.equal(secondSweep.purgedRowCount, 0);
      assert.equal(afterSecond[0]?.count, beforeSecond[0]?.count);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("ProjectionMaintenance.pruneEventStore purges previously soft-deleted threads once", () =>
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
    const stored = yield* eventStore.append({ events });
    for (const s of stored) {
      yield* projectionStore.apply(s.event);
    }

    const summary = yield* maintenance.pruneEventStore();
    assert.isAbove(summary.purgedRowCount, 0);

    const after = yield* sql<{ readonly count: number }>`
      SELECT
        (SELECT COUNT(*) FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_v2_projection_turn_items WHERE thread_id = ${threadId}) +
        (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${threadId} AND payload_json LIKE '%LEGACY_SECRET_333%')
      AS count
    `;
    assert.equal(after[0]?.count, 0);

    const beforeChanges = yield* sql<{ readonly count: number }>`SELECT total_changes() AS count`;
    const yieldCount = yield* Ref.make(0);
    const secondSummary = yield* maintenance.pruneEventStore(
      Ref.update(yieldCount, (value) => value + 1),
    );
    const afterChanges = yield* sql<{ readonly count: number }>`SELECT total_changes() AS count`;
    assert.equal(secondSummary.purgedRowCount, 0);
    assert.isAbove(yield* Ref.get(yieldCount), 0);
    assert.equal(afterChanges[0]?.count, beforeChanges[0]?.count);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("preserves a shared Codex provider session while another bound thread lives", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const sink = yield* EventSink.EventSinkV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
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

    yield* maintenance.purgeDeletedThread(threadB);

    const afterDeleteB = yield* projectionStore.getThreadRecords(threadA, ["providerSessions"]);
    assert.equal(afterDeleteB.providerSessions.length, 1);
    assert.equal(afterDeleteB.providerSessions[0]?.id, sessionId);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "redacts failed and deletes succeeded runtime-request.respond outbox rows after cleanup completes",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const sink = yield* EventSink.EventSinkV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
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
        ],
      });

      // Pending terminal.cleanup defers destructive purge until cleanup settles.
      assert.equal(yield* maintenance.purgeDeletedThread(threadId), 0);
      yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'succeeded', completed_at = ${DateTime.formatIso(now)}
        WHERE effect_id = 'effect:delete-outbox:terminal'
      `;

      yield* maintenance.purgeDeletedThread(threadId);

      const leaked = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_v2_effect_outbox
        WHERE thread_id = ${threadId}
          AND (payload_json LIKE ${`%${succeededSecret}%`} OR payload_json LIKE ${`%${failedSecret}%`})
      `;
      assert.equal(leaked[0]?.count, 0);

      const statuses = yield* sql<{ readonly effect_id: string; readonly status: string }>`
        SELECT effect_id, status
        FROM orchestration_v2_effect_outbox
        WHERE thread_id = ${threadId}
        ORDER BY effect_id ASC
      `;
      assert.deepEqual(
        statuses.map((row) => [row.effect_id, row.status]),
        [["effect:outbox:respond-fail", "failed"]],
      );
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "strips guestShare from projection and all history events including thread.guest-share-updated even while a live run fork retains the source thread",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const isoNow = DateTime.formatIso(now);
      const sink = yield* EventSink.EventSinkV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const sourceId = ThreadId.make("thread:guest-source");
      const forkId = ThreadId.make("thread:guest-fork");
      const run1Id = RunId.make("run:guest-source:1");
      const guestSecret = "GUEST_PRIVATE_MESSAGE_999";
      const baseSourceThread = makeThread(sourceId, "Guest source", now);
      const sourceWithGuest: OrchestrationV2AppThread = {
        ...baseSourceThread,
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
      };
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
            payload: baseSourceThread,
          },
          {
            id: EventId.make("event:guest-source:guest-updated"),
            type: "thread.guest-share-updated",
            threadId: sourceId,
            providerInstanceId,
            occurredAt: now,
            payload: sourceWithGuest,
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
              sourcePoint: { threadId: sourceId, runId: run1Id },
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

      yield* sink.write({
        commandId: CommandId.make("cmd:delete-guest-source"),
        events: [
          {
            id: EventId.make("event:guest-source:deleted"),
            type: "thread.deleted",
            threadId: sourceId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...sourceWithGuest, deletedAt: now, updatedAt: now },
          },
        ],
      });

      // Live fork still retains run 1, so destructive content purge returns 0, while guestShare is scrubbed everywhere.
      assert.equal(yield* maintenance.purgeDeletedThread(sourceId), 0);

      const retainedMessages = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${sourceId} AND run_id = ${run1Id}
      `;
      assert.equal(retainedMessages[0]?.count, 2);

      // Search ALL event types (including thread.guest-share-updated) without filtering by event_type.
      const guestLeaks = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_v2_projection_threads WHERE thread_id = ${sourceId} AND payload_json LIKE ${`%${guestSecret}%`}) +
          (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${sourceId} AND payload_json LIKE ${`%${guestSecret}%`}) +
          (SELECT COUNT(*) FROM orchestration_v2_events WHERE thread_id = ${sourceId} AND payload_json LIKE ${`%${guestSecret}%`})
        AS count
      `;
      assert.equal(guestLeaks[0]?.count, 0);
    }).pipe(Effect.provide(layerTest)),
);

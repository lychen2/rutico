import type { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

const PURGE_PAGE_SIZE = 100;

const findLiveForkRetentionOrdinal = Effect.fn(
  "purgeDeletedThreadHistory.findLiveForkRetentionOrdinal",
)(function* (sql: SqlClient.SqlClient, targetId: ThreadId) {
  const shownRows = yield* sql<{ readonly with_fork: number | null }>`
      WITH RECURSIVE showing(thread_id, deleted_at, through) AS (
        SELECT fork.thread_id, fork.deleted_at, fork_run.ordinal
        FROM orchestration_v2_projection_context_transfers AS transfer
        JOIN orchestration_v2_projection_threads AS fork
          ON fork.thread_id = transfer.target_thread_id
        JOIN orchestration_v2_projection_runs AS fork_run
          ON fork_run.run_id = json_extract(fork.payload_json, '$.forkedFrom.runId')
        WHERE transfer.source_thread_id = ${targetId}
          AND transfer.type = 'fork'
          AND fork_run.thread_id = ${targetId}
          AND json_extract(fork.payload_json, '$.forkedFrom.type') = 'run'
          AND json_extract(fork.payload_json, '$.forkedFrom.threadId') = ${targetId}
          AND json_extract(fork.payload_json, '$.lineage.sideChat') IS NOT 1
        UNION
        SELECT child.thread_id, child.deleted_at, showing.through
        FROM showing
        JOIN orchestration_v2_projection_context_transfers AS transfer
          ON transfer.source_thread_id = showing.thread_id AND transfer.type = 'fork'
        JOIN orchestration_v2_projection_threads AS child
          ON child.thread_id = transfer.target_thread_id
        WHERE json_extract(child.payload_json, '$.forkedFrom.type') = 'run'
          AND json_extract(child.payload_json, '$.forkedFrom.threadId') = showing.thread_id
          AND json_extract(child.payload_json, '$.lineage.sideChat') IS NOT 1
      )
      SELECT MAX(through) AS with_fork
      FROM showing
      WHERE deleted_at IS NULL
    `;
  return shownRows[0]?.with_fork ?? null;
});

const redactSettledSensitiveOutbox = Effect.fn(
  "purgeDeletedThreadHistory.redactSettledSensitiveOutbox",
)(function* (sql: SqlClient.SqlClient, targetId: ThreadId) {
  // Keep failed rows intact for StorageCleanup's worktree guard while scrubbing user text.
  yield* sql`
      UPDATE orchestration_v2_effect_outbox
      SET payload_json = json_remove(payload_json, '$.feedback', '$.answers')
      WHERE thread_id = ${targetId}
        AND status IN ('succeeded', 'cancelled', 'failed')
        AND effect_type = 'runtime-request.respond'
        AND json_valid(payload_json)
        AND (
          json_extract(payload_json, '$.feedback') IS NOT NULL
          OR json_extract(payload_json, '$.answers') IS NOT NULL
        )
    `;
  yield* sql`
      UPDATE orchestration_v2_effect_outbox
      SET payload_json = json_set(payload_json, '$.title', 'Deleted thread')
      WHERE thread_id = ${targetId}
        AND status IN ('succeeded', 'cancelled', 'failed')
        AND effect_type = 'provider-session.apply-thread-title'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.title') <> 'Deleted thread'
    `;
});

const stripDeletedThreadGuestShare = Effect.fn(
  "purgeDeletedThreadHistory.stripDeletedThreadGuestShare",
)(function* (sql: SqlClient.SqlClient, targetId: ThreadId) {
  yield* sql`
      UPDATE orchestration_v2_projection_threads
      SET payload_json = json_remove(payload_json, '$.guestShare')
      WHERE thread_id = ${targetId}
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.guestShare') IS NOT NULL
    `;
  yield* sql`
      UPDATE orchestration_events
      SET payload_json = json_remove(payload_json, '$.guestShare')
      WHERE aggregate_kind = 'thread'
        AND stream_id = ${targetId}
        AND event_type = 'thread.deleted'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.guestShare') IS NOT NULL
    `;
  yield* sql`
      UPDATE orchestration_v2_events
      SET payload_json = json_remove(payload_json, '$.guestShare')
      WHERE thread_id = ${targetId}
        AND event_type = 'thread.deleted'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.guestShare') IS NOT NULL
    `;
});

/** Read-only probe so periodic maintenance skips already-purged tombstones without taking a write lock. */
const deletedThreadNeedsPurge = Effect.fn("purgeDeletedThreadHistory.deletedThreadNeedsPurge")(
  function* (sql: SqlClient.SqlClient, targetId: ThreadId): Effect.fn.Return<boolean, SqlError> {
    const withFork = yield* findLiveForkRetentionOrdinal(sql, targetId).pipe(
      NodeSqliteClient.readOnly,
    );
    const guestOrOutboxRows = yield* sql<{ readonly needs_purge: number }>`
      SELECT
        EXISTS (
          SELECT 1 FROM orchestration_v2_projection_threads
          WHERE thread_id = ${targetId}
            AND json_valid(payload_json)
            AND json_extract(payload_json, '$.guestShare') IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_events
          WHERE aggregate_kind = 'thread'
            AND stream_id = ${targetId}
            AND event_type = 'thread.deleted'
            AND json_valid(payload_json)
            AND json_extract(payload_json, '$.guestShare') IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_v2_events
          WHERE thread_id = ${targetId}
            AND event_type = 'thread.deleted'
            AND json_valid(payload_json)
            AND json_extract(payload_json, '$.guestShare') IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_v2_effect_outbox
          WHERE thread_id = ${targetId}
            AND status IN ('succeeded', 'cancelled', 'failed')
            AND json_valid(payload_json)
            AND (
              (
                effect_type = 'runtime-request.respond'
                AND (
                  json_extract(payload_json, '$.feedback') IS NOT NULL
                  OR json_extract(payload_json, '$.answers') IS NOT NULL
                )
              )
              OR (
                effect_type = 'provider-session.apply-thread-title'
                AND json_extract(payload_json, '$.title') <> 'Deleted thread'
              )
            )
        ) AS needs_purge
    `.pipe(NodeSqliteClient.readOnly);
    if ((guestOrOutboxRows[0]?.needs_purge ?? 0) === 1) {
      return true;
    }

    if (withFork !== null) {
      const postForkRows = yield* sql<{ readonly has_post_fork: number }>`
        SELECT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runs
          WHERE thread_id = ${targetId} AND ordinal > ${withFork}
        ) AS has_post_fork
      `.pipe(NodeSqliteClient.readOnly);
      return (postForkRows[0]?.has_post_fork ?? 0) === 1;
    }

    const remnantRows = yield* sql<{ readonly has_remnants: number }>`
      SELECT
        EXISTS (SELECT 1 FROM orchestration_v2_projection_messages WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_turn_items WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_turn_item_positions WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_plans WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_runtime_requests WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_subagents WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_context_handoffs WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_checkpoints WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_provider_turns WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_run_attempts WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_nodes WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_runs WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_provider_threads WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_provider_session_bindings WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_projection_provider_sessions WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_thread_launch_workflows WHERE thread_id = ${targetId})
        OR EXISTS (
          SELECT 1 FROM thread_wait_wake_obligations
          WHERE caller_thread_id = ${targetId} OR target_thread_id = ${targetId}
        )
        OR EXISTS (SELECT 1 FROM projection_thread_pull_requests WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM agent_feedback WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM orchestration_v2_legacy_imports WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM projection_thread_messages WHERE thread_id = ${targetId})
        OR EXISTS (SELECT 1 FROM projection_thread_sessions WHERE thread_id = ${targetId})
        OR EXISTS (
          SELECT 1 FROM projection_threads
          WHERE thread_id = ${targetId} AND (title <> 'Deleted thread' OR latest_turn_id IS NOT NULL)
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_v2_projection_context_transfers
          WHERE target_thread_id = ${targetId}
             OR (
               source_thread_id = ${targetId}
               AND NOT EXISTS (
                 SELECT 1 FROM orchestration_v2_projection_threads AS child
                 WHERE child.thread_id = target_thread_id AND child.deleted_at IS NULL
               )
             )
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_events
          WHERE aggregate_kind = 'thread'
            AND stream_id = ${targetId}
            AND (
              event_type <> 'thread.deleted'
              OR (json_valid(payload_json) AND json_extract(payload_json, '$.title') <> 'Deleted thread')
            )
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_v2_events
          WHERE thread_id = ${targetId}
            AND (
              event_type <> 'thread.deleted'
              OR (json_valid(payload_json) AND json_extract(payload_json, '$.title') <> 'Deleted thread')
            )
        )
        OR EXISTS (
          SELECT 1 FROM orchestration_v2_projection_threads
          WHERE thread_id = ${targetId}
            AND (
              title <> 'Deleted thread'
              OR (json_valid(payload_json) AND json_extract(payload_json, '$.title') <> 'Deleted thread')
            )
        ) AS has_remnants
    `.pipe(NodeSqliteClient.readOnly);
    return (remnantRows[0]?.has_remnants ?? 0) === 1;
  },
);

/**
 * Deletes persisted messages, turn items, runs, nodes, plans, search index entries,
 * legacy V1 rows, and event-log history for a deleted thread (and any deleted run-fork
 * ancestors no longer referenced by a live fork).
 */
export const purgeDeletedThreadHistory = Effect.fn("purgeDeletedThreadHistory")(function* (
  sql: SqlClient.SqlClient,
  rootDeletedThreadId: ThreadId,
): Effect.fn.Return<number, SqlError> {
  const deletedSources = yield* sql<{ readonly thread_id: ThreadId }>`
    WITH RECURSIVE source(thread_id) AS (
      SELECT json_extract(thread.payload_json, '$.forkedFrom.threadId')
      FROM orchestration_v2_projection_threads AS thread
      WHERE thread.thread_id = ${rootDeletedThreadId}
        AND json_extract(thread.payload_json, '$.forkedFrom.type') = 'run'
        AND json_extract(thread.payload_json, '$.lineage.sideChat') IS NOT 1
      UNION
      SELECT json_extract(thread.payload_json, '$.forkedFrom.threadId')
      FROM orchestration_v2_projection_threads AS thread
      JOIN source USING (thread_id)
      WHERE thread.deleted_at IS NOT NULL
        AND json_extract(thread.payload_json, '$.forkedFrom.type') = 'run'
        AND json_extract(thread.payload_json, '$.lineage.sideChat') IS NOT 1
    )
    SELECT thread.thread_id
    FROM source
    JOIN orchestration_v2_projection_threads AS thread USING (thread_id)
    WHERE thread.deleted_at IS NOT NULL
  `;

  const targets = [
    ...new Set<ThreadId>([rootDeletedThreadId, ...deletedSources.map((row) => row.thread_id)]),
  ];
  let deletedEventCount = 0;

  for (const targetId of targets) {
    const deletedRows = yield* sql<{ readonly deleted_at: string | null }>`
      SELECT deleted_at
      FROM orchestration_v2_projection_threads
      WHERE thread_id = ${targetId}
      LIMIT 1
    `;
    if (deletedRows[0]?.deleted_at == null) {
      continue;
    }

    // Guest chat and settled user-input outbox payloads never belong to live run forks.
    yield* stripDeletedThreadGuestShare(sql, targetId);
    yield* redactSettledSensitiveOutbox(sql, targetId);

    const withFork = yield* findLiveForkRetentionOrdinal(sql, targetId);

    if (withFork === null) {
      yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_turn_items WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_turn_item_positions WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_plans WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_runtime_requests WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_subagents WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_context_handoffs WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_checkpoints WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_provider_turns WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_run_attempts WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_nodes WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_runs WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_provider_threads WHERE thread_id = ${targetId}`;
      // Shared provider sessions (e.g. Codex) bind multiple threads; keep the main row while any
      // other binding remains, and reassign its thread_id away from the deleted thread.
      const boundSessions = yield* sql<{ readonly provider_session_id: string }>`
        SELECT provider_session_id
        FROM orchestration_v2_projection_provider_session_bindings
        WHERE thread_id = ${targetId}
        UNION
        SELECT provider_session_id
        FROM orchestration_v2_projection_provider_sessions
        WHERE thread_id = ${targetId}
      `;
      yield* sql`
        DELETE FROM orchestration_v2_projection_provider_session_bindings
        WHERE thread_id = ${targetId}
      `;
      if (boundSessions.length > 0) {
        const sessionIds = boundSessions.map((row) => row.provider_session_id);
        yield* sql`
          DELETE FROM orchestration_v2_projection_provider_sessions
          WHERE provider_session_id IN ${sql.in(sessionIds)}
            AND NOT EXISTS (
              SELECT 1
              FROM orchestration_v2_projection_provider_session_bindings AS binding
              WHERE binding.provider_session_id = orchestration_v2_projection_provider_sessions.provider_session_id
            )
        `;
        yield* sql`
          UPDATE orchestration_v2_projection_provider_sessions
          SET thread_id = (
            SELECT binding.thread_id
            FROM orchestration_v2_projection_provider_session_bindings AS binding
            WHERE binding.provider_session_id = orchestration_v2_projection_provider_sessions.provider_session_id
            ORDER BY binding.thread_id ASC
            LIMIT 1
          )
          WHERE provider_session_id IN ${sql.in(sessionIds)}
            AND thread_id = ${targetId}
        `;
      }
      yield* sql`DELETE FROM orchestration_v2_thread_launch_workflows WHERE thread_id = ${targetId}`;
      yield* sql`
        DELETE FROM thread_wait_wake_obligations
        WHERE caller_thread_id = ${targetId}
           OR target_thread_id = ${targetId}
      `;
      yield* sql`DELETE FROM projection_thread_pull_requests WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM agent_feedback WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM orchestration_v2_legacy_imports WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM projection_thread_messages WHERE thread_id = ${targetId}`;
      yield* sql`DELETE FROM projection_thread_sessions WHERE thread_id = ${targetId}`;
      yield* sql`
        UPDATE projection_threads
        SET title = 'Deleted thread', latest_turn_id = NULL
        WHERE thread_id = ${targetId}
          AND (title <> 'Deleted thread' OR latest_turn_id IS NOT NULL)
      `;
      yield* sql`
        DELETE FROM orchestration_v2_projection_context_transfers
        WHERE target_thread_id = ${targetId}
           OR (
             source_thread_id = ${targetId}
             AND NOT EXISTS (
               SELECT 1
               FROM orchestration_v2_projection_threads AS child
               WHERE child.thread_id = target_thread_id
                 AND child.deleted_at IS NULL
             )
           )
      `;
      const eventCountRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id = ${targetId}
          AND event_type <> 'thread.deleted'
      `;
      deletedEventCount += eventCountRows[0]?.count ?? 0;
      yield* sql`
        DELETE FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id = ${targetId}
          AND event_type <> 'thread.deleted'
      `;
      yield* sql`
        DELETE FROM orchestration_v2_events
        WHERE thread_id = ${targetId}
          AND event_type <> 'thread.deleted'
      `;
      // Keep only the minimal tombstone metadata (branch/worktree/forkedFrom/deletedAt)
      // required by StorageCleanup and schema decoders; strip the thread title and guest chat.
      yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET
          title = 'Deleted thread',
          payload_json = json_remove(json_set(payload_json, '$.title', 'Deleted thread'), '$.guestShare')
        WHERE thread_id = ${targetId}
          AND (
            title <> 'Deleted thread'
            OR json_extract(payload_json, '$.title') <> 'Deleted thread'
            OR json_extract(payload_json, '$.guestShare') IS NOT NULL
          )
      `;
      yield* sql`
        UPDATE orchestration_events
        SET payload_json = json_remove(json_set(payload_json, '$.title', 'Deleted thread'), '$.guestShare')
        WHERE aggregate_kind = 'thread'
          AND stream_id = ${targetId}
          AND event_type = 'thread.deleted'
          AND (
            json_extract(payload_json, '$.title') <> 'Deleted thread'
            OR json_extract(payload_json, '$.guestShare') IS NOT NULL
          )
      `;
      yield* sql`
        UPDATE orchestration_v2_events
        SET payload_json = json_remove(json_set(payload_json, '$.title', 'Deleted thread'), '$.guestShare')
        WHERE thread_id = ${targetId}
          AND event_type = 'thread.deleted'
          AND (
            json_extract(payload_json, '$.title') <> 'Deleted thread'
            OR json_extract(payload_json, '$.guestShare') IS NOT NULL
          )
      `;
      continue;
    }

    // Live run forks still read runs <= withFork. Purge every run after withFork immediately.
    const purgedRuns = yield* sql<{ readonly run_id: string }>`
      SELECT run_id
      FROM orchestration_v2_projection_runs
      WHERE thread_id = ${targetId}
        AND ordinal > ${withFork}
    `;
    if (purgedRuns.length === 0) {
      continue;
    }
    const purgedRunIds = purgedRuns.map((row) => row.run_id);
    const purgedNodes = yield* sql<{ readonly node_id: string }>`
      SELECT node_id
      FROM orchestration_v2_projection_nodes
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    const purgedNodeIds = purgedNodes.map((row) => row.node_id);

    yield* sql`
      DELETE FROM orchestration_v2_projection_messages
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_turn_item_positions
      WHERE thread_id = ${targetId}
        AND turn_item_id NOT IN (
          SELECT turn_item_id
          FROM orchestration_v2_projection_turn_items
          WHERE thread_id = ${targetId}
        )
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_plans
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_checkpoints
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_context_handoffs
      WHERE thread_id = ${targetId}
        AND target_run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_subagents
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    if (purgedNodeIds.length > 0) {
      yield* sql`
        DELETE FROM orchestration_v2_projection_runtime_requests
        WHERE thread_id = ${targetId}
          AND node_id IN ${sql.in(purgedNodeIds)}
      `;
      yield* sql`
        DELETE FROM orchestration_v2_projection_provider_turns
        WHERE thread_id = ${targetId}
          AND node_id IN ${sql.in(purgedNodeIds)}
      `;
    }
    yield* sql`
      DELETE FROM orchestration_v2_projection_run_attempts
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_nodes
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_projection_runs
      WHERE thread_id = ${targetId}
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
    const runEventCountRows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM orchestration_events
      WHERE aggregate_kind = 'thread'
        AND stream_id = ${targetId}
        AND event_type <> 'thread.deleted'
        AND json_extract(metadata_json, '$.runId') IN ${sql.in(purgedRunIds)}
    `;
    deletedEventCount += runEventCountRows[0]?.count ?? 0;
    yield* sql`
      DELETE FROM orchestration_events
      WHERE aggregate_kind = 'thread'
        AND stream_id = ${targetId}
        AND event_type <> 'thread.deleted'
        AND json_extract(metadata_json, '$.runId') IN ${sql.in(purgedRunIds)}
    `;
    yield* sql`
      DELETE FROM orchestration_v2_events
      WHERE thread_id = ${targetId}
        AND event_type <> 'thread.deleted'
        AND run_id IN ${sql.in(purgedRunIds)}
    `;
  }

  return deletedEventCount;
});

/**
 * Purges any already-deleted threads on disk (e.g. from earlier soft-deletes) in bounded,
 * per-thread write transactions, skipping already-clean tombstones and yielding via `betweenPages`.
 */
export const purgeAllDeletedThreads = Effect.fn("purgeAllDeletedThreads")(function* (
  sql: SqlClient.SqlClient,
  betweenPages: Effect.Effect<void> = Effect.void,
): Effect.fn.Return<number, SqlError> {
  let deletedEventCount = 0;
  let cursor: string | null = null;
  while (true) {
    const page: ReadonlyArray<{ readonly thread_id: ThreadId }> = yield* (
      cursor === null
        ? sql<{ readonly thread_id: ThreadId }>`
            SELECT thread_id
            FROM orchestration_v2_projection_threads
            WHERE deleted_at IS NOT NULL
            ORDER BY thread_id ASC
            LIMIT ${PURGE_PAGE_SIZE}
          `
        : sql<{ readonly thread_id: ThreadId }>`
            SELECT thread_id
            FROM orchestration_v2_projection_threads
            WHERE deleted_at IS NOT NULL
              AND thread_id > ${cursor}
            ORDER BY thread_id ASC
            LIMIT ${PURGE_PAGE_SIZE}
          `
    ).pipe(NodeSqliteClient.readOnly);
    if (page.length === 0) break;

    for (const row of page) {
      if (yield* deletedThreadNeedsPurge(sql, row.thread_id)) {
        deletedEventCount += yield* sql.withTransaction(
          purgeDeletedThreadHistory(sql, row.thread_id),
        );
        yield* Effect.yieldNow;
        yield* betweenPages;
      }
    }
    yield* betweenPages;
    if (page.length < PURGE_PAGE_SIZE) break;
    cursor = page.at(-1)?.thread_id ?? null;
  }
  return deletedEventCount;
});

/** Releases freed SQLite pages when the database uses incremental auto_vacuum. */
export const reclaimFreedSqlitePages = Effect.fn(
  "purgeDeletedThreadHistory.reclaimFreedSqlitePages",
)(function* (sql: SqlClient.SqlClient) {
  yield* Effect.gen(function* () {
    const rows = yield* sql<{ readonly auto_vacuum: number }>`PRAGMA auto_vacuum`;
    if (rows[0]?.auto_vacuum === 2) {
      yield* sql`PRAGMA incremental_vacuum`;
    }
  }).pipe(Effect.ignore);
});

import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import { toPersistenceSqlError, type PersistenceSqlError } from "./Errors.ts";

export interface ThreadWaitWakeObligation {
  readonly wakeId: string;
  readonly commandId: CommandId;
  readonly messageId: MessageId;
  readonly callerProjectId: ProjectId;
  readonly callerThreadId: ThreadId;
  readonly callerRunId: RunId;
  readonly callerProviderSessionId: string;
  readonly callerProviderInstanceId: ProviderInstanceId;
  readonly callerSequenceAtRegistration: number;
  readonly targetProjectId: ProjectId;
  readonly targetThreadId: ThreadId;
  readonly targetRunId: RunId;
  readonly targetSequenceAtRegistration: number;
  readonly untilDelegatedWorkSettled: boolean;
  readonly state: "registering" | "suspended";
}

export class ThreadWaitWakeObligationRepository extends Context.Service<
  ThreadWaitWakeObligationRepository,
  {
    readonly insertIfAbsent: (
      obligation: ThreadWaitWakeObligation,
    ) => Effect.Effect<boolean, PersistenceSqlError>;
    readonly get: (
      wakeId: string,
    ) => Effect.Effect<Option.Option<ThreadWaitWakeObligation>, PersistenceSqlError>;
    readonly list: () => Effect.Effect<
      ReadonlyArray<ThreadWaitWakeObligation>,
      PersistenceSqlError
    >;
    readonly listForThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<ThreadWaitWakeObligation>, PersistenceSqlError>;
    readonly markSuspended: (wakeId: string) => Effect.Effect<boolean, PersistenceSqlError>;
    readonly delete: (wakeId: string) => Effect.Effect<void, PersistenceSqlError>;
  }
>()("t3/persistence/ThreadWaitWakeObligations/ThreadWaitWakeObligationRepository") {}

interface ObligationRow {
  readonly wake_id: string;
  readonly command_id: string;
  readonly message_id: string;
  readonly caller_project_id: string;
  readonly caller_thread_id: string;
  readonly caller_run_id: string;
  readonly caller_provider_session_id: string;
  readonly caller_provider_instance_id: string;
  readonly caller_sequence_at_registration: number;
  readonly target_project_id: string;
  readonly target_thread_id: string;
  readonly target_run_id: string;
  readonly target_sequence_at_registration: number;
  readonly until_delegated_work_settled: number;
  readonly state: "registering" | "suspended";
}

const fromRow = (row: ObligationRow): ThreadWaitWakeObligation => ({
  wakeId: row.wake_id,
  commandId: CommandId.make(row.command_id),
  messageId: MessageId.make(row.message_id),
  callerProjectId: ProjectId.make(row.caller_project_id),
  callerThreadId: ThreadId.make(row.caller_thread_id),
  callerRunId: RunId.make(row.caller_run_id),
  callerProviderSessionId: row.caller_provider_session_id,
  callerProviderInstanceId: ProviderInstanceId.make(row.caller_provider_instance_id),
  callerSequenceAtRegistration: row.caller_sequence_at_registration,
  targetProjectId: ProjectId.make(row.target_project_id),
  targetThreadId: ThreadId.make(row.target_thread_id),
  targetRunId: RunId.make(row.target_run_id),
  targetSequenceAtRegistration: row.target_sequence_at_registration,
  untilDelegatedWorkSettled: row.until_delegated_work_settled === 1,
  state: row.state,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertIfAbsent: ThreadWaitWakeObligationRepository["Service"]["insertIfAbsent"] = (
    obligation,
  ) =>
    sql<{ readonly wake_id: string }>`
      INSERT INTO thread_wait_wake_obligations (
        wake_id, command_id, message_id,
        caller_project_id, caller_thread_id, caller_run_id,
        caller_provider_session_id, caller_provider_instance_id,
        caller_sequence_at_registration,
        target_project_id, target_thread_id, target_run_id,
        target_sequence_at_registration, until_delegated_work_settled, state
      ) VALUES (
        ${obligation.wakeId}, ${obligation.commandId}, ${obligation.messageId},
        ${obligation.callerProjectId}, ${obligation.callerThreadId}, ${obligation.callerRunId},
        ${obligation.callerProviderSessionId}, ${obligation.callerProviderInstanceId},
        ${obligation.callerSequenceAtRegistration},
        ${obligation.targetProjectId}, ${obligation.targetThreadId}, ${obligation.targetRunId},
        ${obligation.targetSequenceAtRegistration}, ${obligation.untilDelegatedWorkSettled ? 1 : 0},
        'registering'
      )
      ON CONFLICT(wake_id) DO NOTHING
      RETURNING wake_id
    `.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.mapError(toPersistenceSqlError("ThreadWaitWakeObligationRepository.insertIfAbsent")),
    );

  const get: ThreadWaitWakeObligationRepository["Service"]["get"] = (wakeId) =>
    sql<ObligationRow>`
      SELECT wake_id,
        command_id,
        message_id,
        caller_project_id,
        caller_thread_id,
        caller_run_id,
        caller_provider_session_id,
        caller_provider_instance_id,
        caller_sequence_at_registration,
        target_project_id,
        target_thread_id,
        target_run_id,
        target_sequence_at_registration,
        until_delegated_work_settled,
        state
      FROM thread_wait_wake_obligations
      WHERE wake_id = ${wakeId}
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => Option.fromUndefinedOr(rows[0]).pipe(Option.map(fromRow))),
      Effect.mapError(toPersistenceSqlError("ThreadWaitWakeObligationRepository.get")),
    );

  const list: ThreadWaitWakeObligationRepository["Service"]["list"] = () =>
    sql<ObligationRow>`
      SELECT wake_id,
        command_id,
        message_id,
        caller_project_id,
        caller_thread_id,
        caller_run_id,
        caller_provider_session_id,
        caller_provider_instance_id,
        caller_sequence_at_registration,
        target_project_id,
        target_thread_id,
        target_run_id,
        target_sequence_at_registration,
        until_delegated_work_settled,
        state
      FROM thread_wait_wake_obligations
      ORDER BY target_sequence_at_registration, wake_id
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows.map(fromRow)),
      Effect.mapError(toPersistenceSqlError("ThreadWaitWakeObligationRepository.list")),
    );

  const listForThread: ThreadWaitWakeObligationRepository["Service"]["listForThread"] = (
    threadId,
  ) =>
    sql<ObligationRow>`
      SELECT wake_id,
        command_id,
        message_id,
        caller_project_id,
        caller_thread_id,
        caller_run_id,
        caller_provider_session_id,
        caller_provider_instance_id,
        caller_sequence_at_registration,
        target_project_id,
        target_thread_id,
        target_run_id,
        target_sequence_at_registration,
        until_delegated_work_settled,
        state
      FROM thread_wait_wake_obligations
      WHERE caller_thread_id = ${threadId} OR target_thread_id = ${threadId}
      ORDER BY target_sequence_at_registration, wake_id
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows.map(fromRow)),
      Effect.mapError(toPersistenceSqlError("ThreadWaitWakeObligationRepository.listForThread")),
    );

  const markSuspended: ThreadWaitWakeObligationRepository["Service"]["markSuspended"] = (wakeId) =>
    sql<{ readonly wake_id: string }>`
      UPDATE thread_wait_wake_obligations
      SET state = 'suspended'
      WHERE wake_id = ${wakeId} AND state = 'registering'
      RETURNING wake_id
    `.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.mapError(toPersistenceSqlError("ThreadWaitWakeObligationRepository.markSuspended")),
    );

  const deleteObligation: ThreadWaitWakeObligationRepository["Service"]["delete"] = (wakeId) =>
    sql`DELETE FROM thread_wait_wake_obligations WHERE wake_id = ${wakeId}`.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ThreadWaitWakeObligationRepository.delete")),
    );

  return ThreadWaitWakeObligationRepository.of({
    insertIfAbsent,
    get,
    list,
    listForThread,
    markSuspended,
    delete: deleteObligation,
  });
});

export const layer = Layer.effect(ThreadWaitWakeObligationRepository, make);

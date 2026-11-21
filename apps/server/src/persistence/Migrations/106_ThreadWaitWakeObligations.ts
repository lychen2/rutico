import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_wait_wake_obligations (
      wake_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      message_id TEXT NOT NULL UNIQUE,
      caller_project_id TEXT NOT NULL,
      caller_thread_id TEXT NOT NULL,
      caller_run_id TEXT NOT NULL,
      caller_provider_session_id TEXT NOT NULL,
      caller_provider_instance_id TEXT NOT NULL,
      caller_sequence_at_registration INTEGER NOT NULL,
      target_project_id TEXT NOT NULL,
      target_thread_id TEXT NOT NULL,
      target_run_id TEXT NOT NULL,
      target_sequence_at_registration INTEGER NOT NULL,
      until_delegated_work_settled INTEGER NOT NULL CHECK (until_delegated_work_settled IN (0, 1)),
      state TEXT NOT NULL CHECK (state IN ('registering', 'suspended'))
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS thread_wait_wake_obligations_target_idx
    ON thread_wait_wake_obligations(target_thread_id, target_sequence_at_registration)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS thread_wait_wake_obligations_caller_idx
    ON thread_wait_wake_obligations(caller_thread_id, caller_sequence_at_registration)
  `;
});

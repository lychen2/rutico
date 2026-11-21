import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlitePersistence from "./Sqlite.ts";
import * as ThreadWaitWakeObligations from "./ThreadWaitWakeObligations.ts";

it.effect("persists, suspends, recovers, and removes a thread wait wake", () =>
  Effect.gen(function* () {
    const repository = yield* ThreadWaitWakeObligations.ThreadWaitWakeObligationRepository;
    const wakeId = "thread-wait:caller:run:target:run";
    const obligation: ThreadWaitWakeObligations.ThreadWaitWakeObligation = {
      wakeId,
      commandId: CommandId.make(`command:${wakeId}`),
      messageId: MessageId.make(`message:${wakeId}`),
      callerProjectId: ProjectId.make("project:wait-wake-caller"),
      callerThreadId: ThreadId.make("thread:wait-wake-caller"),
      callerRunId: RunId.make("run:wait-wake-caller"),
      callerProviderSessionId: "session:wait-wake-caller",
      callerProviderInstanceId: ProviderInstanceId.make("codex"),
      callerSequenceAtRegistration: 14,
      targetProjectId: ProjectId.make("project:wait-wake-target"),
      targetThreadId: ThreadId.make("thread:wait-wake-target"),
      targetRunId: RunId.make("run:wait-wake-target"),
      targetSequenceAtRegistration: 27,
      untilDelegatedWorkSettled: true,
      state: "registering",
    };

    assert.isTrue(yield* repository.insertIfAbsent(obligation));
    assert.isFalse(yield* repository.insertIfAbsent(obligation));

    const recovered = Option.getOrThrow(yield* repository.get(wakeId));
    assert.deepStrictEqual(recovered, obligation);
    assert.lengthOf(yield* repository.list(), 1);
    assert.lengthOf(yield* repository.listForThread(obligation.callerThreadId), 1);
    assert.isTrue(yield* repository.markSuspended(wakeId));
    assert.isFalse(yield* repository.markSuspended(wakeId));
    assert.equal(Option.getOrThrow(yield* repository.get(wakeId)).state, "suspended");

    yield* repository.delete(wakeId);
    assert.isTrue(Option.isNone(yield* repository.get(wakeId)));
    assert.lengthOf(yield* repository.list(), 0);
  }).pipe(
    Effect.provide(
      ThreadWaitWakeObligations.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
    ),
  ),
);

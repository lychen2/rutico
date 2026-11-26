import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ompUsageFormat, ompUsageReader, piUsageFormat } from "./usage.ts";

describe("OMP usage reader", () => {
  it.effect("scans --session-dir, --profile, and default ~/.omp/agent/sessions directories", () =>
    Effect.gen(function* () {
      if (ompUsageReader.kind !== "transcripts") {
        throw new Error("Expected transcripts reader");
      }
      const directories = yield* ompUsageReader.directories(
        {
          instanceId: ProviderInstanceId.make("omp"),
          config: {
            enabled: true,
            binaryPath: "",
            launchArgs: '--profile work --session-dir "~/custom-omp-sessions"',
            customModels: [],
          },
          environment: {},
          configured: true,
        },
        { awaitRefresh: false },
      );

      assert.deepEqual(
        directories.map((entry) => entry.dir),
        [
          "/home/tester/custom-omp-sessions",
          "/home/tester/.omp/profiles/work/agent/sessions",
          "/home/tester/.omp/agent/sessions",
        ],
      );
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(HostProcess.HomeDirectory, "/home/tester"),
      Effect.provideService(HostProcess.Platform, "linux"),
    ),
  );

  it.effect("omits missing OMP session directories for unconfigured fallback instances", () =>
    Effect.gen(function* () {
      if (ompUsageReader.kind !== "transcripts") {
        throw new Error("Expected transcripts reader");
      }
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempHome = yield* fs.makeTempDirectoryScoped({ prefix: "omp-usage-home-" });
      const existingDir = path.join(tempHome, "existing-omp-sessions");
      yield* fs.makeDirectory(existingDir, { recursive: true });

      const missing = yield* ompUsageReader.directories(
        {
          instanceId: ProviderInstanceId.make("omp"),
          config: undefined,
          environment: { HOME: tempHome },
          configured: false,
        },
        { awaitRefresh: false },
      );
      assert.deepEqual(missing, []);

      const present = yield* ompUsageReader.directories(
        {
          instanceId: ProviderInstanceId.make("omp"),
          config: undefined,
          environment: {
            HOME: tempHome,
            OMP_CODING_AGENT_SESSION_DIR: existingDir,
          },
          configured: false,
        },
        { awaitRefresh: false },
      );
      assert.deepEqual(
        present.map((entry) => entry.dir),
        [existingDir],
      );
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(HostProcess.HomeDirectory, "/home/tester"),
      Effect.provideService(HostProcess.Platform, "linux"),
    ),
  );

  it("reads OMP reasoningTokens while preserving wire provider 'pi' and omp dedupe keys", () => {
    const state = ompUsageFormat.state!.initial();
    const piState = piUsageFormat.state!.initial();
    const sessionLine = JSON.stringify({
      type: "session",
      version: 3,
      id: "01a1fe33-f572-70d8-b290-f52bcce640b3",
    });
    const messageLine = JSON.stringify({
      type: "message",
      id: "msg-1",
      timestamp: "2026-11-25T10:00:00.000Z",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt-5.4",
        usage: {
          input: 100,
          output: 80,
          cacheRead: 20,
          cacheWrite: 0,
          reasoningTokens: 30,
          cost: { total: 0.012 },
        },
      },
    });

    ompUsageFormat.parseLine(sessionLine, state);
    piUsageFormat.parseLine(sessionLine, piState);
    const [ompRecord] = ompUsageFormat.parseLine(messageLine, state);
    const [piRecord] = piUsageFormat.parseLine(messageLine, piState);

    assert.isDefined(ompRecord);
    assert.isDefined(piRecord);
    assert.equal(ompRecord!.provider, "pi");
    assert.equal(ompRecord!.sessionId, "01a1fe33-f572-70d8-b290-f52bcce640b3");
    assert.equal(ompRecord!.totals.reasoningTokens, 30);
    assert.equal(ompRecord!.reportedCostUsd, 0.012);
    assert.notEqual(ompRecord!.dedupeKey, piRecord!.dedupeKey);
    assert.include(ompRecord!.dedupeKey ?? "", '"omp"');
  });

  it("counts OMP auxiliary top-level model_usage records while ignoring them for Pi", () => {
    const ompState = ompUsageFormat.state!.initial();
    const piState = piUsageFormat.state!.initial();
    const sessionLine = JSON.stringify({
      type: "session",
      version: 3,
      id: "01a215a6-a7af-72c0-9aec-5a8826790818",
    });
    const assistantLine = JSON.stringify({
      type: "message",
      id: "msg-main",
      timestamp: "2026-11-26T02:20:00.000Z",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt-5.4",
        usage: {
          input: 1000,
          output: 200,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.01 },
        },
      },
    });
    const auxLine = JSON.stringify({
      type: "model_usage",
      id: "b6e80ad0",
      parentId: "fa766957",
      timestamp: "2026-11-26T02:21:08.207Z",
      purpose: "watchdog-agent",
      role: "watchdog-agent",
      provider: "litellm",
      model: "gpt-6.1-terra",
      usage: {
        input: 22336,
        output: 115,
        cacheRead: 22144,
        cacheWrite: 0,
        reasoningTokens: 108,
        cost: { total: 0 },
      },
    });

    ompUsageFormat.parseLine(sessionLine, ompState);
    piUsageFormat.parseLine(sessionLine, piState);
    const [mainRecord] = ompUsageFormat.parseLine(assistantLine, ompState);
    const [auxRecord] = ompUsageFormat.parseLine(auxLine, ompState);
    const [auxDuplicate] = ompUsageFormat.parseLine(auxLine, ompState);
    const piAuxRecords = piUsageFormat.parseLine(auxLine, piState);

    assert.isDefined(mainRecord);
    assert.isDefined(auxRecord);
    assert.equal(auxRecord!.provider, "pi");
    assert.equal(auxRecord!.model, "litellm/gpt-6.1-terra");
    assert.equal(auxRecord!.rateModel, "gpt-6.1-terra");
    assert.equal(auxRecord!.sessionId, "01a215a6-a7af-72c0-9aec-5a8826790818");
    assert.equal(auxRecord!.totals.uncachedInputTokens, 22336);
    assert.equal(auxRecord!.totals.cachedInputTokens, 22144);
    assert.equal(auxRecord!.totals.outputTokens, 115);
    assert.equal(auxRecord!.totals.reasoningTokens, 108);
    assert.isNull(auxRecord!.reportedCostUsd);
    assert.equal(auxRecord!.dedupeKey, auxDuplicate!.dedupeKey);
    assert.notEqual(auxRecord!.dedupeKey, mainRecord!.dedupeKey);
    assert.deepEqual(piAuxRecords, []);
  });
});

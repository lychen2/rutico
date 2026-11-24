import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import { describeAntigravitySubagentLaunches } from "../provider/acp/AntigravityChildWork.ts";
import * as NativeChildWorkQuery from "./NativeChildWorkQuery.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const ROOT = "0a591388-d9d9-439d-a2a0-90932fd25b37";
const CHILD = "0a591388-d9d9-439d-a2a0-90932fd25b38";
const LAUNCH = { role: "Readme Explorer", prompt: "Read README.md and summarize it." };

const instanceId = ProviderInstanceId.make("antigravity");
const childThreadId = ThreadId.make("thread-child");
const launch = describeAntigravitySubagentLaunches([LAUNCH]);

const records = (rootThreadSession: string) => ({
  thread: {
    id: childThreadId,
    creationSource: "provider",
    lineage: { parentThreadId: "thread-parent", relationshipToParent: "subagent" },
    forkedFrom: { type: "node", nodeId: "subagent-new" },
  },
  subagents: [
    {
      id: "subagent-new",
      childThreadId,
      driver: "antigravity",
      origin: "provider_native",
      providerInstanceId: instanceId,
      runId: "run-root",
      nativeTaskRef: { nativeId: "call_11340266277043349041" },
      ...launch,
    },
  ],
  runs: [{ id: "run-root", providerThreadId: "provider-root", activeAttemptId: "attempt-root" }],
  attempts: [{ id: "attempt-root", nativeThreadId: ROOT }],
  providerThreads: [
    {
      id: "provider-root",
      providerInstanceId: instanceId,
      nativeThreadRef: { nativeId: rootThreadSession },
    },
  ],
});

const readChildren = (rootThreadSession = ROOT) =>
  Effect.gen(function* () {
    const query = yield* NativeChildWorkQuery.NativeChildWorkQuery;
    return (yield* query.getNativeChildWork({ threadId: childThreadId })).children;
  }).pipe(
    Effect.provide(
      NativeChildWorkQuery.layer.pipe(
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(records(rootThreadSession) as never),
          }),
        ),
      ),
    ),
  );

it.layer(
  Layer.mergeAll(
    NodeServices.layer,
    NodeCrypto.layer,
    ServerConfig.layerTest(process.cwd(), { prefix: "native-child-work-" }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  ),
)("NativeChildWorkQuery", (it) => {
  it.effect("reads detached JSON subagent work even after rollback moves the root thread", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const { profile } = yield* resolveAntigravityInstanceDirectories(stateDir, instanceId);
      const writeJson = (segments: ReadonlyArray<string>, value: unknown) => {
        const file = path.join(profile, "antigravity-acp", "brain", ...segments);
        return fs
          .makeDirectory(path.dirname(file), { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(file, JSON.stringify(value))));
      };
      yield* writeJson([ROOT, ".system_generated", "subagents", `${CHILD}.json`], {
        conversationId: CHILD,
        subagentDescriptor: { typeName: "research", role: LAUNCH.role },
      });
      yield* writeJson([CHILD, ".system_generated", "messages", "launch.json"], {
        sender: ROOT,
        content: LAUNCH.prompt,
        sourceMetadata: {
          tool: {
            conversationId: ROOT,
            toolCall: {
              id: "call_11340266277043349041",
              name: "invoke_subagent",
              argumentsJson: JSON.stringify({
                TypeName: "research",
                Role: LAUNCH.role,
                Prompt: LAUNCH.prompt,
              }),
            },
          },
        },
      });

      expect((yield* readChildren()).map((child) => child.conversationId)).toEqual([CHILD]);
      const rolledBack = "1a7f8b0c-3c55-4c1e-9a43-5d0e2b6f9c11";
      expect((yield* readChildren(rolledBack)).map((child) => child.conversationId)).toEqual([
        CHILD,
      ]);
    }),
  );
});

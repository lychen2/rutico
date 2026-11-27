import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as AcpErrors from "effect-acp/errors";

import type * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import { makeAcpNativeLoggerFactory } from "./nativeLogging.ts";

const nodeServicesIt = it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer));
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

nodeServicesIt("ACP native logging", (it) => {
  it.effect("records bounded request diagnostics without raw payloads", () =>
    Effect.gen(function* () {
      const records: Array<unknown> = [];
      const nativeEventLogger: ProviderEventLoggers.EventNdjsonLogger = {
        filePath: "/tmp/provider-native.ndjson",
        write: (event) => Effect.sync(() => void records.push(event)),
        close: () => Effect.void,
      };
      const makeLogger = yield* makeAcpNativeLoggerFactory();
      const logger = makeLogger({
        nativeEventLogger,
        provider: ProviderDriverKind.make("cursor"),
        threadId: ThreadId.make("thread-1"),
      });
      const secret = "secret-token-value";
      const requestLogger = logger.requestLogger;
      assert.exists(requestLogger);
      if (!requestLogger) return;

      yield* requestLogger({
        method: "session/prompt",
        payload: { prompt: secret, sessionId: secret },
        status: "failed",
        cause: Cause.fail(AcpErrors.AcpRequestError.internalError(secret, { token: secret })),
      });
      const serialized = encodeUnknownJson(records);
      assert.notInclude(serialized, secret);
      assert.include(serialized, '"method":"session/prompt"');
      assert.include(serialized, '"errorTag":"AcpRequestError"');
      assert.include(serialized, '"reasonCount":1');
    }),
  );

  it.effect("summarizes mcpServers count, names, and transports without logging secrets", () =>
    Effect.gen(function* () {
      const records: Array<unknown> = [];
      const nativeEventLogger: ProviderEventLoggers.EventNdjsonLogger = {
        filePath: "/tmp/provider-native.ndjson",
        write: (event) => Effect.sync(() => void records.push(event)),
        close: () => Effect.void,
      };
      const makeLogger = yield* makeAcpNativeLoggerFactory();
      const logger = makeLogger({
        nativeEventLogger,
        provider: ProviderDriverKind.make("antigravity"),
        threadId: ThreadId.make("thread-mcp"),
      });
      const requestLogger = logger.requestLogger;
      assert.exists(requestLogger);
      if (!requestLogger) return;

      const bearerSecret = "Bearer super-secret-mcp-token";
      yield* requestLogger({
        method: "session/new",
        payload: {
          cwd: "/workspace",
          mcpServers: [
            {
              name: "t3-code",
              command: "/usr/local/bin/t3",
              args: ["acp-mcp-bridge"],
              env: [{ name: "T3_ACP_MCP_AUTHORIZATION", value: bearerSecret }],
            },
            {
              type: "http",
              name: "remote-mcp",
              url: "http://127.0.0.1:43125/mcp",
              headers: [{ name: "Authorization", value: bearerSecret }],
            },
          ],
        },
        status: "succeeded",
      });
      const serialized = encodeUnknownJson(records);
      assert.notInclude(serialized, bearerSecret);
      assert.notInclude(serialized, "43125");
      assert.include(
        serialized,
        '"mcpServers":{"count":2,"servers":[{"name":"t3-code","transport":"stdio"},{"name":"remote-mcp","transport":"http"}]}',
      );
    }),
  );

  it.effect("preserves native writer interruption", () =>
    Effect.gen(function* () {
      const makeLogger = yield* makeAcpNativeLoggerFactory();
      const logger = makeLogger({
        nativeEventLogger: {
          filePath: "/tmp/provider-native.ndjson",
          write: () => Effect.interrupt,
          close: () => Effect.void,
        },
        provider: ProviderDriverKind.make("cursor"),
        threadId: ThreadId.make("thread-1"),
      });
      const requestLogger = logger.requestLogger;
      assert.exists(requestLogger);
      if (!requestLogger) return;

      const exit = yield* requestLogger({
        method: "session/prompt",
        payload: {},
        status: "started",
      }).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
      }
    }),
  );
});

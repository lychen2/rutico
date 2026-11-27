import type { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Cause from "effect/Cause";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import {
  structuralProtocolMethod,
  summarizeNativeProtocolPayload,
} from "@t3tools/provider-core/server/nativeProtocolLogging";
import type * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const MAX_LOGGED_MCP_SERVERS = 16;

function summarizeMcpServers(payload: unknown) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const raw = (payload as { readonly mcpServers?: unknown }).mcpServers;
  if (!Array.isArray(raw)) return undefined;
  const servers = raw.slice(0, MAX_LOGGED_MCP_SERVERS).map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { name: "unknown", transport: "unknown" };
    }
    const record = entry as {
      readonly name?: unknown;
      readonly type?: unknown;
      readonly command?: unknown;
      readonly url?: unknown;
    };
    const name =
      typeof record.name === "string" && record.name.length > 0
        ? record.name.slice(0, 64)
        : "unknown";
    const transport =
      typeof record.type === "string" && record.type.length > 0
        ? record.type.slice(0, 32)
        : typeof record.command === "string"
          ? "stdio"
          : typeof record.url === "string"
            ? "http"
            : "unknown";
    return { name, transport };
  });
  return { count: raw.length, servers };
}

function formatRequestLogPayload(event: AcpSessionRuntime.AcpSessionRequestLogEvent) {
  const mcpServers = summarizeMcpServers(event.payload);
  return {
    method: structuralProtocolMethod(event.method),
    status: event.status,
    request: summarizeNativeProtocolPayload(event.payload),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(event.result !== undefined ? { result: summarizeNativeProtocolPayload(event.result) } : {}),
    ...(event.cause !== undefined
      ? {
          errorTag: causeErrorTag(event.cause),
          reasonCount: event.cause.reasons.length,
        }
      : {}),
  };
}

export const makeAcpNativeLoggerFactory = Effect.fn("makeAcpNativeLoggerFactory")(function* () {
  const random = yield* SecureRandom.SecureRandom;
  return (input: {
    readonly nativeEventLogger: ProviderEventLoggers.EventNdjsonLogger | undefined;
    readonly provider: ProviderDriverKind;
    readonly threadId: ThreadId;
  }): Pick<AcpSessionRuntime.AcpSessionRuntimeOptions, "requestLogger" | "protocolLogging"> => {
    const writeNativeAcpLog = Effect.fn("AcpNativeLogging.writeNativeAcpLog")(
      function* (logInput: { readonly kind: "request"; readonly payload: unknown }) {
        if (!input.nativeEventLogger) return;
        const observedAt = DateTime.formatIso(yield* DateTime.now);
        yield* input.nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: yield* random.uuidV4(),
              kind: logInput.kind,
              provider: input.provider,
              createdAt: observedAt,
              threadId: input.threadId,
              payload: logInput.payload,
            },
          },
          input.threadId,
        );
      },
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.logWarning("Failed to write native ACP event log.", {
              errorTag: causeErrorTag(cause),
              reasonCount: cause.reasons.length,
              provider: input.provider,
              threadId: input.threadId,
            }),
      ),
    );

    return {
      requestLogger: (event: AcpSessionRuntime.AcpSessionRequestLogEvent) =>
        writeNativeAcpLog({
          kind: "request",
          payload: formatRequestLogPayload(event),
        }),
    };
  };
});

import { Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it, vi } from "vite-plus/test";

const { otlpTracerMakeMock } = vi.hoisted(() => ({
  otlpTracerMakeMock: vi.fn((_options: unknown) =>
    Effect.succeed(Tracer.make({ span: (opts) => new Tracer.NativeSpan(opts) })),
  ),
}));

vi.mock("effect/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect/observability")>();
  return {
    ...actual,
    OtlpTracer: {
      ...actual.OtlpTracer,
      make: otlpTracerMakeMock,
    },
  };
});

vi.mock("../state/server", async () => {
  const { Atom: ReactivityAtom } = await import("effect/reactivity");
  return {
    primaryServerConfigAtom: ReactivityAtom.make<{
      readonly observability: { readonly otlpTracesEnabled: boolean };
    } | null>(null),
  };
});

vi.mock("../environments/primary", () => ({
  resolvePrimaryEnvironmentHttpUrl: (path: string) => `http://127.0.0.1:3773${path}`,
}));

vi.mock("../environments/primary/httpLayer", () => ({
  layer: Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))),
    ),
  ),
}));

import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerConfigAtom } from "../state/server";
import * as ClientTracer from "./clientTracer";
import { CLIENT_TRACING_RESOURCE, configureClientTracing } from "./clientTracing";

const mockServerConfigAtom = primaryServerConfigAtom as unknown as Atom.Writable<{
  readonly observability: { readonly otlpTracesEnabled: boolean };
} | null>;

describe("clientTracing", () => {
  it("omits browser fingerprint attributes from the client tracing resource", () => {
    const attributes: Record<string, unknown> = CLIENT_TRACING_RESOURCE.attributes;
    expect(attributes["user_agent.original"]).toBeUndefined();
    expect(attributes["browser.language"]).toBeUndefined();
    expect(attributes["browser.platform"]).toBeUndefined();
    expect(attributes["browser.mobile"]).toBeUndefined();
    expect(attributes["browser.brands"]).toBeUndefined();
  });

  it("enables the OTLP trace delegate only when the server enables otlpTracesEnabled", async () => {
    otlpTracerMakeMock.mockClear();

    try {
      appAtomRegistry.set(mockServerConfigAtom, null);
      await configureClientTracing();
      expect(ClientTracer.hasDelegate()).toBe(false);
      expect(otlpTracerMakeMock).not.toHaveBeenCalled();

      appAtomRegistry.set(mockServerConfigAtom, {
        observability: { otlpTracesEnabled: false },
      });
      await configureClientTracing();
      expect(ClientTracer.hasDelegate()).toBe(false);
      expect(otlpTracerMakeMock).not.toHaveBeenCalled();

      appAtomRegistry.set(mockServerConfigAtom, {
        observability: { otlpTracesEnabled: true },
      });
      await configureClientTracing();
      expect(ClientTracer.hasDelegate()).toBe(true);
      expect(otlpTracerMakeMock).toHaveBeenCalledTimes(1);
      expect(otlpTracerMakeMock.mock.calls[0]?.[0]).toMatchObject({
        url: "http://127.0.0.1:3773/api/observability/v1/traces",
        resource: CLIENT_TRACING_RESOURCE,
      });

      appAtomRegistry.set(mockServerConfigAtom, {
        observability: { otlpTracesEnabled: false },
      });
      await configureClientTracing();
      expect(ClientTracer.hasDelegate()).toBe(false);
    } finally {
      appAtomRegistry.set(mockServerConfigAtom, null);
      await configureClientTracing();
    }
  });
});

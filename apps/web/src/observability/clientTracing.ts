import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import { HttpClient } from "effect/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability";

import { settleAsyncResult, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary";
import { releaseChannelOf, releaseResourceAttributes } from "@t3tools/shared/releaseResource";
import * as ClientTracer from "./clientTracer";
import * as PrimaryEnvironmentHttpLayer from "../environments/primary/httpLayer";
import { isElectron } from "../env";
import { APP_VERSION } from "~/branding";
import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import { primaryServerConfigAtom } from "../state/server";

const DEFAULT_EXPORT_INTERVAL_MS = 1_000;

// PR previews can't mark themselves in APP_VERSION without breaking the version-skew check against the server.
const RELEASE_CHANNEL =
  import.meta.env.DEV || import.meta.env.VITE_RELEASE_CHANNEL === "dev"
    ? "dev"
    : import.meta.env.VITE_RELEASE_CHANNEL === "preview"
      ? "preview"
      : releaseChannelOf(APP_VERSION);
export const CLIENT_TRACING_RESOURCE = {
  serviceName: "t3code-web",
  attributes: {
    "service.namespace": "t3code",
    "service.instance.id": ClientTracer.serviceInstanceId,
    ...releaseResourceAttributes(RELEASE_CHANNEL),
    "service.runtime": "t3-web",
    "t3code.client.surface": isElectron ? "desktop" : "web",
    "service.version": APP_VERSION,
  },
} as const;

const layerDelegateRuntime = Layer.mergeAll(
  PrimaryEnvironmentHttpLayer.layer,
  OtlpExporter.layerFlusher,
  OtlpSerialization.layerJson,
  Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
);

let activeRuntime: ManagedRuntime.ManagedRuntime<never, never> | null = null;
let activeScope: Scope.Closeable | null = null;
let activeConfigKey: string | null = null;
let pendingConfiguration = Promise.resolve();
let subscribedToServerConfig = false;

export function configureClientTracing(): Promise<void> {
  if (!subscribedToServerConfig) {
    subscribedToServerConfig = true;
    subscribeAtomChanges(primaryServerConfigAtom, () => {
      pendingConfiguration = pendingConfiguration.finally(() => applyClientTracingConfig());
    });
  }
  pendingConfiguration = pendingConfiguration.finally(() => applyClientTracingConfig());
  return pendingConfiguration;
}

async function applyClientTracingConfig(): Promise<void> {
  const tracesEnabled =
    appAtomRegistry.get(primaryServerConfigAtom)?.observability.otlpTracesEnabled === true;

  if (!tracesEnabled) {
    if (activeConfigKey === "disabled" && !ClientTracer.hasDelegate()) {
      return;
    }
    activeConfigKey = "disabled";
    const previousRuntime = activeRuntime;
    const previousScope = activeScope;

    ClientTracer.setDelegate(null);
    activeRuntime = null;
    activeScope = null;

    await disposeTracerRuntime(previousRuntime, previousScope);
    return;
  }

  const otlpTracesUrl = resolvePrimaryEnvironmentHttpUrl("/api/observability/v1/traces");
  const exportIntervalMs = DEFAULT_EXPORT_INTERVAL_MS;
  const nextConfigKey = `${otlpTracesUrl}|${exportIntervalMs}`;

  if (activeConfigKey === nextConfigKey && ClientTracer.hasDelegate()) {
    return;
  }

  activeConfigKey = nextConfigKey;

  const previousRuntime = activeRuntime;
  const previousScope = activeScope;

  ClientTracer.setDelegate(null);
  activeRuntime = null;
  activeScope = null;

  await disposeTracerRuntime(previousRuntime, previousScope);

  const runtime = ManagedRuntime.make(layerDelegateRuntime);
  const scope = runtime.runSync(Scope.make());

  const delegateResult = await settleAsyncResult(() =>
    runtime.runPromiseExit(
      Scope.provide(scope)(
        OtlpTracer.make({
          url: otlpTracesUrl,
          exportInterval: `${exportIntervalMs} millis`,
          resource: CLIENT_TRACING_RESOURCE,
        }),
      ),
    ),
  );
  if (delegateResult._tag === "Failure") {
    await disposeTracerRuntime(runtime, scope);

    const error = squashAtomCommandFailure(delegateResult);
    const tracesUrl = new URL(otlpTracesUrl);
    console.warn("Failed to configure client tracing exporter", {
      scheme: tracesUrl.protocol.replace(/:$/, ""),
      host: tracesUrl.hostname,
      port: tracesUrl.port || undefined,
      exportIntervalMs,
      ...safeErrorLogAttributes(error),
    });
    return;
  }

  ClientTracer.setDelegate(delegateResult.value);
  activeRuntime = runtime;
  activeScope = scope;
}

async function disposeTracerRuntime(
  runtime: ManagedRuntime.ManagedRuntime<never, never> | null,
  scope: Scope.Closeable | null,
): Promise<void> {
  if (runtime === null || scope === null) {
    return;
  }

  await settleAsyncResult(() => runtime.runPromiseExit(Scope.close(scope, Exit.void)));
  runtime.dispose();
}

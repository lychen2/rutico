import type { EnvironmentId, UsageModelFilter, UsageSummaryInput } from "@t3tools/contracts";
import {
  USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS,
  USAGE_LIMITS_FAILURE_COOLDOWN_MS,
} from "@t3tools/shared/usageLimits";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";

import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import type { createEnvironmentPresentationAtoms } from "./presentation.ts";
import { executeAtomQuery, runAtomCommand, squashAtomCommandFailure } from "./runtime.ts";
import type { createServerEnvironmentAtoms } from "./server.ts";

const isEnvironmentRpcUnavailable = Schema.is(EnvironmentRpcUnavailableError);

/** The Usage tab asks each environment with that environment's configured model filter. */
export function usageSummaryInput(
  input: UsageSummaryInput,
  modelFilter: UsageModelFilter | undefined,
): UsageSummaryInput {
  return modelFilter === undefined ? input : { ...input, modelFilter };
}

const limitsRefreshAfter = new Map<EnvironmentId, number>();
const limitsRefreshes = new Map<EnvironmentId, Promise<unknown>>();

function isFailedRefreshResult(value: unknown): boolean {
  return Predicate.isObject(value) && "_tag" in value && value._tag === "Failure";
}

export async function refreshUsageLimits<A>(
  environmentId: EnvironmentId,
  refresh: () => Promise<A>,
  automatic = false,
): Promise<A | undefined> {
  const pending = limitsRefreshes.get(environmentId);
  if (pending !== undefined) {
    return automatic ? undefined : ((await pending) as A);
  }
  const refreshAfter = limitsRefreshAfter.get(environmentId) ?? 0;
  // @effect-diagnostics-next-line globalDate:off
  if (automatic && Date.now() < refreshAfter) return;
  let succeeded = false;
  const current = Promise.resolve()
    .then(refresh)
    .then((value) => {
      succeeded = !isFailedRefreshResult(value);
      return value;
    })
    .finally(() => {
      limitsRefreshes.delete(environmentId);
      const cooldownMs = succeeded
        ? USAGE_LIMITS_AUTO_REFRESH_COOLDOWN_MS
        : USAGE_LIMITS_FAILURE_COOLDOWN_MS;
      // @effect-diagnostics-next-line globalDate:off
      limitsRefreshAfter.set(environmentId, Date.now() + cooldownMs);
    });
  limitsRefreshes.set(environmentId, current);
  return await current;
}

export async function refreshUsage({
  registry,
  server,
  presentations,
  environmentIds,
  input,
}: {
  registry: AtomRegistry.AtomRegistry;
  server: Pick<
    ReturnType<typeof createServerEnvironmentAtoms>,
    "usageSummary" | "refreshUsageRates" | "usageModelFilterAtom"
  >;
  presentations: Pick<ReturnType<typeof createEnvironmentPresentationAtoms>, "presentationAtom">;
  environmentIds: readonly EnvironmentId[];
  input: UsageSummaryInput;
}): Promise<void> {
  await Promise.all(
    environmentIds.map(async (environmentId) => {
      const query = server.usageSummary({
        environmentId,
        input: usageSummaryInput(input, registry.get(server.usageModelFilterAtom(environmentId))),
      });
      const presentation = presentations.presentationAtom(environmentId);
      const controller = new AbortController();
      const abortWhenDisconnected = () => {
        if (registry.get(presentation)?.connection.phase !== "connected") controller.abort();
      };
      const unsubscribe = registry.subscribe(presentation, abortWhenDisconnected);
      abortWhenDisconnected();
      try {
        const ratesResult = await runAtomCommand(
          registry,
          server.refreshUsageRates,
          { environmentId, input: {} },
          { reportFailure: false },
        );
        const sessionUnavailable =
          ratesResult._tag === "Failure" &&
          isEnvironmentRpcUnavailable(squashAtomCommandFailure(ratesResult));
        registry.refresh(query);
        if (sessionUnavailable || controller.signal.aborted) return;
        await executeAtomQuery(registry, query, {
          reportFailure: false,
          signal: controller.signal,
        });
      } finally {
        unsubscribe();
      }
    }),
  );
}

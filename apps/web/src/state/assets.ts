import type { ProjectFaviconTarget } from "@t3tools/client-runtime/project-favicon-cache";
import {
  createAssetEnvironmentAtoms,
  createProjectFaviconUrlAtomFamily,
  projectFaviconResource,
} from "@t3tools/client-runtime/state/assets";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { projectFaviconCache } from "../assets/projectFaviconCache";
import { isElectron } from "../env";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { environmentProjectClonesAtom } from "./projectClones";
import { environmentSession } from "./session";
import { environmentThreadDetails } from "./threads";

const localMediaEnvironment = Atom.make((get) => {
  if (!isElectron) return null;
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  const connection = get(environmentSession.preparedConnectionValueAtom(environmentId));
  const config = get(environmentSession.initialConfigValueAtom(environmentId));
  return connection._tag === "None" || config === null
    ? null
    : { environmentId, httpBaseUrl: connection.value.httpBaseUrl };
});

export const assetEnvironment = createAssetEnvironmentAtoms(
  connectionAtomRuntime,
  localMediaEnvironment,
);

export const threadArtifactsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:assets:list-thread-artifacts",
  tag: WS_METHODS.assetsListThreadArtifacts,
  staleTimeMs: 0,
  idleTtlMs: 0,
  refreshTrigger: ({ environmentId, input: { threadId } }) => {
    const threadRef = { environmentId, threadId };
    const workspaceMutation = environmentThreadDetails.workspaceMutationIdAtom(threadRef);
    const thread = environmentThreadDetails.quietThreadAtom(threadRef);
    return Atom.make((get) => {
      const mutation = get(workspaceMutation);
      const latestRun = get(thread)?.projection.runs.at(-1);
      return JSON.stringify([mutation, latestRun?.id, latestRun?.status]);
    }).pipe(Atom.setIdleTTL(0));
  },
});

export const projectFaviconUrlAtom = createProjectFaviconUrlAtomFamily({
  imageCache: projectFaviconCache,
  createUrl: assetEnvironment.createUrl,
  preparedConnection: environmentSession.preparedConnectionValueAtom,
  projectClones: environmentProjectClonesAtom,
});

/**
 * Asks the server for a project's icon again. Choosing the icon path a project had before would
 * otherwise reuse that path's cached URL, which says "missing" if the file did not exist then.
 */
export function refreshProjectFaviconUrl(target: ProjectFaviconTarget) {
  appAtomRegistry.refresh(
    assetEnvironment.createUrl({
      environmentId: target.environmentId,
      input: { resource: projectFaviconResource(target.cwd, target.faviconPath) },
    }),
  );
}

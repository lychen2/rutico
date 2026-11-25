// User-wide ~/.pi/agent state makes continuation identity use default instance grouping.
import type { ServerProvider } from "@t3tools/contracts";
import { OmpSettings, PiSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { ompUsageReader, piUsageReader } from "./usage.ts";
import { makePiTextGeneration } from "./textGeneration.ts";
import {
  OMP_PROVIDER,
  PI_PROVIDER,
  PiAdapterV2Driver,
  makePiAdapterDriver,
  type PiAdapterV2DriverEnv,
} from "./adapter.ts";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import {
  buildInitialPiProviderSnapshot,
  buildInitialOmpSnapshot,
  checkOmpStatus,
  discoverOmpInventory,
  checkPiProviderStatus,
  discoverPiCommandsForCwd,
  enrichPiSnapshot,
} from "./status.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import {
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { EMPTY_PI_MODEL_CAPABILITIES } from "./modelCapabilities.ts";
import {
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@t3tools/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";

const DRIVER_KIND = PI_PROVIDER;
const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@earendil-works/pi-coding-agent",
  mise: { tool: "pi" },
  nativeUpdate: { args: ["update", "--self"] },
});

export type PiDriverEnv =
  | PiAdapterV2DriverEnv
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ProviderLatestVersions.ProviderLatestVersions
  | Path.Path;

const OmpAdapterV2Driver = makePiAdapterDriver(OMP_PROVIDER, OmpSettings);
const decodeOmpSettings = Schema.decodeSync(OmpSettings);

export const OmpDriver: ProviderDriver<PiSettings, PiDriverEnv, FileSystem.FileSystem | Path.Path> =
  {
    driverKind: OMP_PROVIDER,
    metadata: { displayName: "OMP", supportsMultipleInstances: true },
    usage: ompUsageReader,
    configSchema: OmpSettings,
    defaultConfig: () => decodeOmpSettings({}),
    create: Effect.fn("OmpDriver.create")(
      function* (input) {
        const host = yield* ProviderHost.ProviderHost;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const probeCwd = path.join(host.paths.providerStatusCacheDir, "omp-status-probe");
        const environment = yield* mergeProviderInstanceEnvironment(input.environment);
        const settings = { ...input.config, enabled: input.enabled };
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind: OMP_PROVIDER,
          instanceId: input.instanceId,
        });
        const stampIdentity = withInstanceIdentity(
          {
            ...input,
            accentColor: input.accentColor,
            continuationGroupKey: continuationIdentity.continuationKey,
          },
          OMP_PROVIDER,
        );
        const snapshotSettings = yield* makeProviderSnapshotSettingsSource(settings);
        const orchestrationAdapter = yield* OmpAdapterV2Driver.create(input);
        const snapshot = yield* makeManagedServerProvider({
          resolveMaintenance: () =>
            Effect.succeed({ provider: OMP_PROVIDER, packageName: null, update: null }),
          getSettings: snapshotSettings.getSettings,
          streamSettings: snapshotSettings.streamSettings,
          haveSettingsChanged: haveProviderSnapshotSettingsChanged,
          initialSnapshot: (current) =>
            buildInitialOmpSnapshot(current.provider).pipe(Effect.map(stampIdentity)),
          checkProvider: fs
            .makeDirectory(probeCwd, { recursive: true })
            .pipe(
              Effect.ignore,
              Effect.andThen(checkOmpStatus(settings, environment, probeCwd)),
              Effect.map(stampIdentity),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            ),
        });
        const textGeneration = yield* makePiTextGeneration(
          settings,
          environment,
          host.compatibility,
          true,
        );
        return {
          instanceId: input.instanceId,
          driverKind: OMP_PROVIDER,
          continuationIdentity,
          displayName: input.displayName,
          accentColor: input.accentColor,
          enabled: input.enabled,
          snapshot,
          orchestrationAdapter,
          textGeneration,
          snapshotForCwd: (cwd: string) =>
            !settings.enabled
              ? snapshot.getSnapshot
              : Effect.all([
                  snapshot.getSnapshot,
                  discoverOmpInventory(settings, environment, cwd).pipe(
                    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                  ),
                ]).pipe(
                  Effect.map(([base, inventory]) => {
                    const workspaceModels = providerModelsFromSettings(
                      [
                        ...base.models.filter((model) => model.slug === "default"),
                        ...inventory.models,
                      ],
                      settings.customModels,
                      EMPTY_PI_MODEL_CAPABILITIES,
                    );
                    return {
                      ...base,
                      slashCommands: inventory.slashCommands,
                      skills: inventory.skills,
                      ...(Equal.equals(base.models, workspaceModels) ? {} : { workspaceModels }),
                    };
                  }),
                  Effect.catch(() =>
                    Effect.map(snapshot.getSnapshot, (base) => ({
                      ...base,
                      slashCommandsPending: true,
                      workspaceModelsPending: true,
                    })),
                  ),
                ),
        };
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: OMP_PROVIDER,
                instanceId: input.instanceId,
                detail: "Failed to create OMP provider.",
                cause,
              }),
          ),
        ),
    ),
  };

const decodePiSettings = Schema.decodeSync(PiSettings);
const withInstanceIdentity =
  (
    input: {
      readonly instanceId: ProviderInstance["instanceId"];
      readonly displayName: string | undefined;
      readonly accentColor: string | undefined;
      readonly continuationGroupKey: string;
    },
    driver = PI_PROVIDER,
  ) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const PiDriver: ProviderDriver<PiSettings, PiDriverEnv, Path.Path> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Pi",
    supportsMultipleInstances: true,
  },
  usage: piUsageReader,
  configSchema: PiSettings,
  defaultConfig: (): PiSettings => decodePiSettings({}),
  create: Effect.fn("PiDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const host = yield* ProviderHost.ProviderHost;
    // Pi runs extensions' session_start in its cwd; the server's cwd is $HOME on packaged desktop.
    const probeCwd = pathService.join(host.paths.providerStatusCacheDir, "pi-status-probe");
    const processEnv = yield* mergeProviderInstanceEnvironment(environment);
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const effectiveConfig = { ...config, enabled } satisfies PiSettings;
    const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
      resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
      ),
    );

    const orchestrationAdapter = yield* PiAdapterV2Driver.create({
      instanceId,
      displayName,
      accentColor,
      environment,
      enabled,
      config,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Pi orchestration adapter.",
            cause,
          }),
      ),
    );
    const textGeneration = yield* makePiTextGeneration(
      effectiveConfig,
      processEnv,
      host.compatibility,
    );

    const checkProvider = fileSystem
      .makeDirectory(probeCwd, { recursive: true })
      .pipe(
        Effect.ignore,
        Effect.andThen(
          checkPiProviderStatus(effectiveConfig, processEnv, probeCwd, host.compatibility),
        ),
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<PiSettings>>({
      resolveMaintenance,
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        buildInitialPiProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
      checkProvider,
      enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
        resolveMaintenance().pipe(
          Effect.flatMap((maintenanceCapabilities) =>
            enrichPiSnapshot({
              snapshot: currentSnapshot,
              maintenanceCapabilities,
              enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              publishSnapshot,
            }),
          ),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
        ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Pi snapshot.",
            cause,
          }),
      ),
    );

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      snapshotForCwd: (workspaceCwd) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              discoverPiCommandsForCwd(effectiveConfig, processEnv, workspaceCwd).pipe(
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Effect.mapError(
                  (cause) =>
                    new ProviderDriverError({
                      driver: DRIVER_KIND,
                      instanceId,
                      detail: "Failed to discover Pi workspace commands.",
                      cause,
                    }),
                ),
              ),
            ]).pipe(
              Effect.map(([machineSnapshot, commands]) => ({
                ...machineSnapshot,
                ...commands,
                slashCommandsPending: false,
              })),
            ),
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};

# Repository Guidelines

## Project Overview

T3 Code controls coding agents using existing provider accounts. A Node server owns execution and workspace data; web, desktop, and mobile clients control it locally or remotely.

## Architecture & Data Flow

Typed WebSocket RPC → V2 command → SQLite commit (events, projections, receipt, outbox) → post-commit worker → provider adapter → client projection. Commands serialize per thread; a receipt confirms intent, not provider completion. Reuse command IDs on retry. Check persisted replay and older clients when changing wire schemas. Checkpoints use hidden Git refs.

`packages/client-runtime` owns connections, reconnects, and state atoms per environment. Clients supply platform services; remote operations target the owning environment. See the [architecture guide](docs/internals/overview.md).

OMP is built in alongside Pi. It launches `omp --mode rpc-ui`; the adapter maps todos into shared plan events. Check extension changes with the installed OMP loader and tool/RPC APIs.

## Key Directories

- `apps/server`: RPC, orchestration, persistence, checkpoints. `packages/provider-*`: adapters and test support.
- `apps/web`: React/Vite UI. `apps/desktop`: Electron host and IPC around web. `apps/mobile`: Expo/React Native client. `apps/marketing`: Astro site.
- `packages/contracts`: Effect Schema wire types. `packages/client-runtime`: shared client logic. `packages/shared`: utilities with subpath exports, no barrel.

## Development Commands

From the root, use `vp i`, `vp run dev` (server + web), or `vp run dev:desktop`. Build with `vp run build` or `vp run build:desktop`. For mobile, install with `vp run mobile:install ios [device-id]` (or `android`), then run `vp run dev:client` in `apps/mobile`.

Use `vp test run <files> -t '<name>'`, `vp lint <files>`, `vp fmt --check <files>`, and `vp run --filter @t3tools/web typecheck`. Before pushing, run `vp run check:changed`. See [development](docs/operations/development.md) and [release](docs/operations/release.md). Verify UI changes before switching installs; build Windows and Android release artifacts from the same verified commit.

<a name="taste"></a>

## Code Conventions & Common Patterns

- Keep RPC, HTTP, and MCP handlers thin: decode, call a domain service, map typed errors. Use `Context.Service`, `yield*` dependencies, layers, and `Schema.TaggedError` with structured context. Use `Effect.fn("Service.operation")` for reusable operations, `Effect.gen` for inline programs, and scopes for resources. Read [Effect services](docs/internals/effect-services.md) for server work.
- Use `createEnvironmentRpcCommand` for RPC mutations. Extend `CLIENT_GUARDED_RPC_SCOPES` and use `permissionAtom` for protected actions; verify destination grants at execution. Keep raw RPC in `rpc/`.
- Derive React state in render; act in handlers. Justify effects that synchronize external systems. Use UI primitive variants, not call-site restyles. See [web UI](docs/internals/web-ui.md) for React Compiler and composition rules.
- Prefer inference, `import type`, and short invariant comments. Match nearby names (`WorkspacePaths.ts`, `*.logic.test.ts`). Check applicable clients, entry points, adapters, MCP/schedules, connection modes, reverse actions, and [translations](docs/internals/i18n.md).

### Documentation

Update existing docs when a contract changes: `docs/internals/` for constraints, `docs/user/` for workflows, `docs/operations/` for runbooks. Do not commit scratch work or PR evidence. Open PRs only on request; check the forge and [CONTRIBUTING.md](CONTRIBUTING.md).

## Important Files

- Server: `apps/server/src/bin.ts`, `server.ts`, `ws.ts`, and `orchestration-v2/{Orchestrator,EventSink,EffectWorker}.ts`.
- Wire: `packages/contracts/src/{rpc,orchestrationV2}.ts`. OMP: `packages/provider-pi/src/server/{driver,adapter,mcpInjection}.ts`.
- Client entries: `apps/web/src/bootstrap.ts`, `apps/desktop/src/main.ts` and `preload.ts`, `apps/mobile/index.ts`.
- Tooling: `vite.config.ts` (tasks, tests, fmt/lint), `pnpm-workspace.yaml` (catalogs/patches), `tsconfig.{base,effect}.json`, `t3.json` (worktree setup).

## Runtime/Tooling Preferences

- Use Vite+ with the Node 26.13.1 and pnpm 12.14.0 pins in `package.json`, not Bun except for scripts that require it. Use package tasks (`effect-tsgo tsrs --noEmit`; Astro for marketing). `.repos/` is read-only reference source; never import it.
- Wait while `.t3/setup-running` names a live PID; inspect `.t3/setup-failed` on failure. Use worktree `.t3` or an explicit `--home-dir`; never write to or run dev against `~/.t3/userdata`.
- Stop only your own process tree using tracked PIDs, never name/path patterns. Do not detach without permission. Never set `VITE_HTTP_URL` or `VITE_WS_URL`; use `vp run dev --share` and give the tester the pairing URL privately without consuming it.

## Testing & QA

### Verifying

Use Vitest via `vp`: logic in Node, web `*.browser.test.{ts,tsx}` in Chromium/Playwright with `await using screen = await render(...)` from `apps/web/test/render.tsx`. Test backend behavior at the lowest failing layer. Extend existing cases first. No coverage threshold; leave repo-wide checks to CI unless asked.

Drain `OrchestrationEffectWorkerV2` or await persisted events or `Deferred`; no sleeps, polling, retries, or per-test timeouts. Follow the [test policy](docs/internals/testing.md) for deterministic fixtures and regression proof. The primary agent verifies visible changes once with `test-t3-app` or `test-t3-mobile`; use Replay (dev) unless a real provider is required. Use [scenarios](docs/operations/scenarios.md) for base/head proof, [evals](evals/README.md) for prompts/MCP copy, and [SECURITY.md](SECURITY.md) before audits.

### Test data

With dev stopped, `vp run migrate-dev-db` refreshes isolated V2 state. For plain clones pass `--base-dir <clone>/.t3`, then launch with `--home-dir <clone>/.t3`. Copy from live state read-only; never symlink or copy back.

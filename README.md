<p align="center">
  <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="Rutico logo" />
</p>

<h1 align="center">Rutico</h1>

<p align="center">Unofficial privacy-hardened desktop, web, and mobile workbench for coding agents with native Oh My Pi (OMP) and Antigravity support.</p>

> [!IMPORTANT]
> **Unofficial Fork Notice**: **Rutico** is an independent, unofficial derivative project based on the MIT-licensed source code of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). It is **not** affiliated with, endorsed by, sponsored by, or maintained by T3 Tools, Inc. See [TRADEMARK.md](./TRADEMARK.md).

## Highlights

- **Native Oh My Pi (OMP) integration**: Built-in `omp --mode rpc-ui` adapter mapping native tool intents, to-do phases, and subagent lifecycle events into the shared timeline.
- **Native Antigravity ACP integration**: Runs native `agy` over ACP as a thin client using your local CLI configuration, with direct local quota reporting.
- **Privacy-hardened local runtime**: Telemetry/analytics stripped, process argument redaction enabled, and hard deletion of removed thread history.
- **Custom Rutico branding & frosted glass workspace**: Wisteria/lavender palette, persistent anime backdrop with frosted glass surfaces across desktop/web and Android, plus full-bleed adaptive icons.
- **Multi-environment & Git worktrees**: Control Claude Code, Codex, OMP, Antigravity, Pi, OpenCode, Cursor, Kiro, and ACP agents across local machines, SSH hosts, and Tailscale.

## Development & Build

```bash
# Install dependencies (Node 26.13.1 & pnpm 12.14.0 via Vite+)
vp i

# Start web + server in development mode
vp run dev

# Start desktop app in development mode
vp run dev:desktop

# Build desktop & server bundles
vp run build:desktop

# Run repository change checks
vp run check:changed
```

See [docs/README.md](./docs/README.md) for architecture internals and platform packaging runbooks.

## License

The source code in this repository is licensed under the [MIT License](./LICENSE).

## Trademarks

The MIT License covers **only** the source code. **T3 Code**, **T3 Connect**, **T3 Tools**, official `T3` wordmarks/icons, and official domains (`t3.codes`, `app.t3.codes`) remain the trademarks of T3 Tools, Inc.; Rutico uses independent branding in accordance with [TRADEMARK.md](./TRADEMARK.md).

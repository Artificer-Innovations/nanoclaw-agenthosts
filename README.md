# nanoclaw-agenthosts

Pluggable **agent process lifecycle** for NanoClaw: wake / kill / isRunning / orphans via a `RuntimeDriver` registry, with today’s Docker behavior as the default.

One NanoClaw instance can register many runtimes (`docker`, `process`, `applenative`, `fly`, …). Each agent group selects one via `container_configs.runtime` (same mental model as `provider`).

## Quick start

```bash
pnpm add nanoclaw-agenthosts
pnpm exec nanoclaw-agenthosts sync-skill
pnpm exec nanoclaw-agenthosts install
pnpm run build
pnpm exec nanoclaw-agenthosts verify
```

Local peer loop against `nanoclaw-sandbox`:

```bash
cd ../nanoclaw-sandbox
pnpm agenthosts:local
pnpm exec nanoclaw-agenthosts verify
```

## Select a runtime

```bash
ncl groups config update --id <ag> --runtime process
ncl groups create --name "Fly scout" --folder fly-scout --runtime fly
```

Default when unset: `docker` (or `NANOCLAW_DEFAULT_RUNTIME`).

## Development

```bash
pnpm install
pnpm run build
pnpm run test:unit
pnpm run test:coverage
pnpm run test:integration
```

See [QUICKSTART.md](./QUICKSTART.md), [api-contract.md](./api-contract.md), and `.claude/skills/add-agenthosts/` after `sync-skill`.

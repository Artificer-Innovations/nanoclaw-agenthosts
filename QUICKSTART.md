# Quickstart

## Published package

```bash
pnpm add nanoclaw-agenthosts
pnpm exec nanoclaw-agenthosts sync-skill
pnpm exec nanoclaw-agenthosts install
pnpm run build
pnpm exec nanoclaw-agenthosts verify
# restart NanoClaw host
```

## Local development (nanoclaw-sandbox)

```bash
# in nanoclaw-agenthosts
pnpm install && pnpm run build

# in nanoclaw-sandbox
pnpm agenthosts:local
pnpm exec nanoclaw-agenthosts verify
# restart host — docker agents should behave unchanged

# after edits in the peer package:
pnpm agenthosts:rebuild-local
```

Override peer path: `NANOCLAW_AGENTHOSTS_DIR=/path/to/nanoclaw-agenthosts pnpm agenthosts:local`

## Per-group runtime

```bash
ncl groups config update --id ag-local --runtime process
ncl groups config update --id ag-cloud --runtime fly --session-transport http
ncl groups create --folder scout --name Scout --runtime fly
```

Install plugin packages before selecting non-docker runtimes.

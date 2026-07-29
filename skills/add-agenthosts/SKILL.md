---
name: add-agenthosts
description: Install pluggable agent process lifecycle (RuntimeDriver registry) with Docker as the default. Enables per-group runtime selection (docker | process | applenative | fly | …) via container_configs.runtime.
---

# Add agenthosts

Pluggable **agent process lifecycle** for NanoClaw: `wake` / `kill` / `isRunning` / orphan cleanup via a `RuntimeDriver` registry. Docker remains the default; product packages register additional drivers.

## Install

```bash
pnpm add nanoclaw-agenthosts
pnpm exec nanoclaw-agenthosts sync-skill
pnpm exec nanoclaw-agenthosts install
pnpm install
pnpm run build
pnpm exec nanoclaw-agenthosts verify
# Restart the NanoClaw host
```

In `nanoclaw-sandbox`, use the peer loop:

```bash
pnpm agenthosts:local            # or agenthosts:published
pnpm exec nanoclaw-agenthosts verify
```

## Multi-driver / per-group selection

One NanoClaw instance can register many drivers. Each agent group picks one:

```bash
ncl groups config update --id ag-local  --runtime process
ncl groups config update --id ag-cloud  --runtime fly --session-transport http
ncl groups create --name "Fly scout" --folder fly-scout --runtime fly
```

Resolution order:

1. `container_configs.runtime`
2. `NANOCLAW_DEFAULT_RUNTIME` (instance default)
3. `docker`

Unset `runtime` keeps today’s Docker behavior.

## Compatible transports

| Transport  | Runtime                        | Valid? |
| ---------- | ------------------------------ | ------ |
| filesystem | docker / process / applenative | Yes    |
| filesystem | fly (remote)                   | No     |
| http       | fly                            | Yes    |

Remote drivers declare `requiredTransport` and fail closed on mismatch.

## Plugin packages

- `nanoclaw-agenthost-process` — local child process
- `nanoclaw-agenthost-applenative` — Apple Container
- `nanoclaw-agenthost-flyio` — Fly Machines (needs `nanoclaw-sessionio`)

Install agenthosts first; plugins register drivers and do **not** patch wake/kill themselves.

## Verify / uninstall

```bash
pnpm exec nanoclaw-agenthosts verify
pnpm exec nanoclaw-agenthosts uninstall
```

See `REMOVE.md` before uninstalling if plugins depend on this seam.

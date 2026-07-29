# nanoclaw-agenthosts

**Decouple where NanoClaw’s host runs from where each agent runs.**

By default NanoClaw assumes the host and every agent share one Docker-shaped machine: the host wakes a local container, talks over the filesystem mailbox, and kills that same process. This package turns that lifecycle into a pluggable `RuntimeDriver` registry so the host can stay on one machine (or one orchestration style) while individual agent groups run elsewhere—another container runtime, a sibling process on the same box, or a remote machine that the host only reaches over the network.

The host still owns routing, sessions, and group config. Drivers own **wake / kill / isRunning / orphan cleanup** for a given runtime. Docker remains the zero-behavior-change default when `container_configs.runtime` is unset.

## Why this exists

Useful when you want to:

- **Mix runtimes in one NanoClaw instance** — some groups stay on Docker; others use a lighter local process, a different container stack, or a remote executor, selected per group the same way you pick a model `provider`.
- **Keep the host stable while agents move** — upgrade or relocate agent sandboxes without rewriting host wake/kill call sites; plugins register drivers, the substrate dispatches.
- **Split host and agent onto different machines** — pair a non-local driver with a session transport (e.g. via `nanoclaw-sessionio`) so mailbox I/O is not tied to a shared filesystem.
- **Prototype new agent hosts quickly** — implement `RuntimeDriver`, register it, set `--runtime` on a group.

**Proof of concept:** [`nanoclaw-agenthost-process`](https://github.com/Artificer-Innovations/nanoclaw-agenthost-process) runs the agent as a local child process instead of a Docker container. Install agenthosts first, then that plugin; point a group at `--runtime process` to exercise the registry end-to-end without changing Docker groups.

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
ncl groups create --name "Local process scout" --folder process-scout --runtime process
```

Default when unset: `docker` (or `NANOCLAW_DEFAULT_RUNTIME`). Install the matching agenthost plugin before selecting a non-docker runtime.

## Development

```bash
pnpm install
pnpm run build
pnpm run test:unit
pnpm run test:coverage
pnpm run test:integration
```

See [QUICKSTART.md](./QUICKSTART.md), [api-contract.md](./api-contract.md), and `.claude/skills/add-agenthosts/` after `sync-skill`.

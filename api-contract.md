# nanoclaw-agenthosts API contract (v1)

Normative contract for `AGENTHOSTS_API_VERSION = 1`.

## Registration model

- `registerRuntimeDriver(name, driver)` — named map; last register for a name wins; returns unregister `() => void`
- Built-in `"docker"` is registered by the installer at container-runner load time
- Many drivers may be registered in one host process

## Resolution

```
resolveRuntimeDriver(session)
  → container_configs.runtime for session.agent_group_id
  → else NANOCLAW_DEFAULT_RUNTIME
  → else "docker"
  → drivers.get(name)  // throw if missing
  → if driver.requiredTransport set, enforce against resolved session transport
```

Session transport resolution:

1. Optional `setSessionTransportResolver` (sessionio)
2. Else `container_configs.session_transport`
3. Else `"filesystem"`

## RuntimeDriver

Required: `wake`, `kill`, `isRunning`  
Optional: `cleanupOrphans`, `buildImage`, `requiredTransport`

`runRuntimeOrphanCleanup()` awaits every registered `cleanupOrphans` (errors warnOnce, continue).

## Installer contract

- Marker blocks: `// @nanoclaw-agenthosts:<name>:begin|end`
- Compute all transforms, then atomic commit with rollback
- Idempotent install/upgrade; verify fails closed on partial markers or moved anchors
- Copied modules: `src/agenthosts.ts`, `src/warn-once.ts`, `src/db/migrations/020-agenthosts-runtime.ts`
- Patched files: `container-runner.ts`, `index.ts`, `types.ts`, `db/container-configs.ts`, `db/migrations/index.ts`, `cli/resources/groups.ts`

## Capability probe

`getAgenthostsCapabilities()` / `probeAgenthostsCapabilities(load)` — no uncaught exceptions from probe path.

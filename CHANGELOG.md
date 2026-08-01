# Changelog

## Unreleased

### Minor Changes

- Add `WakeContext.onStatus`, `createWakeContext` / `emitRuntimeStatus`, and coarse wake/kill bookends that optionally publish agenttrace `runtime_status`.
- Forward `WakeContext` into the docker driver; thread ctx through `spawnContainer` with phase-rich `onStatus` inserts (configuring / starting / ready).

## 0.1.1

### Patch Changes

- Tolerate flexible indentation when scavenging unmarked pollActive heals, and restore session-manager / isContainerRunning imports with quote and CRLF tolerance on uninstall.

- [#6](https://github.com/Artificer-Innovations/nanoclaw-agenthosts/pull/6) [`dc2e54c`](https://github.com/Artificer-Innovations/nanoclaw-agenthosts/commit/dc2e54cc943127fd9c8f488104ad24d2f8f5de55) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Productize the delivery `pollActive` heal as a marked host patch: when a runtime driver is live in-memory but DB `container_status` is still `stopped`, heal and include the session so outbound is not stuck on the 60s sweep. Install/uninstall markers cover the imports and loop body; unmarked hotfixes are scavenged on uninstall.

- [#6](https://github.com/Artificer-Innovations/nanoclaw-agenthosts/pull/6) [`dc2e54c`](https://github.com/Artificer-Innovations/nanoclaw-agenthosts/commit/dc2e54cc943127fd9c8f488104ad24d2f8f5de55) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Scope `restoreStockPollActiveBody` to the `pollActive` function so uninstall does not leave an empty try when `pollSweep` still calls `deliverSessionMessages`.

- [#6](https://github.com/Artificer-Innovations/nanoclaw-agenthosts/pull/6) [`dc2e54c`](https://github.com/Artificer-Innovations/nanoclaw-agenthosts/commit/dc2e54cc943127fd9c8f488104ad24d2f8f5de55) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Scavenge unmarked pollActive heal without requiring the stock comment text; avoid double drain restore.

## 0.1.0

- Initial release: RuntimeDriver registry, docker default, per-group `runtime` / `session_transport` config, installer + skill.

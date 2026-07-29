# Removing nanoclaw-agenthosts

Uninstall **dependent agenthost plugins first**, then this substrate:

1. `pnpm exec nanoclaw-agenthost-flyio uninstall` (if installed)
2. `pnpm exec nanoclaw-agenthost-applenative uninstall` (if installed)
3. `pnpm exec nanoclaw-agenthost-process uninstall` (if installed)
4. `pnpm exec nanoclaw-agenthosts uninstall`
5. `pnpm remove nanoclaw-agenthosts`
6. `pnpm run build` and restart the NanoClaw host

After uninstall, all groups fall back to stock Docker wake/kill (no registry). Clear any `container_configs.runtime` / `session_transport` values you no longer need.

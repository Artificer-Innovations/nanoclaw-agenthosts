# Contributing

- Branch from `develop`; release merges to `main`
- Add a changeset for user-facing changes: `pnpm changeset`
- `pnpm run typecheck && pnpm run test:unit && pnpm run test:coverage && pnpm run build` before PR
- Installer patches must use `@nanoclaw-agenthosts:*` markers and stay idempotent

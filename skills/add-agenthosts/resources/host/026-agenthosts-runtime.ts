/** Copied into NanoClaw as src/db/migrations/026-agenthosts-runtime.ts */

/**
 * Adds runtime + session_transport scalars on container_configs.
 * Uses the host DbDriver surface (async all/exec) — not better-sqlite3.
 */
export const migration026 = {
  version: 26,
  name: "agenthosts-runtime",
  async up(db: {
    all: <T = unknown>(sql: string, ...params: unknown[]) => Promise<T[]>;
    exec: (sql: string) => Promise<void>;
  }) {
    const columns = await db.all<{ name: string }>(
      `PRAGMA table_info(container_configs)`,
    );
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("runtime")) {
      await db.exec(`ALTER TABLE container_configs ADD COLUMN runtime TEXT;`);
    }
    if (!names.has("session_transport")) {
      await db.exec(
        `ALTER TABLE container_configs ADD COLUMN session_transport TEXT;`,
      );
    }
  },
};

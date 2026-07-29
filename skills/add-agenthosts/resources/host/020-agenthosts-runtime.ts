/** Copied into NanoClaw as src/db/migrations/020-agenthosts-runtime.ts */

export const migration020 = {
  version: 20,
  name: "agenthosts-runtime",
  // Intentional `any`: better-sqlite3 Database typing differs across package vs host trees.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  up(db: any) {
    const columns = db
      .prepare(`PRAGMA table_info(container_configs)`)
      .all() as Array<{ name: string }>;
    const names = new Set(
      columns.map((column: { name: string }) => column.name),
    );
    if (!names.has("runtime")) {
      db.prepare("ALTER TABLE container_configs ADD COLUMN runtime TEXT").run();
    }
    if (!names.has("session_transport")) {
      db.prepare(
        "ALTER TABLE container_configs ADD COLUMN session_transport TEXT",
      ).run();
    }
  },
};

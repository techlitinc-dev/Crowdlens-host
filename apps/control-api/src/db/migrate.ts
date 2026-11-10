import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ClientBase } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "migrations");

/**
 * Applies pending migrations in filename order. Migrations run as the owner
 * role (bypasses RLS by design); the app runtime uses crowdlens_app, which
 * cannot bypass RLS (architecture.md §6.2).
 */
export async function migrate(client: ClientBase): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map(
      (row) => row.name,
    ),
  );
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return newlyApplied;
}

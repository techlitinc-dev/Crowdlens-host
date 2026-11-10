/**
 * CLI: apply migrations against DATABASE_URL (owner role).
 * Used by `pnpm db:migrate` (instructions.md §5.2).
 */
import pg from "pg";
import { migrate } from "./migrate.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgres://crowdlens:crowdlens@localhost:5432/crowdlens";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await migrate(client);
    // eslint-disable-next-line no-console
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

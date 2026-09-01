import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Lives outside src/dist (server/migrations, not server/src/migrations) so
// it resolves the same way whether this runs via tsx against src or as
// compiled dist/migrate.js — both sit one level below server/.
const migrationsDir = path.join(__dirname, '..', 'migrations');

// Deliberately a separate connection from db.js's runtime pool: applying
// migrations needs DDL rights (CREATE TABLE, ALTER TABLE), and the runtime
// role the app connects as should not have those — see server/sql/roles.sql.
// Falls back to DATABASE_URL so a single local-dev database with one role
// still works without extra setup.
const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');
}

const client = new Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function run() {
  await client.connect();

  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const { rows: appliedRows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.filename));

  const pending = files.filter((name) => !applied.has(name));
  if (pending.length === 0) {
    console.log('No pending migrations');
    return;
  }

  for (const filename of pending) {
    const sql = readFileSync(path.join(migrationsDir, filename), 'utf-8');
    // Each migration is its own transaction: a failure partway through one
    // file rolls back cleanly, and everything already recorded in
    // schema_migrations stays applied — a re-run picks up exactly where it
    // left off instead of re-running migrations that already succeeded.
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`Applied ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

try {
  await run();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}

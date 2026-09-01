import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

// Deliberately a separate connection from db.js's runtime pool: applying
// schema.sql needs DDL rights (CREATE TABLE, ALTER TABLE), and the runtime
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

await client.connect();
try {
  await client.query(schema);
  console.log('Schema applied');
} finally {
  await client.end();
}

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Client, type Pool } from 'pg';
import { buildDatabaseSsl } from '../../src/tls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

// Schema creation and teardown need DDL rights, same as migrate.ts — the
// least-privilege runtime role from 2.11 only has grants on public.endpoints
// and public.requests specifically, not on same-named tables in a fresh
// schema, so it can't even be used to run tests against. Using the
// admin/owner connection for the app's own pool during tests sidesteps
// that; the grants themselves are a deployment concern already verified
// manually in 2.11, not something these tests re-check per request.
function adminConnectionString(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL (or MIGRATION_DATABASE_URL) must point at a real Postgres to run tests — see server/.env.example.',
    );
  }
  return url;
}

async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = adminConnectionString();
  const client = new Client({
    connectionString,
    ssl: buildDatabaseSsl(connectionString, { insecureTls: false, caCert: process.env.DATABASE_CA_CERT }),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createSchema(schemaName: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);

    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const filename of files) {
      const sql = readFileSync(path.join(migrationsDir, filename), 'utf-8');
      await client.query(sql);
    }
  });
}

async function dropSchema(schemaName: string): Promise<void> {
  await withAdminClient((client) => client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
}

export interface TestApp {
  app: FastifyInstance;
  pool: Pool;
  teardown: () => Promise<void>;
}

// Each call gets its own disposable schema — CREATE SCHEMA, migrate it,
// point this process's db.js pool at it via PGOPTIONS, then drop it on
// teardown — so tests never share state with real data or with each other.
// PGOPTIONS must be set, and db.js's pool constructed, only after the schema
// exists: db.js builds its pool at module-import time, so app.js and db.js
// are loaded here via dynamic import rather than a static one, guaranteeing
// this function's own code above runs first.
export async function createTestApp(): Promise<TestApp> {
  const schemaName = `test_${randomBytes(6).toString('hex')}`;
  await createSchema(schemaName);

  process.env.PGOPTIONS = `-c search_path=${schemaName}`;
  process.env.DATABASE_URL = adminConnectionString();
  process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  // Rate-limit tests want an isolated, in-process counter per test file
  // rather than state shared (via Redis) with whatever else is running.
  // (Setting a property to `undefined` would coerce it to the string
  // "undefined" here, since process.env only holds strings — hence delete.)
  delete process.env.REDIS_URL;

  const { buildApp } = await import('../../src/app.js');
  const { pool } = await import('../../src/db.js');

  const app = await buildApp();
  await app.ready();

  async function teardown() {
    await app.close();
    // Best-effort: a test exercising the error handler (errorHandler.test.ts)
    // may have already ended this pool on purpose to induce a real
    // connection failure, so a second end() here is expected to reject.
    await pool.end().catch(() => {});
    await dropSchema(schemaName);
  }

  return { app, pool, teardown };
}

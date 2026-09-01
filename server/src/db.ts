import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString,
  // Local Postgres usually has no SSL configured; hosted providers (Neon) require it.
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  // Bounds how many connections this process can hold open, so a burst of
  // slow requests can't starve every other query of a connection.
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  // A single stuck or pathological query would otherwise occupy a pool
  // connection indefinitely; this is enforced server-side by Postgres itself
  // on every statement this connection runs.
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 5000),
});

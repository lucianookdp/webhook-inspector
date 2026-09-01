import { Pool } from 'pg';
import * as config from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Local Postgres usually has no SSL configured; hosted providers (Neon) require it.
  ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  // Bounds how many connections this process can hold open, so a burst of
  // slow requests can't starve every other query of a connection.
  max: config.databasePoolMax,
  // A single stuck or pathological query would otherwise occupy a pool
  // connection indefinitely; this is enforced server-side by Postgres itself
  // on every statement this connection runs.
  statement_timeout: config.databaseStatementTimeoutMs,
});

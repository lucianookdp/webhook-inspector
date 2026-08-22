import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString,
  // Local Postgres usually has no SSL configured; hosted providers (Neon) require it.
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

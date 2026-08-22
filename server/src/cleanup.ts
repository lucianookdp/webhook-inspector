import { pool } from './db.js';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

async function purgeExpiredEndpoints() {
  // Requests cascade-delete with their endpoint (see schema.sql).
  await pool.query('DELETE FROM endpoints WHERE expires_at <= now()');
}

export function startExpiredEndpointCleanup() {
  void purgeExpiredEndpoints();
  setInterval(() => void purgeExpiredEndpoints(), CLEANUP_INTERVAL_MS);
}

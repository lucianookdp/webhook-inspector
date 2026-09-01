import type { FastifyBaseLogger } from 'fastify';
import { pool } from './db.js';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

async function purgeExpiredEndpoints(log: FastifyBaseLogger) {
  try {
    // Requests cascade-delete with their endpoint (see server/migrations).
    await pool.query('DELETE FROM endpoints WHERE expires_at <= now()');
  } catch (err) {
    // An uncaught rejection here would otherwise crash the process on a
    // transient database blip — Node terminates on unhandled rejections by
    // default — taking down every open SSE connection along with it for a
    // failure that's likely to clear up by the next interval tick.
    log.error({ err }, 'failed to purge expired endpoints');
  }
}

export function startExpiredEndpointCleanup(log: FastifyBaseLogger) {
  void purgeExpiredEndpoints(log);
  setInterval(() => void purgeExpiredEndpoints(log), CLEANUP_INTERVAL_MS);
}

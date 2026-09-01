import type { FastifyBaseLogger } from 'fastify';
import * as config from './config.js';
import { pool } from './db.js';

const REFRESH_INTERVAL_MS = 30_000;
// What actually lands on disk per request is capped by the bounded stream
// parser regardless of the caller's reported size, so usage is measured
// against that cap rather than the (attacker-controlled) size_bytes value.
const STORED_BODY_CAP_BYTES = 256 * 1024;

// These ceilings sit independently of the per-IP rate limits: a flood spread
// across many IPs (or many distinct endpoints) would sail through those but
// could still fill the database. Counters are refreshed periodically rather
// than on every write, since summing the whole table on every request would
// reintroduce the same unbounded-query problem this app is trying to avoid.
let liveEndpointCount = 0;
let totalStoredBytes = 0;

async function refresh(log: FastifyBaseLogger) {
  try {
    const [endpoints, bytes] = await Promise.all([
      pool.query<{ count: string }>('SELECT count(*) FROM endpoints WHERE expires_at > now()'),
      pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(LEAST(size_bytes, $1)), 0) AS total FROM requests`,
        [STORED_BODY_CAP_BYTES],
      ),
    ]);
    liveEndpointCount = Number(endpoints.rows[0].count);
    totalStoredBytes = Number(bytes.rows[0].total);
  } catch (err) {
    log.error({ err }, 'failed to refresh resource usage counters');
  }
}

export function startResourceUsageTracking(log: FastifyBaseLogger) {
  void refresh(log);
  setInterval(() => void refresh(log), REFRESH_INTERVAL_MS);
}

export function isLiveEndpointCeilingReached(): boolean {
  return liveEndpointCount >= config.maxLiveEndpoints;
}

export function isStorageCeilingReached(): boolean {
  return totalStoredBytes >= config.maxTotalStoredBytes;
}

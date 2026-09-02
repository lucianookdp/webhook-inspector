import type { PoolClient } from 'pg';
import { pool } from './db.js';

// Both counters live in the same table (see migrations/0008) but are
// incremented from different call sites, so each gets its own narrow
// upsert rather than a shared helper that would force an unrelated column
// to always be touched together.

export async function recordEndpointCreated(): Promise<void> {
  await pool.query(
    `INSERT INTO daily_stats (day, endpoints_created) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (day) DO UPDATE SET endpoints_created = daily_stats.endpoints_created + 1`,
  );
}

// Takes the transaction's own client (routes/webhook.js already opens one
// to insert the row and trim old ones) so a counted capture and its stored
// row can never drift out of sync with each other.
export async function recordRequestCaptured(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO daily_stats (day, requests_captured) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (day) DO UPDATE SET requests_captured = daily_stats.requests_captured + 1`,
  );
}

export interface DailyStat {
  day: string;
  endpointsCreated: number;
  requestsCaptured: number;
}

export interface UsageStats {
  activeEndpoints: number;
  totalEndpointsCreated: number;
  totalRequestsCaptured: number;
  // Oldest first, last 30 days — the shape a chart wants to render
  // left-to-right without the caller reversing it itself.
  daily: DailyStat[];
}

const DAILY_HISTORY_DAYS = 30;

export async function getUsageStats(): Promise<UsageStats> {
  const [activeResult, totalsResult, dailyResult] = await Promise.all([
    pool.query<{ count: string }>('SELECT count(*) FROM endpoints WHERE expires_at > now() AND disabled = false'),
    pool.query<{ endpoints_created: string | null; requests_captured: string | null }>(
      'SELECT sum(endpoints_created) AS endpoints_created, sum(requests_captured) AS requests_captured FROM daily_stats',
    ),
    pool.query<{ day: Date; endpoints_created: number; requests_captured: number }>(
      'SELECT day, endpoints_created, requests_captured FROM daily_stats ORDER BY day DESC LIMIT $1',
      [DAILY_HISTORY_DAYS],
    ),
  ]);

  return {
    activeEndpoints: Number(activeResult.rows[0].count),
    totalEndpointsCreated: Number(totalsResult.rows[0].endpoints_created ?? 0),
    totalRequestsCaptured: Number(totalsResult.rows[0].requests_captured ?? 0),
    daily: dailyResult.rows
      .map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        endpointsCreated: row.endpoints_created,
        requestsCaptured: row.requests_captured,
      }))
      .reverse(),
  };
}

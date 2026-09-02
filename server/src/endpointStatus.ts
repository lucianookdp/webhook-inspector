import { pool } from './db.js';

export type EndpointStatus = 'missing' | 'expired' | 'disabled' | 'active';

export interface EndpointStatusResult {
  status: EndpointStatus;
  droppedCount: number;
  signingSecret: string | null;
}

export async function getEndpointStatus(id: string): Promise<EndpointStatusResult> {
  const { rows } = await pool.query<{
    expires_at: Date;
    disabled: boolean;
    dropped_count: number;
    signing_secret: string | null;
  }>('SELECT expires_at, disabled, dropped_count, signing_secret FROM endpoints WHERE id = $1', [id]);
  if (rows.length === 0) return { status: 'missing', droppedCount: 0, signingSecret: null };

  const { expires_at, disabled, dropped_count, signing_secret } = rows[0];
  if (expires_at.getTime() <= Date.now()) {
    return { status: 'expired', droppedCount: dropped_count, signingSecret: signing_secret };
  }
  if (disabled) return { status: 'disabled', droppedCount: dropped_count, signingSecret: signing_secret };
  return { status: 'active', droppedCount: dropped_count, signingSecret: signing_secret };
}

// Used on the live SSE push path (routes/stream.js), where the full status
// check above would be unnecessary work — a message only exists because the
// endpoint just accepted a capture, so it's already known to be active.
export async function getSigningSecret(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ signing_secret: string | null }>(
    'SELECT signing_secret FROM endpoints WHERE id = $1',
    [id],
  );
  return rows[0]?.signing_secret ?? null;
}

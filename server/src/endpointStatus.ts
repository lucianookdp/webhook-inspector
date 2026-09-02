import { pool } from './db.js';

export type EndpointStatus = 'missing' | 'expired' | 'disabled' | 'active';

export interface ResponseConfig {
  status: number | null;
  body: string | null;
  contentType: string | null;
}

export interface EndpointStatusResult {
  status: EndpointStatus;
  droppedCount: number;
  signingSecret: string | null;
  responseConfig: ResponseConfig;
}

export async function getEndpointStatus(id: string): Promise<EndpointStatusResult> {
  const { rows } = await pool.query<{
    expires_at: Date;
    disabled: boolean;
    dropped_count: number;
    signing_secret: string | null;
    response_status: number | null;
    response_body: string | null;
    response_content_type: string | null;
  }>(
    `SELECT expires_at, disabled, dropped_count, signing_secret, response_status, response_body, response_content_type
     FROM endpoints WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    return {
      status: 'missing',
      droppedCount: 0,
      signingSecret: null,
      responseConfig: { status: null, body: null, contentType: null },
    };
  }

  const row = rows[0];
  const responseConfig: ResponseConfig = {
    status: row.response_status,
    body: row.response_body,
    contentType: row.response_content_type,
  };
  const shared = { droppedCount: row.dropped_count, signingSecret: row.signing_secret, responseConfig };

  if (row.expires_at.getTime() <= Date.now()) return { status: 'expired', ...shared };
  if (row.disabled) return { status: 'disabled', ...shared };
  return { status: 'active', ...shared };
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

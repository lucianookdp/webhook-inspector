import { pool } from './db.js';

export type EndpointStatus = 'missing' | 'expired' | 'disabled' | 'active';

export interface ResponseConfig {
  status: number | null;
  body: string | null;
  contentType: string | null;
}

export interface EndpointStatusResult {
  // The canonical id, resolved from whichever of id/slug the caller passed
  // in — everything downstream (foreign keys, the NOTIFY channel, the SSE
  // registry) is keyed on this, never on the slug. Meaningless when status
  // is 'missing'; every caller already returns before reading it in that
  // case.
  id: string;
  status: EndpointStatus;
  slug: string | null;
  droppedCount: number;
  signingSecret: string | null;
  responseConfig: ResponseConfig;
}

// Accepts either the canonical id or a user-chosen slug (see id.js's
// isValidSlug) — a plain UNIQUE constraint on slug means at most one row
// can ever match on that side of the OR.
export async function getEndpointStatus(idOrSlug: string): Promise<EndpointStatusResult> {
  const { rows } = await pool.query<{
    id: string;
    slug: string | null;
    expires_at: Date;
    disabled: boolean;
    dropped_count: number;
    signing_secret: string | null;
    response_status: number | null;
    response_body: string | null;
    response_content_type: string | null;
  }>(
    `SELECT id, slug, expires_at, disabled, dropped_count, signing_secret,
            response_status, response_body, response_content_type
     FROM endpoints WHERE id = $1 OR slug = $1`,
    [idOrSlug],
  );
  if (rows.length === 0) {
    return {
      id: idOrSlug,
      status: 'missing',
      slug: null,
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
  const shared = {
    id: row.id,
    slug: row.slug,
    droppedCount: row.dropped_count,
    signingSecret: row.signing_secret,
    responseConfig,
  };

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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { getEndpointStatus } from '../endpointStatus.js';
import { forwardRequest } from '../forward.js';
import { forwardBodySchema, forwardParamsSchema } from '../schemas.js';
import { ForwardBlockedError } from '../ssrf.js';
import type { RequestRow } from '../types.js';

type ForwardRequest = FastifyRequest<{ Params: { id: string; requestId: string }; Body: { url: string } }>;

// Tighter than the read routes: each call makes this server originate a
// real outbound HTTP request, which is exactly the kind of action a flood
// would want to abuse (as a proxy, or to point at a target it wants hit
// repeatedly). 20/minute/IP is generous for someone actually testing a
// webhook by hand, not for scripted abuse.
const FORWARD_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

function parseTargetUrl(raw: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return url;
}

function decodeStoredBody(row: RequestRow): Buffer | undefined {
  if (row.body === null || row.body === '') return undefined;
  return row.body_is_binary ? Buffer.from(row.body, 'base64') : Buffer.from(row.body, 'utf-8');
}

export async function forwardRoutes(app: FastifyInstance) {
  app.post(
    '/api/endpoints/:id/requests/:requestId/forward',
    {
      config: { rateLimit: FORWARD_RATE_LIMIT },
      schema: { params: forwardParamsSchema, body: forwardBodySchema },
    },
    handleForward,
  );
}

async function handleForward(req: ForwardRequest, reply: FastifyReply) {
  const { id, requestId } = req.params;

  const { status } = await getEndpointStatus(id);
  if (status === 'missing' || status === 'disabled') {
    reply.code(404).send({ error: 'endpoint not found' });
    return;
  }
  if (status === 'expired') {
    reply.code(410).send({ error: 'endpoint expired' });
    return;
  }

  const targetUrl = parseTargetUrl(req.body.url);
  if (!targetUrl) {
    reply.code(400).send({ error: 'url must be an absolute http:// or https:// URL' });
    return;
  }

  const { rows } = await pool.query<RequestRow>(
    `SELECT id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes, received_at
     FROM requests WHERE id = $1 AND endpoint_id = $2`,
    [requestId, id],
  );
  const row = rows[0];
  if (!row) {
    reply.code(404).send({ error: 'request not found' });
    return;
  }

  try {
    const result = await forwardRequest(targetUrl, row.method, row.headers, decodeStoredBody(row));
    reply.code(200).send(result);
  } catch (err) {
    if (err instanceof ForwardBlockedError) {
      reply.code(400).send({ error: err.message });
      return;
    }
    // A network-level failure reaching the target (refused, timed out, DNS
    // failure after all) — not this server's fault, so 502 rather than 500,
    // and no raw error detail (which could include internal connection
    // info) beyond a generic summary.
    req.log.warn({ err }, 'forward request failed');
    reply.code(502).send({ error: 'could not reach the target URL' });
  }
}

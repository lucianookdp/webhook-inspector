import type { FastifyInstance } from 'fastify';
import { decodeCursor, encodeCursor } from '../cursor.js';
import { pool } from '../db.js';
import { getEndpointStatus } from '../endpointStatus.js';
import { generateId } from '../id.js';
import { isLiveEndpointCeilingReached } from '../limits.js';
import {
  endpointIdParamsSchema,
  requestsQuerystringSchema,
  responseConfigBodySchema,
  signingSecretBodySchema,
} from '../schemas.js';
import { computeSignatureStatus } from '../signature.js';
import type { RequestRow } from '../types.js';

const ENDPOINT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(n, MAX_PAGE_LIMIT);
}

export async function endpointRoutes(app: FastifyInstance) {
  app.post(
    '/api/endpoints',
    // 10/hour/IP: creating an endpoint is cheap for a real visitor (one per
    // debugging session) but is the operation an unlimited flood would use
    // to fill the database, so it gets the tightest ceiling in the app.
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      // Independent of the per-IP limit above: a flood spread across many
      // IPs would sail past that but could still fill the database.
      if (isLiveEndpointCeilingReached()) {
        req.log.warn('live endpoint ceiling reached, rejecting creation');
        reply.code(503).send({ error: 'at capacity, try again later' });
        return;
      }

      const id = generateId();
      const expiresAt = new Date(Date.now() + ENDPOINT_TTL_MS);

      await pool.query('INSERT INTO endpoints (id, expires_at) VALUES ($1, $2)', [id, expiresAt]);

      reply.code(201).send({ id, expiresAt: expiresAt.toISOString() });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string; cursor?: string } }>(
    '/api/endpoints/:id/requests',
    {
      // Reads are far cheaper than writes and the page a browser polls on
      // load can legitimately re-fire, so this ceiling is well above the
      // capture route's rather than shared with it.
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: { params: endpointIdParamsSchema, querystring: requestsQuerystringSchema },
    },
    async (req, reply) => {
      const { status, droppedCount, signingSecret, responseConfig } = await getEndpointStatus(req.params.id);
      if (status === 'missing') {
        reply.code(404).send({ error: 'endpoint not found' });
        return;
      }
      if (status === 'expired') {
        reply.code(410).send({ error: 'endpoint expired' });
        return;
      }

      const limit = parseLimit(req.query.limit);
      const columns =
        'id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes, received_at';

      let rows: RequestRow[];
      if (req.query.cursor) {
        const cursor = decodeCursor(req.query.cursor);
        if (!cursor) {
          reply.code(400).send({ error: 'invalid cursor' });
          return;
        }
        ({ rows } = await pool.query<RequestRow>(
          `SELECT ${columns}
           FROM requests
           WHERE endpoint_id = $1 AND (received_at, id) < ($2, $3)
           ORDER BY received_at DESC, id DESC
           LIMIT $4`,
          [req.params.id, cursor.receivedAt, cursor.id, limit + 1],
        ));
      } else {
        ({ rows } = await pool.query<RequestRow>(
          `SELECT ${columns}
           FROM requests
           WHERE endpoint_id = $1
           ORDER BY received_at DESC, id DESC
           LIMIT $2`,
          [req.params.id, limit + 1],
        ));
      }

      // Fetching one extra row is how we know a next page exists without a
      // separate COUNT query; it's dropped from the response either way.
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null;

      // Computed fresh against the endpoint's current secret rather than
      // stored at capture time: if the secret changes, older rows are
      // re-evaluated against it too, which is what "does my current secret
      // match this captured request" actually means while debugging.
      const withSignatures = items.map((item) => ({
        ...item,
        signature: computeSignatureStatus(item.body, item.body_is_binary, item.truncated, item.headers, signingSecret),
      }));

      reply.send({
        items: withSignatures,
        nextCursor,
        droppedCount,
        signingSecretConfigured: signingSecret !== null,
        responseConfig,
      });
    },
  );

  app.put<{ Params: { id: string }; Body: { secret: string | null } }>(
    '/api/endpoints/:id/signing-secret',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: endpointIdParamsSchema, body: signingSecretBodySchema },
    },
    async (req, reply) => {
      const { status } = await getEndpointStatus(req.params.id);
      if (status === 'missing' || status === 'disabled') {
        reply.code(404).send({ error: 'endpoint not found' });
        return;
      }
      if (status === 'expired') {
        reply.code(410).send({ error: 'endpoint expired' });
        return;
      }

      const secret = req.body.secret?.trim() || null;
      await pool.query('UPDATE endpoints SET signing_secret = $1 WHERE id = $2', [secret, req.params.id]);
      reply.code(204).send();
    },
  );

  app.put<{
    Params: { id: string };
    Body: { status: number | null; body: string | null; contentType: string | null };
  }>(
    '/api/endpoints/:id/response-config',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: endpointIdParamsSchema, body: responseConfigBodySchema },
    },
    async (req, reply) => {
      const { status } = await getEndpointStatus(req.params.id);
      if (status === 'missing' || status === 'disabled') {
        reply.code(404).send({ error: 'endpoint not found' });
        return;
      }
      if (status === 'expired') {
        reply.code(410).send({ error: 'endpoint expired' });
        return;
      }

      await pool.query(
        'UPDATE endpoints SET response_status = $1, response_body = $2, response_content_type = $3 WHERE id = $4',
        [req.body.status ?? null, req.body.body ?? null, req.body.contentType?.trim() || null, req.params.id],
      );
      reply.code(204).send();
    },
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { getEndpointStatus } from '../endpointStatus.js';
import { publishRequest } from '../events.js';
import { maskIp } from '../ip.js';
import { isStorageCeilingReached } from '../limits.js';
import { captureIdentifierParamsSchema } from '../schemas.js';
import type { RequestRow } from '../types.js';

type WebhookRequest = FastifyRequest<{ Params: { id: string } }>;

const BODY_CAP_BYTES = 256 * 1024;
// The route's own bodyLimit only guards against a client lying about
// Content-Length; actual memory use is bounded by BODY_CAP_BYTES below,
// regardless of how much data really arrives.
const ROUTE_BODY_LIMIT = 1024 * 1024 * 1024;

interface CapturedBody {
  data: Buffer;
  totalBytes: number;
  truncated: boolean;
}

function decodeBody(raw: Buffer): { body: string; isBinary: boolean } {
  try {
    return { body: new TextDecoder('utf-8', { fatal: true }).decode(raw), isBinary: false };
  } catch {
    return { body: raw.toString('base64'), isBinary: true };
  }
}

// Reads the raw request stream ourselves instead of letting Fastify buffer
// it, so a body over the 256KB cap is truncated for storage while every byte
// still gets drained and counted — never buffered in full, never rejected.
function boundedStreamParser(
  _req: FastifyRequest,
  payload: NodeJS.ReadableStream,
  done: (err: Error | null, body?: CapturedBody) => void,
) {
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let totalBytes = 0;
  let truncated = false;

  payload.on('data', (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (capturedBytes >= BODY_CAP_BYTES) {
      truncated = true;
      return;
    }
    const remaining = BODY_CAP_BYTES - capturedBytes;
    if (chunk.length <= remaining) {
      chunks.push(chunk);
      capturedBytes += chunk.length;
    } else {
      chunks.push(chunk.subarray(0, remaining));
      capturedBytes += remaining;
      truncated = true;
    }
  });

  payload.on('end', () => {
    done(null, { data: Buffer.concat(chunks), totalBytes, truncated });
  });

  payload.on('error', (err) => done(err));
}

// 100 requests/minute/IP: generous enough for a legitimate provider's retry
// bursts and for someone hammering curl by hand while testing, but well
// below what a flood aimed at a public, unauthenticated URL would send.
const CAPTURE_RATE_LIMIT = { max: 100, timeWindow: '1 minute' };

// Ceiling per endpoint, independent of the 24h TTL: a provider retrying
// aggressively against a debugging session nobody is watching could
// otherwise accumulate an unbounded number of rows before it expires.
const MAX_REQUESTS_PER_ENDPOINT = 500;

// Inserts the new row and, in the same transaction, trims anything beyond
// the newest MAX_REQUESTS_PER_ENDPOINT for that endpoint — tallying what got
// trimmed onto endpoints.dropped_count so the UI can say requests were
// discarded rather than just show fewer rows than were actually sent.
async function insertAndTrim(
  values: [string, string, string, string, string, string, boolean, boolean, string | null, string | null, number],
): Promise<RequestRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<RequestRow>(
      `INSERT INTO requests
         (endpoint_id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes, received_at`,
      values,
    );
    await client.query(
      `WITH ranked AS (
         SELECT id, row_number() OVER (ORDER BY received_at DESC, id DESC) AS rn
         FROM requests WHERE endpoint_id = $1
       ), deleted AS (
         DELETE FROM requests WHERE id IN (SELECT id FROM ranked WHERE rn > $2) RETURNING id
       )
       UPDATE endpoints SET dropped_count = dropped_count + (SELECT count(*) FROM deleted) WHERE id = $1`,
      [values[0], MAX_REQUESTS_PER_ENDPOINT],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  // Fastify's built-in json/text parsers reject malformed bodies before the
  // handler runs, so they're overridden here alongside the catch-all — every
  // content-type reaches the handler through the same bounded stream parser.
  // Omitting the `opts` argument (rather than passing parseAs) is what hands
  // the parser the raw stream instead of a pre-buffered string/buffer.
  app.addContentTypeParser('application/json', boundedStreamParser);
  app.addContentTypeParser('text/plain', boundedStreamParser);
  app.addContentTypeParser('*', boundedStreamParser);

  // No body schema here: the bounded stream parser above hands every
  // content-type to the handler as a raw CapturedBody, by design, so there's
  // nothing schema-shaped to validate it against.
  app.all(
    '/w/:id',
    {
      bodyLimit: ROUTE_BODY_LIMIT,
      config: { rateLimit: CAPTURE_RATE_LIMIT },
      schema: { params: captureIdentifierParamsSchema },
    },
    handleWebhook,
  );
  app.all(
    '/w/:id/*',
    {
      bodyLimit: ROUTE_BODY_LIMIT,
      config: { rateLimit: CAPTURE_RATE_LIMIT },
      schema: { params: captureIdentifierParamsSchema },
    },
    handleWebhook,
  );
}

async function handleWebhook(req: WebhookRequest, reply: FastifyReply) {
  // req.params.id may be the canonical id or a configured slug; `id` below
  // is always the resolved canonical one, which insertAndTrim/publishRequest
  // need — the requests table and the NOTIFY channel are keyed on it, not
  // on whatever the caller typed in the URL.
  const { id, status, responseConfig } = await getEndpointStatus(req.params.id);
  if (status === 'missing') {
    reply.code(404).send({ error: 'endpoint not found' });
    return;
  }
  if (status === 'expired') {
    reply.code(410).send({ error: 'endpoint expired' });
    return;
  }
  if (status === 'disabled') {
    // Same response as `missing`, deliberately: a caller (or whoever is
    // abusing the endpoint) shouldn't be able to tell "disabled by an
    // operator" apart from "never existed".
    reply.code(404).send({ error: 'endpoint not found' });
    return;
  }

  // Independent of the per-IP capture limit: a flood spread across many IPs
  // or many endpoints would sail past that but could still fill the disk.
  // The body above this point has already been drained (never buffered
  // past BODY_CAP_BYTES) so the connection still closes cleanly; only the
  // database write is skipped.
  if (isStorageCeilingReached()) {
    req.log.warn('storage ceiling reached, rejecting capture');
    reply.code(503).send({ error: 'at capacity, try again later' });
    return;
  }

  const captured = (req.body as CapturedBody | undefined) ?? { data: Buffer.alloc(0), totalBytes: 0, truncated: false };
  const { body, isBinary } = decodeBody(captured.data);
  const pathname = new URL(req.url, 'http://portaria.local').pathname;

  const row = await insertAndTrim([
    id,
    req.method,
    pathname,
    JSON.stringify(req.query ?? {}),
    JSON.stringify(req.headers ?? {}),
    body,
    isBinary,
    captured.truncated,
    req.headers['content-type'] ?? null,
    // Truncated rather than the exact address: enough to match a known
    // provider's IP range or tell two sources apart while debugging,
    // without this disposable inspector holding onto a precise address —
    // see the README's note on why this is kept at all.
    maskIp(req.ip) ?? null,
    captured.totalBytes,
  ]);

  publishRequest(id, row);

  // A configured response lets a user rehearse how their real sender reacts
  // to a specific status/body — a 500 to check its retry logic, a 429 to
  // check its backoff, a canned body their client expects to parse — rather
  // than always seeing the fixed default this route replied with before.
  reply.code(responseConfig.status ?? 200);
  if (responseConfig.contentType) reply.header('content-type', responseConfig.contentType);
  reply.send(responseConfig.body ?? 'ok');
}

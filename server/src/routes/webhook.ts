import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { getEndpointStatus } from '../endpointStatus.js';
import { publishRequest } from '../events.js';
import { isStorageCeilingReached } from '../limits.js';
import { endpointIdParamsSchema } from '../schemas.js';
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
      schema: { params: endpointIdParamsSchema },
    },
    handleWebhook,
  );
  app.all(
    '/w/:id/*',
    {
      bodyLimit: ROUTE_BODY_LIMIT,
      config: { rateLimit: CAPTURE_RATE_LIMIT },
      schema: { params: endpointIdParamsSchema },
    },
    handleWebhook,
  );
}

async function handleWebhook(req: WebhookRequest, reply: FastifyReply) {
  const { id } = req.params;

  const status = await getEndpointStatus(id);
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

  const { rows } = await pool.query<RequestRow>(
    `INSERT INTO requests
       (endpoint_id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes, received_at`,
    [
      id,
      req.method,
      pathname,
      JSON.stringify(req.query ?? {}),
      JSON.stringify(req.headers ?? {}),
      body,
      isBinary,
      captured.truncated,
      req.headers['content-type'] ?? null,
      req.ip,
      captured.totalBytes,
    ],
  );

  publishRequest(id, rows[0]);
  reply.code(200).send('ok');
}

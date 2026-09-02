import type { FastifyInstance } from 'fastify';
import * as config from '../config.js';
import { getEndpointStatus, getSigningSecret } from '../endpointStatus.js';
import { subscribeToRequests } from '../events.js';
import { endpointIdParamsSchema } from '../schemas.js';
import { computeSignatureStatus } from '../signature.js';
import { releaseSseSlot, tryAcquireSseSlot } from '../sseLimiter.js';
import { registerSseConnection, unregisterSseConnection } from '../sseRegistry.js';

const HEARTBEAT_MS = 25_000;

export async function streamRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/api/endpoints/:id/stream',
    {
      // A browser reconnecting after a network blip legitimately opens
      // several new SSE connections in a minute, so this stays close to the
      // read route's ceiling rather than the tighter capture-route one.
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: { params: endpointIdParamsSchema },
    },
    async (req, reply) => {
      const { id } = req.params;

      const { status } = await getEndpointStatus(id);
      if (status === 'missing') {
        reply.code(404).send({ error: 'endpoint not found' });
        return;
      }
      if (status === 'expired') {
        reply.code(410).send({ error: 'endpoint expired' });
        return;
      }

      if (!tryAcquireSseSlot(id, req.ip)) {
        reply.code(429).send({ error: 'too many open connections, try again later' });
        return;
      }

      // @fastify/cors sets its headers on the reply's onSend hook, which never
      // runs once the response is hijacked below — so the CORS header has to be
      // set by hand here, mirroring the same config.webOrigin used for the
      // main CORS registration in index.js. config.webOrigin is only ever
      // `true` (reflect the caller's Origin) outside production — config.ts
      // refuses to boot otherwise — so the '*' fallback below only matters
      // for a dev-mode request that somehow carries no Origin header at all.
      const allowOrigin = config.webOrigin === true ? (req.headers.origin ?? '*') : config.webOrigin;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': allowOrigin,
      });
      // Node buffers the header block until the first write() otherwise, so a
      // client sitting on an empty stream (nothing captured yet, heartbeat
      // 25s away) never sees the connection open.
      reply.raw.flushHeaders();

      registerSseConnection(reply.raw);

      let closed = false;

      // Fetched fresh per message rather than once at connection open: a
      // secret set or changed while this connection is open should apply to
      // the very next captured request, not just ones after a reconnect.
      // The lookup makes this write async, so the client can disconnect
      // (setting `closed`) before it resolves — checked below rather than
      // writing to an already-destroyed socket.
      const unsubscribe = subscribeToRequests(id, (row) => {
        getSigningSecret(id)
          .then((secret) => {
            if (closed) return;
            const signature = computeSignatureStatus(row.body, row.body_is_binary, row.truncated, row.headers, secret);
            reply.raw.write(`data: ${JSON.stringify({ ...row, signature })}\n\n`);
          })
          .catch((err) => req.log.error({ err }, 'failed to compute signature status for a live request'));
      });

      const heartbeat = setInterval(() => {
        reply.raw.write(': heartbeat\n\n');
      }, HEARTBEAT_MS);

      req.raw.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        releaseSseSlot(id, req.ip);
        unregisterSseConnection(reply.raw);
      });

      reply.hijack();
    },
  );
}

import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { startExpiredEndpointCleanup } from './cleanup.js';
import { registerErrorHandlers } from './errorHandlers.js';
import { startResourceUsageTracking } from './limits.js';
import { endpointRoutes } from './routes/endpoints.js';
import { streamRoutes } from './routes/stream.js';
import { webhookRoutes } from './routes/webhook.js';

// `true` would trust an X-Forwarded-For from any client, letting a caller
// forge their own IP and defeat every per-IP rate limit. A bare hop count
// has the same problem — it can't validate who the immediate peer actually
// is — which is why Fastify's types don't even accept a number here.
// TRUST_PROXY must instead name the specific IP/CIDR(s) of the real reverse
// proxy in front of this process; only forwarding headers from those
// addresses are trusted. Defaults to loopback for local development, where
// nothing else should be reachable as a peer anyway.
const trustProxy = (process.env.TRUST_PROXY ?? '127.0.0.1,::1').split(',').map((entry) => entry.trim());

const app = Fastify({
  logger: true,
  trustProxy,
  // The default request id is a per-process counter (e.g. "req-1"), which
  // collides across instances and restarts — exactly where a correlation id
  // in an error response needs to keep pointing at the right log line.
  genReqId: () => randomUUID(),
  // The bounded stream parser drains every byte of an incoming body no
  // matter how slowly it arrives, so without a ceiling a client trickling
  // data could hold a connection — and the worker handling it — open
  // indefinitely. requestTimeout bounds how long headers + body may take;
  // connectionTimeout bounds how long an idle socket may sit open (the SSE
  // route's 25s heartbeat keeps a real stream well under it).
  requestTimeout: 30_000,
  connectionTimeout: 60_000,
  keepAliveTimeout: 5_000,
  // Caps requests served over one kept-alive socket so a single connection
  // can't be reused indefinitely to sidestep per-request overhead.
  maxRequestsPerSocket: 1000,
  routerOptions: {
    // The only path param outside the SSE/webhook wildcard is the 12-char
    // endpoint id; the wildcard route accepts an arbitrary sub-path, so
    // this stays generous rather than tight.
    maxParamLength: 500,
  },
});
app.log.info({ trustProxy }, 'trustProxy configured');
registerErrorHandlers(app);

// The web client and API live on different origins even in production
// (Vercel + Fly.io), so CORS is always needed, not just in dev.
await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? true,
});

// The default in-memory store resets on every deploy and doesn't apply
// across instances, so limits are backed by Redis whenever REDIS_URL is
// set. Without it every process tracks its own counters — fine for local
// development, not for anything running more than one instance.
let redisStore: Redis | undefined;
if (process.env.REDIS_URL) {
  redisStore = new Redis(process.env.REDIS_URL, { connectTimeout: 500, maxRetriesPerRequest: 1 });
} else {
  app.log.warn('REDIS_URL not set — rate limits are in-memory and per-instance');
}

// Registered globally so every route is covered by default, even one added
// later without its own override; routes that need a different ceiling set
// their own `config.rateLimit` (see routes/endpoints.js, routes/webhook.js,
// routes/stream.js). skipOnError keeps capture and browsing available if
// Redis itself is briefly unreachable, rather than a store outage taking
// down the whole app.
await app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  redis: redisStore,
  skipOnError: true,
});

app.register(endpointRoutes);
app.register(streamRoutes);
app.register(webhookRoutes);

startExpiredEndpointCleanup();
startResourceUsageTracking(app.log);

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

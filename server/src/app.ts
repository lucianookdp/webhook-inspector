import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import * as config from './config.js';
import { registerErrorHandlers } from './errorHandlers.js';
import { loggerOptions } from './logging.js';
import { adminRoutes } from './routes/admin.js';
import { endpointRoutes } from './routes/endpoints.js';
import { forwardRoutes } from './routes/forward.js';
import { healthRoutes } from './routes/health.js';
import { streamRoutes } from './routes/stream.js';
import { webhookRoutes } from './routes/webhook.js';

// Builds and configures the Fastify instance without starting it — no
// .listen(), no cleanup interval, no signal handlers. index.js is the thin
// entry point that does those; this is what tests build and drive with
// fastify.inject() instead of a real socket.
export async function buildApp(): Promise<FastifyInstance> {
  // `true` would trust an X-Forwarded-For from any client, letting a caller
  // forge their own IP and defeat every per-IP rate limit. A bare hop count
  // has the same problem — it can't validate who the immediate peer actually
  // is — which is why Fastify's types don't even accept a number here.
  // config.trustProxy instead names the specific IP/CIDR(s) of the real
  // reverse proxy in front of this process; only forwarding headers from
  // those addresses are trusted. Defaults to loopback for local development,
  // where nothing else should be reachable as a peer anyway.
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: config.trustProxy,
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
  app.log.info({ trustProxy: config.trustProxy }, 'trustProxy configured');
  registerErrorHandlers(app);

  // The web client and API live on different origins even in production
  // (Vercel + Fly.io), so CORS is always needed, not just in dev. config.ts
  // already refused to boot if WEB_ORIGIN is unset in production, so the
  // permissive `true` case here can only be reached in development.
  await app.register(cors, {
    origin: config.webOrigin,
    // @fastify/cors defaults to GET,HEAD,POST only. That's too narrow twice
    // over here: the signing-secret route needs PUT, and the capture route
    // (routes/webhook.js) deliberately accepts *any* method via app.all() —
    // "send any HTTP request" is the app's whole pitch, including one sent
    // from a browser's own fetch() rather than a real server-to-server
    // webhook delivery (which isn't subject to CORS at all).
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // This API only ever returns JSON, never HTML, so a content-security-policy
  // header here has nothing to defend — the frontend's own CSP and referrer
  // meta tags (web/index.html) are what actually matter for a page URL that
  // carries the endpoint id. The rest of helmet's defaults still apply here,
  // including X-Content-Type-Options: nosniff and X-Frame-Options: DENY.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
  });

  // The default in-memory store resets on every deploy and doesn't apply
  // across instances, so limits are backed by Redis whenever REDIS_URL is
  // set. Without it every process tracks its own counters — fine for local
  // development, not for anything running more than one instance.
  let redisStore: Redis | undefined;
  if (config.redisUrl) {
    redisStore = new Redis(config.redisUrl, { connectTimeout: 500, maxRetriesPerRequest: 1 });
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

  app.register(adminRoutes);
  app.register(endpointRoutes);
  app.register(forwardRoutes);
  app.register(healthRoutes);
  app.register(streamRoutes);
  app.register(webhookRoutes);

  return app;
}

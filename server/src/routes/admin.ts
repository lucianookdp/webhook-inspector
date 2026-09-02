import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as config from '../config.js';
import { getUsageStats } from '../stats.js';

const BEARER_PREFIX = 'Bearer ';

// Constant-time comparison, same rationale as signature.js: a naive ===
// would let response-time differences leak how many leading characters of
// a guess were correct.
function tokenMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/stats',
    // Tight ceiling: this route only ever needs to be called by the one
    // person who holds the token, and a low limit slows down anyone trying
    // to guess it.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // No ADMIN_TOKEN configured means this deployment didn't opt into an
      // admin surface at all — 404, not 401, so the route's existence isn't
      // even disclosed.
      if (!config.adminToken) {
        reply.code(404).send({ error: 'not found' });
        return;
      }

      const header = req.headers.authorization;
      const provided = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
      if (!provided || !tokenMatches(provided, config.adminToken)) {
        reply.code(401).send({ error: 'unauthorized' });
        return;
      }

      reply.send(await getUsageStats());
    },
  );
}

import type { FastifyInstance } from 'fastify';

// Liveness only — deliberately doesn't touch the database or Redis. A
// health check that depends on either would make an unrelated database
// blip look like this process itself needs restarting, which is the wrong
// remedy: it wouldn't bring the database back and would just cycle
// machines for no benefit. What actually depends on the database (the
// capture and read routes) already reports its own failures on those paths.
export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    // A generous, dedicated ceiling: both Fly's own health checker and any
    // external uptime monitor poll this far more often than the app's
    // default per-route limit would allow, and serving it is trivial.
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      reply.code(200).send('ok');
    },
  );
}

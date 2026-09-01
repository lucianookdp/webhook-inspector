import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Below 500, a statusCode was set deliberately by us or by a trusted plugin
// (schema validation, rate limiting) and the message is safe to relay as-is.
// Anything else — including every Postgres error, which never sets
// statusCode — is treated as internal and never shown to the caller: a raw
// pg error can carry constraint names, table names, and query fragments.
function isTrustedClientError(err: FastifyError): boolean {
  return typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500;
}

export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    if (isTrustedClientError(err)) {
      reply.code(err.statusCode ?? 400).send({ error: err.message });
      return;
    }

    req.log.error({ err }, 'unhandled error');
    reply.code(500).send({ error: 'internal error', correlationId: req.id });
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({ error: 'not found' });
  });
}

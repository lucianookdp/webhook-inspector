import type { FastifyServerOptions } from 'fastify';
import { maskIp } from './ip.js';

// Matches the 12-character alphanumeric id from id.js. The endpoint id is
// the only secret protecting an endpoint, so it must never reach the logs —
// dropping the query string too covers the pagination cursor, which encodes
// row data.
function redactRoute(url: string): string {
  const path = url.split('?')[0];
  return path.replace(/\/[A-Za-z0-9]{12}(?=\/|$)/g, '/:id');
}

// Fastify's default request logging includes the full URL (path + query
// string, and the endpoint id lives in the path) and the caller's exact IP.
// Overriding the serializers — rather than trusting every future log call to
// leave these out — is what actually keeps them out of the logs.
export const loggerOptions: FastifyServerOptions['logger'] = {
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'body'],
    censor: '[redacted]',
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        route: redactRoute(req.url),
        remoteAddress: maskIp(req.ip),
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
};

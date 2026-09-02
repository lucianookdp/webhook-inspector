import type { FastifyInstance } from 'fastify';

export interface EndpointInfo {
  id: string;
  expiresAt: string;
}

let nextFakeIp = 1;

// Rate-limit and X-Forwarded-For tests need requests to appear to come from
// distinct peers so they don't share a limiter bucket with unrelated tests
// in the same file/process.
export function freshIp(): string {
  nextFakeIp += 1;
  return `10.99.${Math.floor(nextFakeIp / 256)}.${nextFakeIp % 256}`;
}

export async function createEndpoint(app: FastifyInstance, remoteAddress = freshIp()): Promise<EndpointInfo> {
  const res = await app.inject({ method: 'POST', url: '/api/endpoints', remoteAddress });
  if (res.statusCode !== 201) {
    throw new Error(`failed to create endpoint: ${res.statusCode} ${res.body}`);
  }
  return res.json();
}

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createEndpoint } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

const TOKEN = 'a-very-secret-admin-token';

let app: FastifyInstance;
let teardown: () => Promise<void>;

// Must be set before createTestApp() dynamically imports app.js (and
// therefore config.js, which reads ADMIN_TOKEN at module-load time) — same
// ordering constraint documented in testApp.ts for PGOPTIONS/DATABASE_URL.
before(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  ({ app, teardown } = await createTestApp());
});

after(async () => {
  delete process.env.ADMIN_TOKEN;
  await teardown();
});

function getStats(token?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/admin/stats',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test('requires an Authorization header', async () => {
  const res = await getStats();
  assert.equal(res.statusCode, 401);
});

test('rejects the wrong token', async () => {
  const res = await getStats('the-wrong-token');
  assert.equal(res.statusCode, 401);
});

test('accepts the configured token and returns usage stats', async () => {
  await createEndpoint(app);
  const res = await getStats(TOKEN);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.activeEndpoints >= 1);
  assert.ok(body.totalEndpointsCreated >= 1);
  assert.equal(typeof body.totalRequestsCaptured, 'number');
  assert.ok(Array.isArray(body.daily));
});

test('a non-Bearer Authorization header is rejected', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { authorization: TOKEN } });
  assert.equal(res.statusCode, 401);
});

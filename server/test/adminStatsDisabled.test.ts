import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;

before(async () => {
  delete process.env.ADMIN_TOKEN;
  ({ app, teardown } = await createTestApp());
});

after(() => teardown());

test('the admin route 404s, not 401, when ADMIN_TOKEN is not configured', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/admin/stats',
    headers: { authorization: 'Bearer whatever' },
  });
  assert.equal(res.statusCode, 404);
});

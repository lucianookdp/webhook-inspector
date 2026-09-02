import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;

before(async () => {
  ({ app, teardown } = await createTestApp());
});

after(() => teardown());

test('GET /health responds 200 ok without touching the database', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

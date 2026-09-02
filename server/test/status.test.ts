import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createEndpoint } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let pool: Pool;
let teardown: () => Promise<void>;

before(async () => {
  ({ app, pool, teardown } = await createTestApp());
});

after(() => teardown());

const UNKNOWN_ID = '000000000000';

test('unknown endpoint returns 404 for capture and stream', async () => {
  const capture = await app.inject({ method: 'POST', url: `/w/${UNKNOWN_ID}` });
  assert.equal(capture.statusCode, 404);

  const stream = await app.inject({ method: 'GET', url: `/api/endpoints/${UNKNOWN_ID}/stream` });
  assert.equal(stream.statusCode, 404);
});

test('expired endpoint returns 410 for capture and stream', async () => {
  const { id } = await createEndpoint(app);
  await pool.query("UPDATE endpoints SET expires_at = now() - interval '1 hour' WHERE id = $1", [id]);

  const capture = await app.inject({ method: 'POST', url: `/w/${id}` });
  assert.equal(capture.statusCode, 410);

  const stream = await app.inject({ method: 'GET', url: `/api/endpoints/${id}/stream` });
  assert.equal(stream.statusCode, 410);
});

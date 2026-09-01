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

const malformedIds = ['too-short', 'has-special-chars!!', 'waytoolongtobeavalidendpointid'];

test('a malformed endpoint id is rejected by schema validation with 400, on capture', async () => {
  for (const id of malformedIds) {
    const res = await app.inject({ method: 'POST', url: `/w/${id}` });
    assert.equal(res.statusCode, 400, `id ${JSON.stringify(id)} should be rejected`);
    assert.doesNotMatch(res.body, /stack|Error:/);
  }
});

test('a malformed endpoint id is rejected by schema validation with 400, on the requests listing', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/endpoints/not-a-valid-id/requests' });
  assert.equal(res.statusCode, 400);
});

test('a malformed endpoint id is rejected by schema validation with 400, on stream', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/endpoints/not-a-valid-id/stream' });
  assert.equal(res.statusCode, 400);
});

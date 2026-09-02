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

const malformedIds = ['not-a-valid-id!!', 'UPPER_WITH_UNDERSCORE', '-leading-hyphen', 'ab'];

// The capture route (routes/webhook.js) accepts either the random id or a
// user-chosen slug (see schemas.js's captureIdentifierParamsSchema), so
// this only covers input matching neither shape — a string long enough and
// plain enough to look like a slug (e.g. "too-short", named for its
// pre-named-endpoints role in this test) is now syntactically valid and
// covered by the 404 case below instead.
test('a malformed endpoint id is rejected by schema validation with 400, on capture', async () => {
  for (const id of malformedIds) {
    const res = await app.inject({ method: 'POST', url: `/w/${id}` });
    assert.equal(res.statusCode, 400, `id ${JSON.stringify(id)} should be rejected`);
    assert.doesNotMatch(res.body, /stack|Error:/);
  }
});

test('a syntactically valid but unregistered id or slug 404s on capture rather than failing schema validation', async () => {
  const unknown = ['too-short', 'waytoolongtobeavalidendpointid'];
  for (const id of unknown) {
    const res = await app.inject({ method: 'POST', url: `/w/${id}` });
    assert.equal(res.statusCode, 404, `id ${JSON.stringify(id)} should 404, not fail schema validation`);
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

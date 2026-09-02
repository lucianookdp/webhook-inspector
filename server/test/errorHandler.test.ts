import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createEndpoint } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;

before(async () => {
  ({ app, teardown } = await createTestApp());
});

after(() => teardown());

test('the error handler returns no stack trace and no database detail on an induced failure', async () => {
  const { id } = await createEndpoint(app);

  // A NUL byte is valid UTF-8 (so the bounded parser decodes it as text
  // rather than flipping to binary/base64), but Postgres's text/jsonb
  // storage can't represent it — a real, unmocked driver error, not an
  // injected one, exactly the kind that could otherwise leak a raw pg
  // message like "invalid byte sequence for encoding \"UTF8\": 0x00".
  const payload = Buffer.concat([Buffer.from('hello'), Buffer.from([0x00]), Buffer.from('world')]);
  const res = await app.inject({
    method: 'POST',
    url: `/w/${id}`,
    headers: { 'content-type': 'text/plain' },
    payload,
  });

  assert.equal(res.statusCode, 500);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ['correlationId', 'error']);
  assert.equal(body.error, 'internal error');
  assert.match(body.correlationId, /^[0-9a-f-]{36}$/);

  const raw = res.body;
  assert.doesNotMatch(raw, /invalid byte sequence/i);
  assert.doesNotMatch(raw, /at Object|at async|node_modules/);
  // \b avoids a false match on "correlationId", the one legitimate field
  // in the response that happens to contain "relation" as a substring.
  assert.doesNotMatch(raw, /\brelation\b|\bconstraint\b|column ".*" of/i);
});

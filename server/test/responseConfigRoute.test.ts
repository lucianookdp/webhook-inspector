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

function setResponseConfig(
  endpointId: string,
  config: { status: number | null; body: string | null; contentType: string | null },
) {
  return app.inject({ method: 'PUT', url: `/api/endpoints/${endpointId}/response-config`, payload: config });
}

test('the capture route replies 200 "ok" by default', async () => {
  const endpoint = await createEndpoint(app);
  const res = await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('a configured status and body are used for the next capture', async () => {
  const endpoint = await createEndpoint(app);
  const setRes = await setResponseConfig(endpoint.id, {
    status: 503,
    body: 'service unavailable, retry me',
    contentType: null,
  });
  assert.equal(setRes.statusCode, 204);

  const res = await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body, 'service unavailable, retry me');
});

test('a configured content-type is applied to the response', async () => {
  const endpoint = await createEndpoint(app);
  await setResponseConfig(endpoint.id, { status: 201, body: '{"ok":true}', contentType: 'application/json' });

  const res = await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  assert.equal(res.statusCode, 201);
  // Fastify appends "; charset=utf-8" to a string reply's content-type by
  // default, so this checks the configured type is honored rather than the
  // exact header value.
  assert.ok(res.headers['content-type']?.toString().startsWith('application/json'));
  assert.equal(res.body, '{"ok":true}');
});

test('setting all fields to null resets to the default response', async () => {
  const endpoint = await createEndpoint(app);
  await setResponseConfig(endpoint.id, { status: 500, body: 'broken', contentType: null });
  await setResponseConfig(endpoint.id, { status: null, body: null, contentType: null });

  const res = await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('the configured status/body still applies to the request capture itself', async () => {
  const endpoint = await createEndpoint(app);
  await setResponseConfig(endpoint.id, { status: 500, body: 'error', contentType: null });

  await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/json' },
    payload: '{"hello":"world"}',
  });

  const listing = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  const body = listing.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].body, '{"hello":"world"}');
  assert.deepEqual(body.responseConfig, { status: 500, body: 'error', contentType: null });
});

test('rejects a status code out of the allowed range', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setResponseConfig(endpoint.id, { status: 999, body: null, contentType: null });
  assert.equal(res.statusCode, 400);
});

test('rejects a 1xx status code', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setResponseConfig(endpoint.id, { status: 101, body: null, contentType: null });
  assert.equal(res.statusCode, 400);
});

test('404s configuring the response for an unknown endpoint', async () => {
  const res = await setResponseConfig('aaaaaaaaaaaa', { status: 200, body: null, contentType: null });
  assert.equal(res.statusCode, 404);
});

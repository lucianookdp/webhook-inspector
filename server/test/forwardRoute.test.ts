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

async function captureOne(endpointId: string): Promise<{ requestId: string }> {
  const capture = await app.inject({
    method: 'POST',
    url: `/w/${endpointId}`,
    headers: { 'content-type': 'application/json' },
    payload: '{"hello":"world"}',
  });
  assert.equal(capture.statusCode, 200);
  const listing = await app.inject({ method: 'GET', url: `/api/endpoints/${endpointId}/requests` });
  return { requestId: listing.json().items[0].id };
}

function forward(endpointId: string, requestId: string, url: string) {
  return app.inject({
    method: 'POST',
    url: `/api/endpoints/${endpointId}/requests/${requestId}/forward`,
    payload: { url },
  });
}

test('rejects a loopback target as blocked, not a network error', async () => {
  const endpoint = await createEndpoint(app);
  const { requestId } = await captureOne(endpoint.id);

  const res = await forward(endpoint.id, requestId, 'http://127.0.0.1:9/whatever');
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /not a permitted forward target/);
});

test('rejects a hostname that resolves to a private address', async () => {
  const endpoint = await createEndpoint(app);
  const { requestId } = await captureOne(endpoint.id);

  const res = await forward(endpoint.id, requestId, 'http://localhost/whatever');
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /disallowed address/);
});

test('rejects the cloud metadata address specifically', async () => {
  const endpoint = await createEndpoint(app);
  const { requestId } = await captureOne(endpoint.id);

  const res = await forward(endpoint.id, requestId, 'http://169.254.169.254/latest/meta-data/');
  assert.equal(res.statusCode, 400);
});

test('rejects a non-http(s) scheme before any DNS lookup happens', async () => {
  const endpoint = await createEndpoint(app);
  const { requestId } = await captureOne(endpoint.id);

  const res = await forward(endpoint.id, requestId, 'file:///etc/passwd');
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /http:\/\/ or https:\/\//);
});

test('rejects a malformed url', async () => {
  const endpoint = await createEndpoint(app);
  const { requestId } = await captureOne(endpoint.id);

  const res = await forward(endpoint.id, requestId, 'not a url');
  assert.equal(res.statusCode, 400);
});

test('404s for a request id that does not belong to the endpoint', async () => {
  const endpointA = await createEndpoint(app);
  const endpointB = await createEndpoint(app);
  const { requestId } = await captureOne(endpointA.id);

  const res = await forward(endpointB.id, requestId, 'https://example.com/');
  assert.equal(res.statusCode, 404);
});

test('404s for an unknown endpoint', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/endpoints/aaaaaaaaaaaa/requests/00000000-0000-0000-0000-000000000000/forward',
    payload: { url: 'https://example.com/' },
  });
  assert.equal(res.statusCode, 404);
});

test('rejects a malformed request id via schema before touching the database', async () => {
  const endpoint = await createEndpoint(app);
  const res = await app.inject({
    method: 'POST',
    url: `/api/endpoints/${endpoint.id}/requests/not-a-uuid/forward`,
    payload: { url: 'https://example.com/' },
  });
  assert.equal(res.statusCode, 400);
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createEndpoint, freshIp } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;

before(async () => {
  ({ app, teardown } = await createTestApp());
});

after(() => teardown());

async function firstRequest(id: string) {
  const res = await app.inject({ method: 'GET', url: `/api/endpoints/${id}/requests` });
  assert.equal(res.statusCode, 200);
  const page = res.json();
  assert.equal(page.items.length, 1);
  return page.items[0];
}

test('a body under the cap is stored intact', async () => {
  const endpoint = await createEndpoint(app);
  const body = JSON.stringify({ hello: 'world' });
  const capture = await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/json' },
    payload: body,
  });
  assert.equal(capture.statusCode, 200);

  const row = await firstRequest(endpoint.id);
  assert.equal(row.body, body);
  assert.equal(row.truncated, false);
  assert.equal(row.body_is_binary, false);
  assert.equal(row.size_bytes, Buffer.byteLength(body));
});

test('a body over 256 KB is truncated to exactly the cap, full size still recorded', async () => {
  const endpoint = await createEndpoint(app);
  const capBytes = 256 * 1024;
  const overBy = 1000;
  const body = 'a'.repeat(capBytes + overBy);

  const capture = await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'text/plain' },
    payload: body,
  });
  assert.equal(capture.statusCode, 200);

  const row = await firstRequest(endpoint.id);
  assert.equal(Buffer.byteLength(row.body), capBytes);
  assert.equal(row.truncated, true);
  assert.equal(row.size_bytes, capBytes + overBy);
});

test('an invalid-UTF-8 body sets body_is_binary and round-trips through base64', async () => {
  const endpoint = await createEndpoint(app);
  // 0xff 0xfe is not valid UTF-8 in this position.
  const raw = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]);

  const capture = await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: raw,
  });
  assert.equal(capture.statusCode, 200);

  const row = await firstRequest(endpoint.id);
  assert.equal(row.body_is_binary, true);
  assert.deepEqual(Buffer.from(row.body, 'base64'), raw);
});

test('every HTTP method reaches the capture handler', async () => {
  const endpoint = await createEndpoint(app);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const res = await app.inject({ method, url: `/w/${endpoint.id}`, remoteAddress: freshIp() });
    assert.equal(res.statusCode, 200, `${method} should reach the handler`);
  }

  const list = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  assert.equal(list.json().items.length, 5);
});

test('an unknown content-type still reaches the handler and is captured', async () => {
  const endpoint = await createEndpoint(app);
  const res = await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/x-widget-vendor-format' },
    payload: 'whatever this is',
  });
  assert.equal(res.statusCode, 200);

  const row = await firstRequest(endpoint.id);
  assert.equal(row.content_type, 'application/x-widget-vendor-format');
  assert.equal(row.body, 'whatever this is');
});

test('query string and headers are persisted as JSON and read back unchanged', async () => {
  const endpoint = await createEndpoint(app);
  const res = await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}?foo=bar&baz=qux`,
    headers: { 'content-type': 'text/plain', 'x-custom-header': 'custom-value' },
    payload: '',
  });
  assert.equal(res.statusCode, 200);

  const row = await firstRequest(endpoint.id);
  assert.deepEqual(row.query, { foo: 'bar', baz: 'qux' });
  assert.equal(row.headers['x-custom-header'], 'custom-value');
});

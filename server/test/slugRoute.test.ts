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

function setSlug(endpointId: string, slug: string | null) {
  return app.inject({ method: 'PUT', url: `/api/endpoints/${endpointId}/slug`, payload: { slug } });
}

test('a fresh endpoint has no slug', async () => {
  const endpoint = await createEndpoint(app);
  const res = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  assert.equal(res.json().slug, null);
});

test('setting a slug makes it show up in the requests listing', async () => {
  const endpoint = await createEndpoint(app);
  const setRes = await setSlug(endpoint.id, 'my-cool-endpoint');
  assert.equal(setRes.statusCode, 200);
  assert.deepEqual(setRes.json(), { slug: 'my-cool-endpoint' });

  const res = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  assert.equal(res.json().slug, 'my-cool-endpoint');
});

test('a request sent to the slug URL is captured under the same endpoint as the id URL', async () => {
  const endpoint = await createEndpoint(app);
  await setSlug(endpoint.id, 'orders-webhook');

  const captureRes = await app.inject({ method: 'POST', url: '/w/orders-webhook', payload: 'hello' });
  assert.equal(captureRes.statusCode, 200);

  const listing = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  assert.equal(listing.json().items.length, 1);
  assert.equal(listing.json().items[0].body, 'hello');
});

test('a slug is normalized to lowercase and trimmed', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setSlug(endpoint.id, '  Shipping-Webhook  ');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().slug, 'shipping-webhook');
});

test('rejects a slug that is too short', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setSlug(endpoint.id, 'ab');
  assert.equal(res.statusCode, 400);
});

test('rejects a slug starting or ending with a hyphen', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setSlug(endpoint.id, '-orders');
  assert.equal(res.statusCode, 400);
});

test('rejects a slug with characters outside lowercase/digits/hyphen', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setSlug(endpoint.id, 'orders_webhook');
  assert.equal(res.statusCode, 400);
});

test('a slug already taken by another endpoint is rejected with 409', async () => {
  const first = await createEndpoint(app);
  const second = await createEndpoint(app);
  await setSlug(first.id, 'taken-name');

  const res = await setSlug(second.id, 'taken-name');
  assert.equal(res.statusCode, 409);
});

test('two endpoints can both have no slug at once', async () => {
  const first = await createEndpoint(app);
  const second = await createEndpoint(app);
  assert.equal((await setSlug(first.id, null)).statusCode, 200);
  assert.equal((await setSlug(second.id, null)).statusCode, 200);
});

test('null clears a previously set slug', async () => {
  const endpoint = await createEndpoint(app);
  await setSlug(endpoint.id, 'temporary-name');
  const res = await setSlug(endpoint.id, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().slug, null);

  const listing = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  assert.equal(listing.json().slug, null);
});

test('a freed slug can be claimed by another endpoint', async () => {
  const first = await createEndpoint(app);
  const second = await createEndpoint(app);
  await setSlug(first.id, 'shared-name');
  await setSlug(first.id, null);

  const res = await setSlug(second.id, 'shared-name');
  assert.equal(res.statusCode, 200);
});

test('404s setting a slug on an unknown endpoint', async () => {
  const res = await setSlug('aaaaaaaaaaaa', 'whatever');
  assert.equal(res.statusCode, 404);
});

test('404s capturing to an unknown slug', async () => {
  const res = await app.inject({ method: 'POST', url: '/w/no-such-slug' });
  assert.equal(res.statusCode, 404);
});

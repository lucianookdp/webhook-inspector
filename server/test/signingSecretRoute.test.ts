import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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

function setSecret(endpointId: string, secret: string | null) {
  return app.inject({ method: 'PUT', url: `/api/endpoints/${endpointId}/signing-secret`, payload: { secret } });
}

async function listRequests(endpointId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/endpoints/${endpointId}/requests` });
  return res.json();
}

test('a captured request is unconfigured before a secret is set', async () => {
  const endpoint = await createEndpoint(app);
  await app.inject({ method: 'POST', url: `/w/${endpoint.id}`, payload: 'hello' });

  const listing = await listRequests(endpoint.id);
  assert.equal(listing.signingSecretConfigured, false);
  assert.equal(listing.items[0].signature, 'unconfigured');
});

test('setting a secret makes a matching signature come back valid', async () => {
  const endpoint = await createEndpoint(app);
  const secret = 'a-real-secret';
  const setRes = await setSecret(endpoint.id, secret);
  assert.equal(setRes.statusCode, 204);

  const body = '{"ping":true}';
  const signature = createHmac('sha256', secret).update(body, 'utf-8').digest('hex');
  await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    payload: body,
  });

  const listing = await listRequests(endpoint.id);
  assert.equal(listing.signingSecretConfigured, true);
  assert.equal(listing.items[0].signature, 'valid');
});

test('a signature computed with the wrong secret comes back invalid', async () => {
  const endpoint = await createEndpoint(app);
  await setSecret(endpoint.id, 'the-real-secret');

  const body = '{"ping":true}';
  const signature = createHmac('sha256', 'a-different-secret').update(body, 'utf-8').digest('hex');
  await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    payload: body,
  });

  const listing = await listRequests(endpoint.id);
  assert.equal(listing.items[0].signature, 'invalid');
});

test('clearing the secret with null makes prior captures report unconfigured again', async () => {
  const endpoint = await createEndpoint(app);
  await setSecret(endpoint.id, 'a-secret');
  await app.inject({ method: 'POST', url: `/w/${endpoint.id}`, payload: 'hello' });

  const clearRes = await setSecret(endpoint.id, null);
  assert.equal(clearRes.statusCode, 204);

  const listing = await listRequests(endpoint.id);
  assert.equal(listing.signingSecretConfigured, false);
  assert.equal(listing.items[0].signature, 'unconfigured');
});

test('an empty string clears the secret the same as null', async () => {
  const endpoint = await createEndpoint(app);
  await setSecret(endpoint.id, 'a-secret');

  const res = await setSecret(endpoint.id, '');
  assert.equal(res.statusCode, 204);

  const listing = await listRequests(endpoint.id);
  assert.equal(listing.signingSecretConfigured, false);
});

test('404s setting a secret on an unknown endpoint', async () => {
  const res = await setSecret('aaaaaaaaaaaa', 'whatever');
  assert.equal(res.statusCode, 404);
});

test('rejects a secret over the length cap via schema', async () => {
  const endpoint = await createEndpoint(app);
  const res = await setSecret(endpoint.id, 'x'.repeat(600));
  assert.equal(res.statusCode, 400);
});

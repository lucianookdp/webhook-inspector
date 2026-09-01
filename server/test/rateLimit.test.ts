import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { freshIp } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;

before(async () => {
  ({ app, teardown } = await createTestApp());
});

after(() => teardown());

test('endpoint creation returns 429 past its 10/hour threshold', async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) {
    const res = await app.inject({ method: 'POST', url: '/api/endpoints', remoteAddress: ip });
    assert.equal(res.statusCode, 201, `request ${i + 1} should succeed`);
  }

  const res = await app.inject({ method: 'POST', url: '/api/endpoints', remoteAddress: ip });
  assert.equal(res.statusCode, 429);
});

test('capture returns 429 past its 100/minute threshold', async () => {
  const ip = freshIp();
  const endpointRes = await app.inject({ method: 'POST', url: '/api/endpoints', remoteAddress: freshIp() });
  const { id } = endpointRes.json();

  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'POST', url: `/w/${id}`, remoteAddress: ip });
    assert.equal(res.statusCode, 200, `capture ${i + 1} should succeed`);
  }

  const res = await app.inject({ method: 'POST', url: `/w/${id}`, remoteAddress: ip });
  assert.equal(res.statusCode, 429);
});

test('a forged X-Forwarded-For header does not reset the rate limit', async () => {
  // Not in the default TRUST_PROXY loopback allowlist, so this peer's own
  // forwarded headers must be ignored — matching a real untrusted client.
  const untrustedPeer = freshIp();

  for (let i = 0; i < 10; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      remoteAddress: untrustedPeer,
      // A different forged source on every request: if this were honored,
      // the limiter would see 10 different "clients" and never trip.
      headers: { 'x-forwarded-for': `203.0.113.${i}` },
    });
    assert.equal(res.statusCode, 201, `request ${i + 1} should succeed`);
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/endpoints',
    remoteAddress: untrustedPeer,
    headers: { 'x-forwarded-for': '203.0.113.250' },
  });
  assert.equal(res.statusCode, 429, 'the real peer address is what gets rate limited, not the forged header');
});

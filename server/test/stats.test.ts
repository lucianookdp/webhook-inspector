import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createEndpoint } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;
let getUsageStats: () => Promise<{
  activeEndpoints: number;
  totalEndpointsCreated: number;
  totalRequestsCaptured: number;
  daily: { day: string; endpointsCreated: number; requestsCaptured: number }[];
}>;

// stats.js imports db.js, which builds its pool at module-import time from
// env vars createTestApp() sets for this test's disposable schema — a
// static top-level import would evaluate it too early, same reason
// events.test.ts imports events.js dynamically.
before(async () => {
  ({ app, teardown } = await createTestApp());
  ({ getUsageStats } = await import('../src/stats.js'));
});

after(() => teardown());

test("creating an endpoint increments today's endpoints_created counter", async () => {
  const before_ = await getUsageStats();
  await createEndpoint(app);
  const after_ = await getUsageStats();
  assert.equal(after_.totalEndpointsCreated, before_.totalEndpointsCreated + 1);
});

test("capturing a request increments today's requests_captured counter", async () => {
  const endpoint = await createEndpoint(app);
  const before_ = await getUsageStats();
  await app.inject({ method: 'POST', url: `/w/${endpoint.id}`, payload: 'hello' });
  const after_ = await getUsageStats();
  assert.equal(after_.totalRequestsCaptured, before_.totalRequestsCaptured + 1);
});

test('multiple captures on the same day accumulate onto one row', async () => {
  const endpoint = await createEndpoint(app);
  const before_ = await getUsageStats();
  await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  await app.inject({ method: 'POST', url: `/w/${endpoint.id}` });
  const after_ = await getUsageStats();
  assert.equal(after_.totalRequestsCaptured, before_.totalRequestsCaptured + 3);
  // Still exactly one row for today, not three — this is the point of the
  // upsert (ON CONFLICT DO UPDATE) over a plain INSERT.
  const todayRows = after_.daily.filter((d) => d.day === new Date().toISOString().slice(0, 10));
  assert.equal(todayRows.length, 1);
});

test('activeEndpoints excludes a disabled endpoint (there is no public API for this — see README)', async () => {
  const { pool } = await import('../src/db.js');
  const endpoint = await createEndpoint(app);
  const before_ = await getUsageStats();
  assert.ok(before_.activeEndpoints >= 1);

  await pool.query('UPDATE endpoints SET disabled = true WHERE id = $1', [endpoint.id]);
  const after_ = await getUsageStats();
  assert.equal(after_.activeEndpoints, before_.activeEndpoints - 1);
});

test('a capture that fails validation does not increment the counter', async () => {
  const before_ = await getUsageStats();
  const res = await app.inject({ method: 'POST', url: '/w/no-such-endpoint-at-all' });
  assert.equal(res.statusCode, 404);
  const after_ = await getUsageStats();
  assert.equal(after_.totalRequestsCaptured, before_.totalRequestsCaptured);
});

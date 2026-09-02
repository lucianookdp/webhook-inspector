import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { RequestRow } from '../src/types.js';
import { createEndpoint } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let teardown: () => Promise<void>;
let pool: Pool;
let CHANNEL: string;
let stopEventListener: () => Promise<void>;
let subscribeToRequests: (endpointId: string, listener: (row: RequestRow) => void) => () => void;

// db.js builds its pool at module-import time from env vars createTestApp()
// sets for this test's disposable schema — a static top-level import here
// would evaluate db.js (and events.js, which imports it) too early and pick
// up whatever pool existed before that, same reason testApp.ts itself only
// imports app.js/db.js dynamically. events.js is loaded the same way here.
before(async () => {
  ({ app, teardown } = await createTestApp());
  ({ pool } = await import('../src/db.js'));
  const events = await import('../src/events.js');
  ({ CHANNEL, stopEventListener, subscribeToRequests } = events);
  await events.startEventListener(app.log);
});

after(async () => {
  await stopEventListener();
  await teardown();
});

function waitForNotification(endpointId: string, timeoutMs = 5000): Promise<RequestRow> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for the notification to arrive'));
    }, timeoutMs);
    const unsubscribe = subscribeToRequests(endpointId, (row) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(row);
    });
  });
}

// publishRequest already emits locally in-process — real multi-instance
// fan-out only happens over NOTIFY, so this simulates a second instance by
// issuing one directly rather than going through publishRequest.
async function notifyAsOtherInstance(endpointId: string, requestId: string): Promise<void> {
  const payload = JSON.stringify({ instanceId: 'some-other-instance', endpointId, requestId });
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
}

test('a NOTIFY from another instance delivers the row to local subscribers', async () => {
  const endpoint = await createEndpoint(app);
  const capture = await app.inject({
    method: 'POST',
    url: `/w/${endpoint.id}`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ fromOtherInstance: true }),
  });
  assert.equal(capture.statusCode, 200);

  const listing = await app.inject({ method: 'GET', url: `/api/endpoints/${endpoint.id}/requests` });
  const [row] = listing.json().items;

  const received = waitForNotification(endpoint.id);
  await notifyAsOtherInstance(endpoint.id, row.id);

  // RequestRow types received_at as a string because that's its shape once
  // serialized over HTTP — pg's driver actually hands back a real Date for
  // a timestamptz column, which is what the listener's row still is here.
  const notified = await received;
  const receivedAt = notified.received_at as unknown as Date;
  assert.deepEqual({ ...notified, received_at: receivedAt.toISOString() }, row);
});

test('a malformed payload on the shared channel is ignored, not fatal', async () => {
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, 'not valid json']);
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ unexpected: 'shape' })]);

  // Give the notifications time to actually reach and be processed by the
  // listener before checking that the process (and its DB pool) is still
  // healthy — proven by a completely unrelated request still working.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const res = await app.inject({ method: 'POST', url: '/api/endpoints' });
  assert.equal(res.statusCode, 201);
});

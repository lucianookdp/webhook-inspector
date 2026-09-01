import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createEndpoint } from './helpers/api.js';
import { createTestApp } from './helpers/testApp.js';

let app: FastifyInstance;
let pool: Pool;
let teardown: () => Promise<void>;

before(async () => {
  ({ app, pool, teardown } = await createTestApp());
});

after(() => teardown());

test('pagination returns a stable ordering with no duplicates and no gaps across page boundaries', async () => {
  const { id: endpointId } = await createEndpoint(app);

  const total = 130;
  await pool.query(
    `INSERT INTO requests (endpoint_id, method, path, query, headers, body, size_bytes, received_at)
     SELECT $1, 'POST', '/w/' || $1, '{}'::jsonb, '{}'::jsonb, 'seed-' || g, 4, now() - (g || ' seconds')::interval
     FROM generate_series(1, $2) AS g`,
    [endpointId, total],
  );

  const seenIds = new Set<string>();
  const orderedTimestamps: string[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const query = cursor ? `?limit=50&cursor=${cursor}` : '?limit=50';
    const res = await app.inject({ method: 'GET', url: `/api/endpoints/${endpointId}/requests${query}` });
    assert.equal(res.statusCode, 200);
    const page = res.json();
    pages += 1;

    assert.ok(page.items.length <= 50, 'a page never exceeds the requested limit');
    for (const item of page.items) {
      assert.ok(!seenIds.has(item.id), `id ${item.id} appeared on more than one page`);
      seenIds.add(item.id);
      orderedTimestamps.push(item.received_at);
    }

    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(seenIds.size, total, 'every seeded row was returned exactly once, with no gaps');
  assert.equal(pages, Math.ceil(total / 50));

  const sorted = [...orderedTimestamps].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  assert.deepEqual(orderedTimestamps, sorted, 'rows are ordered received_at DESC across the whole paginated sequence');
});

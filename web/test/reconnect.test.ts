import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeBackoffDelay } from '../src/backoff';
import { mergeMissedRequests } from '../src/mergeRequests';
import type { RequestRow } from '../src/types';

function row(id: string, receivedAt: string): RequestRow {
  return {
    id,
    method: 'POST',
    path: '/w/abc',
    query: {},
    headers: {},
    body: null,
    body_is_binary: false,
    truncated: false,
    content_type: null,
    ip: null,
    size_bytes: 0,
    received_at: receivedAt,
  };
}

test('mergeMissedRequests prepends rows the client never saw', () => {
  const existing = [row('b', '2024-01-01T00:00:02.000Z'), row('a', '2024-01-01T00:00:01.000Z')];
  const fetched = [row('c', '2024-01-01T00:00:03.000Z'), row('b', '2024-01-01T00:00:02.000Z')];

  const merged = mergeMissedRequests(existing, fetched);

  assert.deepEqual(
    merged.map((r) => r.id),
    ['c', 'b', 'a'],
  );
});

test('mergeMissedRequests is a no-op when nothing was missed', () => {
  const existing = [row('a', '2024-01-01T00:00:01.000Z')];
  const fetched = [row('a', '2024-01-01T00:00:01.000Z')];

  assert.equal(mergeMissedRequests(existing, fetched), existing);
});

test('computeBackoffDelay grows with attempt count but stays capped', () => {
  const first = computeBackoffDelay(0);
  const tenth = computeBackoffDelay(10);

  assert.ok(first >= 0 && first < 1000, `attempt 0 delay ${first} should be under 1s`);
  assert.ok(tenth >= 0 && tenth <= 30_000, `attempt 10 delay ${tenth} should stay under the 30s cap`);
});

test('computeBackoffDelay never returns a negative delay', () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.ok(computeBackoffDelay(attempt) >= 0);
  }
});

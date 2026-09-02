import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFilter } from '../src/filterRequests';
import type { RequestRow } from '../src/types';

function row(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'row-1',
    method: 'POST',
    path: '/w/abc123def456',
    query: { foo: 'bar' },
    headers: { 'x-custom': 'hello' },
    body: '{"greeting":"hi there"}',
    body_is_binary: false,
    truncated: false,
    content_type: 'application/json',
    ip: '127.0.0.0',
    size_bytes: 24,
    received_at: new Date().toISOString(),
    signature: 'unconfigured',
    ...overrides,
  };
}

test('with no method and no query, everything matches', () => {
  assert.equal(matchesFilter(row(), '', ''), true);
});

test('method filter matches case-insensitively', () => {
  assert.equal(matchesFilter(row({ method: 'POST' }), 'post', ''), true);
  assert.equal(matchesFilter(row({ method: 'POST' }), 'GET', ''), false);
});

test('text search matches the path', () => {
  assert.equal(matchesFilter(row({ path: '/w/xyz/orders/42' }), '', 'orders'), true);
  assert.equal(matchesFilter(row({ path: '/w/xyz/orders/42' }), '', 'invoices'), false);
});

test('text search matches the body', () => {
  assert.equal(matchesFilter(row({ body: '{"greeting":"hi there"}' }), '', 'hi there'), true);
});

test('text search matches headers', () => {
  assert.equal(matchesFilter(row({ headers: { 'x-event': 'payment.succeeded' } }), '', 'payment.succeeded'), true);
});

test('text search matches query params', () => {
  assert.equal(matchesFilter(row({ query: { status: 'failed' } }), '', 'failed'), true);
});

test('a null body does not throw when searching', () => {
  assert.equal(matchesFilter(row({ body: null }), '', 'anything'), false);
});

test('method and text filters combine with AND', () => {
  const r = row({ method: 'DELETE', path: '/w/xyz/orders/1' });
  assert.equal(matchesFilter(r, 'DELETE', 'orders'), true);
  assert.equal(matchesFilter(r, 'DELETE', 'invoices'), false);
  assert.equal(matchesFilter(r, 'POST', 'orders'), false);
});

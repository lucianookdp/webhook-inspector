import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExportFilename, serializeRequests } from '../src/exportRequests';
import type { RequestRow } from '../src/types';

function row(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'row-1',
    method: 'POST',
    path: '/w/abc123def456',
    query: {},
    headers: {},
    body: '{"hello":"world"}',
    body_is_binary: false,
    truncated: false,
    content_type: 'application/json',
    ip: '127.0.0.0',
    size_bytes: 18,
    received_at: '2024-01-01T00:00:00.000Z',
    signature: 'unconfigured',
    ...overrides,
  };
}

test('buildExportFilename includes the endpoint id', () => {
  assert.equal(buildExportFilename('abc123def456'), 'webhook-requests-abc123def456.json');
});

test('serializeRequests produces parseable, pretty-printed JSON', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' })];
  const json = serializeRequests(rows);

  assert.ok(json.includes('\n'), 'expected pretty-printed output with newlines');
  assert.deepEqual(JSON.parse(json), rows);
});

test('serializeRequests round-trips an empty list', () => {
  assert.deepEqual(JSON.parse(serializeRequests([])), []);
});

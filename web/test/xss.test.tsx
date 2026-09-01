import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestList } from '../src/RequestList';
import type { RequestRow } from '../src/types';

// A captured request body is attacker-controlled — the whole point of this
// tool is that anyone with the endpoint URL can send it anything — and it's
// rendered straight into the request detail pane. React escapes text
// children by default, so this only stays true as long as nothing here ever
// reaches for dangerouslySetInnerHTML (see 2.12).
function baseRow(overrides: Partial<RequestRow>): RequestRow {
  return {
    id: 'row-1',
    method: 'POST',
    path: '/w/abc123def456',
    query: {},
    headers: {},
    body: null,
    body_is_binary: false,
    truncated: false,
    content_type: null,
    ip: '127.0.0.0',
    size_bytes: 0,
    received_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderSelected(row: RequestRow): string {
  return renderToStaticMarkup(
    <RequestList requests={[row]} selectedId={row.id} onSelect={() => {}} newIds={new Set()} now={Date.now()} />,
  );
}

test('a script tag in a plain-text body renders escaped, not as an element', () => {
  const payload = '<script>alert(document.cookie)</script>';
  const row = baseRow({ body: payload, content_type: 'text/plain', size_bytes: payload.length });

  const html = renderSelected(row);

  assert.ok(!html.includes('<script>alert'), 'the raw script tag must never appear unescaped');
  assert.ok(html.includes('&lt;script&gt;'), 'React should have escaped it to entities');
});

test('a script tag inside a JSON string value renders escaped through the JSON view', () => {
  const payload = JSON.stringify({ evil: '<img src=x onerror=alert(1)>' });
  const row = baseRow({ body: payload, content_type: 'application/json', size_bytes: payload.length });

  const html = renderSelected(row);

  assert.ok(!html.includes('<img src=x onerror'), 'the raw tag must never appear unescaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'React should have escaped it to entities');
});

test('no component in the detail pane uses dangerouslySetInnerHTML', async () => {
  const files = ['../src/RequestList.tsx', '../src/JsonView.tsx'];
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  for (const relative of files) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const source = readFileSync(path, 'utf-8');
    assert.ok(!source.includes('dangerouslySetInnerHTML'), `${relative} must not use dangerouslySetInnerHTML`);
  }
});

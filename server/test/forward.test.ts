import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { buildForwardHeaders, performForward } from '../src/forward.js';

test('buildForwardHeaders drops hop-by-hop headers and sets host to the target', () => {
  const headers = buildForwardHeaders(
    {
      host: 'original-inspector.example',
      connection: 'keep-alive',
      'content-length': '42',
      'x-custom': 'keep-me',
      accept: ['application/json', 'text/plain'],
    },
    'target.example:8080',
  );

  assert.deepEqual(headers, {
    'x-custom': 'keep-me',
    accept: 'application/json, text/plain',
    host: 'target.example:8080',
  });
});

// performForward is tested directly against a real local server rather than
// through the full route, because the route's SSRF check (ssrf.js) would
// correctly refuse to connect to a loopback address like this test server —
// this file tests the HTTP mechanics on the other side of that check.
let server: http.Server;
let port: number;
let lastRequest: { method?: string; headers: http.IncomingHttpHeaders; body: string } | undefined;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      lastRequest = { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf-8') };
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(300 * 1024));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json', 'x-reply': 'yes' });
      res.end(JSON.stringify({ received: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  port = address.port;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('performForward sends the method, headers, and body, and returns the response', async () => {
  const url = new URL(`http://127.0.0.1:${port}/hook`);
  const result = await performForward(
    url,
    '127.0.0.1',
    'POST',
    { 'content-type': 'application/json', 'x-signature': 'abc123', host: url.host },
    Buffer.from('{"hello":"world"}'),
  );

  assert.equal(result.status, 201);
  assert.equal(result.headers['x-reply'], 'yes');
  assert.deepEqual(JSON.parse(result.body), { received: true });
  assert.equal(result.bodyTruncated, false);
  assert.ok(result.durationMs >= 0);

  assert.equal(lastRequest?.method, 'POST');
  assert.equal(lastRequest?.headers['x-signature'], 'abc123');
  assert.equal(lastRequest?.body, '{"hello":"world"}');
});

test('performForward truncates a response body over the cap instead of buffering it all', async () => {
  const url = new URL(`http://127.0.0.1:${port}/big`);
  const result = await performForward(url, '127.0.0.1', 'GET', { host: url.host }, undefined);

  assert.equal(result.bodyTruncated, true);
  assert.ok(result.body.length <= 256 * 1024);
});

test('performForward rejects when nothing is listening on the target port', async () => {
  // routes/forward.js turns this rejection into a 502 rather than letting
  // it become an unhandled error — this proves the rejection itself
  // happens cleanly rather than hanging or crashing the process.
  const url = new URL('http://127.0.0.1:1/unreachable');
  await assert.rejects(() => performForward(url, '127.0.0.1', 'GET', { host: url.host }, undefined));
});

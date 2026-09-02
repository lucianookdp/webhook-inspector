import http from 'node:http';
import https from 'node:https';
import { resolveSafeAddress } from './ssrf.js';

const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
]);

// The captured headers were read off the original request to this
// inspector; hop-by-hop ones don't mean anything to a fresh connection to a
// different target, and host has to become the target's own regardless of
// what the original caller sent.
export function buildForwardHeaders(original: Record<string, unknown>, targetHost: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(original)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(', ');
  }
  headers.host = targetHost;
  return headers;
}

function flattenResponseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') flat[key] = value;
    else if (Array.isArray(value)) flat[key] = value.join(', ');
  }
  return flat;
}

// Performs the actual HTTP call to a pre-resolved, pre-validated address —
// kept separate from address validation (ssrf.js) so it's directly testable
// against a real local server without that server needing to sit outside
// the very ranges this feature exists to keep forwards out of.
export function performForward(
  targetUrl: URL,
  resolvedAddress: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
): Promise<ForwardResult> {
  const isHttps = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        // Connecting to the address resolveSafeAddress already validated,
        // rather than the hostname, is what stops a second DNS lookup here
        // from resolving somewhere different than what was checked.
        hostname: resolvedAddress,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers,
        // TLS still needs the real hostname for SNI and certificate
        // matching even though the connection itself goes to the IP.
        servername: isHttps ? targetUrl.hostname : undefined,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;

        res.on('data', (chunk: Buffer) => {
          if (received >= MAX_RESPONSE_BYTES) {
            truncated = true;
            return;
          }
          const remaining = MAX_RESPONSE_BYTES - received;
          if (chunk.length <= remaining) {
            chunks.push(chunk);
            received += chunk.length;
          } else {
            chunks.push(chunk.subarray(0, remaining));
            received += remaining;
            truncated = true;
          }
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenResponseHeaders(res.headers),
            body: Buffer.concat(chunks).toString('utf-8'),
            bodyTruncated: truncated,
            durationMs: Date.now() - start,
          });
        });

        res.on('error', reject);
      },
    );

    req.on('timeout', () => req.destroy(new Error('forward request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// The route's entry point: validates the target is safe to connect to, then
// performs the call. Redirects are deliberately not followed — chasing one
// would mean re-validating the new target through the same check, and
// simply not doing that is both simpler and impossible to get wrong; the
// 3xx response (with its Location header) is returned to the caller as-is.
export async function forwardRequest(
  targetUrl: URL,
  method: string,
  originalHeaders: Record<string, unknown>,
  body: Buffer | undefined,
): Promise<ForwardResult> {
  const { address } = await resolveSafeAddress(targetUrl.hostname);
  const headers = buildForwardHeaders(originalHeaders, targetUrl.host);
  return performForward(targetUrl, address, method, headers, body);
}

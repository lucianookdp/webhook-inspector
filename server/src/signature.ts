import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureStatus = 'unconfigured' | 'unknown' | 'no-header' | 'valid' | 'invalid';

// Headers common webhook providers use for an HMAC-SHA256 signature over
// the raw request body. Checked in order; the first one present in the
// captured headers is used — a provider doesn't send more than one of
// these on the same request, so there's no real ambiguity.
const SIGNATURE_HEADERS = [
  'x-hub-signature-256', // GitHub
  'x-signature-256',
  'x-webhook-signature',
  'x-shopify-hmac-sha256', // base64, everything else here is typically hex
  'x-signature',
];

// GitHub-style "sha256=<hex>" — an algorithm name before the first '=',
// short enough that it can't be mistaken for part of the encoded signature
// itself.
function stripAlgorithmPrefix(value: string): string {
  const eq = value.indexOf('=');
  if (eq > 0 && eq < 10 && /^[a-z0-9]+$/i.test(value.slice(0, eq))) {
    return value.slice(eq + 1);
  }
  return value;
}

function decodeSignature(value: string): Buffer {
  // A raw HMAC-SHA256 digest is 32 bytes, i.e. exactly 64 hex characters;
  // anything else is assumed to be base64 (Shopify's format, among others).
  return /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
}

// Compares a captured request's signature header against what it should be
// for the endpoint's configured secret. Returns a status rather than a plain
// boolean because "no secret configured" and "provider sent no recognized
// signature header" are both meaningfully different from an actual mismatch.
export function computeSignatureStatus(
  body: string | null,
  bodyIsBinary: boolean,
  truncated: boolean,
  headers: Record<string, string>,
  secret: string | null,
): SignatureStatus {
  if (!secret) return 'unconfigured';
  // A truncated or binary body isn't the exact bytes the sender signed (or
  // isn't text at all), so any comparison against it would be meaningless —
  // reporting a false mismatch here would be actively misleading.
  if (body === null || bodyIsBinary || truncated) return 'unknown';

  const headerValue = SIGNATURE_HEADERS.map((name) => headers[name]).find((value) => typeof value === 'string');
  if (!headerValue) return 'no-header';

  const provided = decodeSignature(stripAlgorithmPrefix(headerValue.trim()));
  const expected = createHmac('sha256', secret).update(body, 'utf-8').digest();

  if (provided.length !== expected.length) return 'invalid';
  return timingSafeEqual(provided, expected) ? 'valid' : 'invalid';
}

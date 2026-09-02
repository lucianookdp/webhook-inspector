import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { computeSignatureStatus } from '../src/signature.js';

const SECRET = 'super-secret-value';
const BODY = '{"hello":"world"}';

function hexSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf-8').digest('hex');
}

function base64Signature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf-8').digest('base64');
}

test('reports unconfigured when no secret is set', () => {
  const status = computeSignatureStatus(BODY, false, false, { 'x-hub-signature-256': 'whatever' }, null);
  assert.equal(status, 'unconfigured');
});

test('reports unknown for a truncated body even with a matching-looking header', () => {
  const status = computeSignatureStatus(
    BODY,
    false,
    true,
    { 'x-hub-signature-256': `sha256=${hexSignature(SECRET, BODY)}` },
    SECRET,
  );
  assert.equal(status, 'unknown');
});

test('reports unknown for a binary body', () => {
  const status = computeSignatureStatus('base64data', true, false, { 'x-signature': 'anything' }, SECRET);
  assert.equal(status, 'unknown');
});

test('reports unknown for a null body', () => {
  const status = computeSignatureStatus(null, false, false, { 'x-signature': 'anything' }, SECRET);
  assert.equal(status, 'unknown');
});

test('reports no-header when none of the recognized headers are present', () => {
  const status = computeSignatureStatus(BODY, false, false, { 'x-something-else': 'nope' }, SECRET);
  assert.equal(status, 'no-header');
});

test('validates a GitHub-style "sha256=<hex>" signature', () => {
  const status = computeSignatureStatus(
    BODY,
    false,
    false,
    { 'x-hub-signature-256': `sha256=${hexSignature(SECRET, BODY)}` },
    SECRET,
  );
  assert.equal(status, 'valid');
});

test('validates a bare hex signature with no algorithm prefix', () => {
  const status = computeSignatureStatus(BODY, false, false, { 'x-signature': hexSignature(SECRET, BODY) }, SECRET);
  assert.equal(status, 'valid');
});

test('validates a base64 signature (Shopify-style)', () => {
  const status = computeSignatureStatus(
    BODY,
    false,
    false,
    { 'x-shopify-hmac-sha256': base64Signature(SECRET, BODY) },
    SECRET,
  );
  assert.equal(status, 'valid');
});

test('reports invalid when the signature does not match', () => {
  const status = computeSignatureStatus(
    BODY,
    false,
    false,
    { 'x-hub-signature-256': `sha256=${hexSignature('wrong-secret', BODY)}` },
    SECRET,
  );
  assert.equal(status, 'invalid');
});

test('reports invalid when the header value is garbage, not a crash', () => {
  const status = computeSignatureStatus(BODY, false, false, { 'x-signature': 'not-a-real-signature' }, SECRET);
  assert.equal(status, 'invalid');
});

test('expects header keys already lowercased, as Fastify/Node hand them over', () => {
  const status = computeSignatureStatus(
    BODY,
    false,
    false,
    { 'X-Hub-Signature-256': `sha256=${hexSignature(SECRET, BODY)}` },
    SECRET,
  );
  // Incoming header keys are already lowercase by the time a real request
  // reaches this function (Node/Fastify normalize them), so it doesn't
  // lowercase them itself — a mixed-case key here is a no-op, as it would
  // be a bug elsewhere if one ever showed up in practice.
  assert.equal(status, 'no-header');
});

test('uses the first recognized header when more than one is present', () => {
  const status = computeSignatureStatus(
    BODY,
    false,
    false,
    {
      'x-hub-signature-256': `sha256=${hexSignature(SECRET, BODY)}`,
      'x-signature': hexSignature('wrong-secret', BODY),
    },
    SECRET,
  );
  assert.equal(status, 'valid');
});

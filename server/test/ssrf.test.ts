import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlockedAddress, resolveSafeAddress } from '../src/ssrf.js';

test('blocks loopback', () => {
  assert.equal(isBlockedAddress('127.0.0.1'), true);
  assert.equal(isBlockedAddress('127.255.255.255'), true);
  assert.equal(isBlockedAddress('::1'), true);
});

test('blocks RFC1918 private ranges', () => {
  assert.equal(isBlockedAddress('10.0.0.1'), true);
  assert.equal(isBlockedAddress('172.16.0.1'), true);
  assert.equal(isBlockedAddress('172.31.255.255'), true);
  assert.equal(isBlockedAddress('192.168.1.1'), true);
});

test('blocks link-local, including the cloud metadata address', () => {
  assert.equal(isBlockedAddress('169.254.169.254'), true);
  assert.equal(isBlockedAddress('169.254.0.1'), true);
  assert.equal(isBlockedAddress('fe80::1'), true);
});

test('blocks carrier-grade NAT, unspecified, and broadcast', () => {
  assert.equal(isBlockedAddress('100.64.0.1'), true);
  assert.equal(isBlockedAddress('0.0.0.0'), true);
  assert.equal(isBlockedAddress('255.255.255.255'), true);
  assert.equal(isBlockedAddress('::'), true);
});

test('blocks IPv6 unique-local and multicast', () => {
  assert.equal(isBlockedAddress('fc00::1'), true);
  assert.equal(isBlockedAddress('ff02::1'), true);
});

test('blocks IPv4-mapped and NAT64 IPv6 addresses outright', () => {
  assert.equal(isBlockedAddress('::ffff:8.8.8.8'), true);
  assert.equal(isBlockedAddress('64:ff9b::808:808'), true);
});

test('does not block ordinary public addresses', () => {
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('1.1.1.1'), false);
  assert.equal(isBlockedAddress('93.184.216.34'), false);
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
});

test('treats a non-IP string as blocked rather than throwing', () => {
  assert.equal(isBlockedAddress('not-an-ip'), true);
});

test('resolveSafeAddress rejects a literal loopback address without a DNS lookup', async () => {
  await assert.rejects(() => resolveSafeAddress('127.0.0.1'), /not a permitted forward target/);
});

test('resolveSafeAddress rejects localhost (resolves to loopback)', async () => {
  await assert.rejects(() => resolveSafeAddress('localhost'), /disallowed address/);
});

test('resolveSafeAddress rejects a hostname that fails to resolve', async () => {
  await assert.rejects(() => resolveSafeAddress('this-host-should-never-resolve.invalid'), /could not resolve/);
});

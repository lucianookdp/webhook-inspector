import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slugify';

test('lowercases and hyphenates spaces', () => {
  assert.equal(slugify('My Cool Webhook'), 'my-cool-webhook');
});

test('collapses runs of non-alphanumeric characters into a single hyphen', () => {
  assert.equal(slugify('orders -- v2!! (test)'), 'orders-v2-test');
});

test('strips leading and trailing hyphens', () => {
  assert.equal(slugify('  -leading and trailing-  '), 'leading-and-trailing');
});

test('passes an already-valid slug through unchanged', () => {
  assert.equal(slugify('my-cool-webhook'), 'my-cool-webhook');
});

test('truncates to 32 characters without leaving a trailing hyphen', () => {
  const result = slugify(`${'a'.repeat(31)} b`);
  assert.equal(result.length <= 32, true);
  assert.equal(result.endsWith('-'), false);
});

test('empty or all-punctuation input becomes an empty string', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('!!!'), '');
});

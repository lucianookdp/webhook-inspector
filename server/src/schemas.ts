// Matches the id.js alphabet and length exactly (see ID_LENGTH there). Every
// route keyed by endpoint id validates against this before the id ever
// reaches a query, rather than relying on a malformed id simply failing to
// match a row.
export const endpointIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9]{12}$' },
  },
} as const;

// The capture route (routes/webhook.js) is the one place a caller can use
// either the random id or a user-chosen slug (id.js's SLUG_PATTERN) — it's
// the URL people actually paste into a webhook provider, so it accepts
// whichever form was configured. Every other route keeps the strict
// id-only schema above, since the frontend always addresses them with the
// canonical id it already has.
export const captureIdentifierParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: '^([A-Za-z0-9]{12}|[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)$' },
  },
} as const;

// limit/cursor are re-parsed and semantically validated in the handler
// (routes/endpoints.js) — decodeCursor rejects anything that doesn't decode
// to the expected shape, and an out-of-range limit falls back to the
// default. This schema is the first line of defense: reject anything wildly
// oversized or non-numeric before it reaches that logic at all.
export const requestsQuerystringSchema = {
  type: 'object',
  properties: {
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
    cursor: { type: 'string', maxLength: 512 },
  },
} as const;

// requests.id is a Postgres uuid (see migrations/0001_init.sql); this
// matches its canonical text form.
export const forwardParamsSchema = {
  type: 'object',
  required: ['id', 'requestId'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9]{12}$' },
    requestId: {
      type: 'string',
      pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    },
  },
} as const;

// Just a first-line-of-defense length/shape check — routes/forward.js does
// the semantic validation (a real, parseable, http(s) URL) that a schema
// can't express, and ssrf.js validates where it actually resolves to.
export const forwardBodySchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

// null clears a previously-set secret; the handler also treats an
// empty/whitespace-only string as clearing it, since that's the more
// forgiving behavior for "I deleted the input and hit save".
export const signingSecretBodySchema = {
  type: 'object',
  required: ['secret'],
  properties: {
    secret: { type: ['string', 'null'], maxLength: 512 },
  },
} as const;

// Each field null resets that part of the response to the default (see
// webhook.js). status is capped to 200-599 — deliberately excluding the
// 1xx range, which doesn't carry a body the way this feature is meant to.
export const responseConfigBodySchema = {
  type: 'object',
  properties: {
    status: { type: ['integer', 'null'], minimum: 200, maximum: 599 },
    body: { type: ['string', 'null'], maxLength: 65536 },
    contentType: { type: ['string', 'null'], maxLength: 255 },
  },
} as const;

// Just a first-line-of-defense length check — routes/endpoints.js does the
// semantic validation (id.js's isValidSlug, after trimming/lowercasing)
// that produces a clearer 400 than a schema pattern mismatch would.
export const slugBodySchema = {
  type: 'object',
  required: ['slug'],
  properties: {
    slug: { type: ['string', 'null'], maxLength: 32 },
  },
} as const;

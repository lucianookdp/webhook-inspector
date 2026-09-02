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
